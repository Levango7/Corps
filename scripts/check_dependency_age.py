#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""check_dependency_age.py — 新引入的依赖版本必须"够老"（默认 ≥ 24 小时）

背景（2026-11-06）：dependabot 按家族分组之后（G0），它会自己开批次 PR。问题在于
**pnpm 的年龄策略挡不住这条路**——实测四组 fixture 已证明：

  · 无任何键 + 年轻版本            → rc=0，pnpm 自动往 `minimumReleaseAgeExclude` 追加豁免后照装
  · 只设 `minimumReleaseAge: 1440` + 年轻版本 → rc=1 `ERR_PNPM_NO_MATURE_MATCHING_VERSION`
  · 但**锁里已经钉着年轻版本**时，干净 `node_modules` + `--frozen-lockfile` + 阈值 → **rc=0 照装**

也就是说 `minimumReleaseAge` 只在**解析期**生效：dependabot 在它那侧解析并提交锁，
CI 又用 `--frozen-lockfile` 直接跳过解析 ⇒ 这个开关既管不到 dependabot 的 PR，也管不到 CI。
（顺带钉两个易错点：`minimumReleaseAgeStrict` 不是开关，**阈值**才是开关，strict 只管
"静默记豁免"还是"提示"；只设 strict 不设阈值就是空门。）

所以年龄判据只能落成仓库自己的门：**读锁文件里真实解析出来的版本，逐个查发布时间**。

判据：`web/pnpm-lock.yaml` 的 `packages:` 段里每个 `name@version`，其 npm 发布时间
距现在不少于 `--minutes`（默认 1440）分钟。任一条不足即判红。

为什么用缓存：锁里 1100+ 个版本对、980+ 个唯一包名，每个包拉一次 packument 在 CI 里太重
（`next` / `typescript` 这类单个就有数 MB）。同一版本的发布时间**永不改变**（npm 不允许
覆盖发布），所以把已查过的 `name@version -> publishedAt` 落成 `scripts/dependency-age-cache.json`
是安全的：**不存在过期问题，只有"还没查到"**。缺的条目会实时拉取，因此：
  · 一次依赖 bump 只新增少数条目，稳态成本接近于零；
  · 忘了 `--update-cache` 也不会判错，只是那几个包在 CI 里现查。

口径边界（如实声明）：
  · 只看 `web/pnpm-lock.yaml` 的 `packages:` 段（已安装的每个真实版本），不看 `importers:`
    与 `snapshots:`（后者是带 peer 后缀的重复视图）。
  · **不看** `web/pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 台账：那是 pnpm 解析期
    的豁免名单，拿它来豁免本门等于让门自己给自己发通行证（而且它是 pnpm 自动累积的）。
    想让某个年轻版本过关，走本门的 `--allow`（见下）并在 PR 里写明理由。
  · 网络取不到 → **UNDETERMINED 判红（退出码 2）**，绝不静默放行。没有 `--offline` 这种
    "跳过检查还报绿"的口子。

用法：
  python scripts/check_dependency_age.py                    核对当前锁
  python scripts/check_dependency_age.py --minutes 720      换阈值
  python scripts/check_dependency_age.py --update-cache     把本次拉到的发布时间写回缓存
  python scripts/check_dependency_age.py --allow a@1.0.0    点名豁免（可重复；须在 PR 写明理由）
  python scripts/check_dependency_age.py --self-test        注入式自测（离线，四类红因 + 边界）

退出码：0 通过 / 1 有版本太年轻 / 2 有版本判定不了（含网络失败）/ 3 用法错误
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCK = ROOT / "web" / "pnpm-lock.yaml"
CACHE = ROOT / "scripts" / "dependency-age-cache.json"
DEFAULT_MINUTES = 1440
REGISTRY = "https://registry.npmjs.org"
UA = "corps-dependency-age-gate/1 (+repo: Levango7/Corps)"


# ---------------------------------------------------------------- 锁文件解析

def parse_lock(path: Path) -> list[tuple[str, str]]:
    """从 packages: 段取出 (name, version)。只认 2 空格缩进的键行。"""
    text = path.read_text(encoding="utf-8").replace("\r\n", "\n")
    lines = text.split("\n")
    try:
        start = lines.index("packages:")
    except ValueError:
        raise SystemExit(f"锁文件里没有 packages: 段：{path}")
    end = len(lines)
    for i in range(start + 1, len(lines)):
        if lines[i] and not lines[i].startswith(" "):
            end = i
            break

    pairs: list[tuple[str, str]] = []
    for raw in lines[start + 1:end]:
        if not raw.startswith("  ") or raw.startswith("   "):
            continue
        key = raw.strip()
        if not key.endswith(":"):
            continue
        key = key[:-1]
        if len(key) >= 2 and key[0] == "'" and key[-1] == "'":
            key = key[1:-1]
        if "@" not in key:
            continue
        name, ver = key.rsplit("@", 1)
        # 只认已解析成具体版本号的；`file:` / `link:` / `workspace:` 之类没有发布时间
        if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.\-]+)?", ver):
            continue
        pairs.append((name, ver))
    return pairs


# ---------------------------------------------------------------- 发布时间

def _key(name: str, ver: str) -> str:
    return f"{name}@{ver}"


def load_cache(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"缓存文件不是合法 JSON（{exc}）：{path}")
    if not isinstance(data, dict):
        raise SystemExit(f"缓存文件顶层必须是对象：{path}")
    return {str(k): str(v) for k, v in data.items()}


def save_cache(path: Path, cache: dict[str, str]) -> None:
    ordered = {k: cache[k] for k in sorted(cache)}
    path.write_text(json.dumps(ordered, ensure_ascii=False, indent=0, sort_keys=True) + "\n",
                    encoding="utf-8")


def fetch_packument(name: str, registry: str, timeout: float) -> dict[str, str]:
    """返回该包 {version: publishedAt(ISO)}；失败抛异常。"""
    url = f"{registry.rstrip('/')}/{urllib.parse.quote(name, safe='@')}"
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        doc = json.loads(resp.read().decode("utf-8"))
    times = doc.get("time") or {}
    return {v: t for v, t in times.items() if v not in ("created", "modified")}


def fetch_missing(names: list[str], registry: str, timeout: float, workers: int) -> tuple[dict, list]:
    """并发拉取；返回 ({name: {ver: iso}}, [失败说明])。"""
    got: dict[str, dict[str, str]] = {}
    errors: list[str] = []

    def one(name: str) -> None:
        for attempt in (1, 2):
            try:
                got[name] = fetch_packument(name, registry, timeout)
                return
            except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
                if attempt == 2:
                    errors.append(f"{name}: {type(exc).__name__}: {exc}")
                    return
                time.sleep(1.5)

    if not names:
        return got, errors
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        list(pool.map(one, names))
    return got, errors


def parse_iso(value: str) -> datetime | None:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


# ---------------------------------------------------------------- 判定

def evaluate(pairs, times, minutes, now, allow):
    """返回 (violations, undetermined, checked)。纯函数，自测直接调用。"""
    violations: list[tuple[str, float, str]] = []
    undetermined: list[tuple[str, str]] = []
    checked = 0
    for name, ver in pairs:
        key = _key(name, ver)
        if key in allow:
            continue
        checked += 1
        iso = times.get(key)
        published = parse_iso(iso) if iso else None
        if published is None:
            undetermined.append((key, "没有发布时间" if iso is None else f"时间无法解析: {iso}"))
            continue
        age_min = (now - published).total_seconds() / 60.0
        if age_min < minutes:
            violations.append((key, age_min, iso))
    return violations, undetermined, checked


# ---------------------------------------------------------------- 自测

def self_test() -> int:
    """离线注入：四类红因 + 边界 + 阈值归零对照，断言红因集合精确相等。"""
    now = datetime(2026, 11, 6, 6, 0, tzinfo=timezone.utc)
    minutes = 1440
    iso = lambda h: (now - timedelta(hours=h)).isoformat()

    pairs = [
        ("young-pkg", "1.0.0"),      # 9h  → 太年轻
        ("old-pkg", "1.0.0"),        # 159h → 通过
        ("edge-pkg", "1.0.0"),       # 恰好 1440 分钟 → 通过（>=）
        ("vault-pkg", "1.0.0"),      # 无时间 → 判定不了
        ("allowed-pkg", "1.0.0"),    # 9h 但被 --allow 点名 → 跳过
    ]
    times = {
        "young-pkg@1.0.0": iso(9),
        "old-pkg@1.0.0": iso(159),
        "edge-pkg@1.0.0": iso(24),
        "allowed-pkg@1.0.0": iso(9),
    }
    allow = {"allowed-pkg@1.0.0"}

    violations, undetermined, checked = evaluate(pairs, times, minutes, now, allow)
    got_red = {v[0] for v in violations} | {u[0] for u in undetermined}
    want_red = {"young-pkg@1.0.0", "vault-pkg@1.0.0"}

    ok = True
    if got_red != want_red:
        print(f"  X 红因集合不等：多 {sorted(got_red - want_red)} 少 {sorted(want_red - got_red)}")
        ok = False
    else:
        print(f"  OK 红因集合精确等于预期：{sorted(got_red)}")

    if checked != 4:
        print(f"  X 受检条数应为 4（--allow 那条不算），实得 {checked}")
        ok = False
    else:
        print("  OK --allow 的那条既不通红也不计入受检")

    # 阈值归零对照：同数据必须全绿 —— 证明是"阈值"在判，不是别的副作用
    v0, u0, _ = evaluate(pairs, times, 0, now, allow)
    if v0 or {u[0] for u in u0} != {"vault-pkg@1.0.0"}:
        print(f"  X 阈值归零后仍有非空判定：violations={v0} undetermined={u0}")
        ok = False
    else:
        print("  OK 阈值归零后只剩'无时间'那一条不确定（阈值确实在起作用）")

    # 边界两侧各一例：样本固定 1440 分钟大，阈值 1441 判红、1440 判绿（>= 即通过）
    for mins, expect_red in ((1441, True), (1440, False)):
        v, _, _ = evaluate([("edge-pkg", "1.0.0")], times, mins, now, set())
        red = bool(v)
        if red != expect_red:
            print(f"  X 边界 {mins} 分钟：期望{'红' if expect_red else '绿'}，实得{'红' if red else '绿'}")
            ok = False
        else:
            print(f"  OK 边界 {mins} 分钟 → {'红' if red else '绿'}")

    print("SELF-TEST PASS 门有射程" if ok else "SELF-TEST FAIL 门本身坏了")
    return 0 if ok else 1


# ---------------------------------------------------------------- 主流程

def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(add_help=True, description="依赖版本发布年龄门")
    ap.add_argument("--minutes", type=int, default=DEFAULT_MINUTES)
    ap.add_argument("--registry", default=REGISTRY)
    ap.add_argument("--cache", default=str(CACHE))
    ap.add_argument("--update-cache", action="store_true")
    ap.add_argument("--allow", action="append", default=[])
    ap.add_argument("--timeout", type=float, default=25.0)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--lock", default=str(LOCK))
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args(argv)

    if args.self_test:
        return self_test()
    if args.minutes <= 0:
        print("--minutes 必须为正数", file=sys.stderr)
        return 3

    lock_path = Path(args.lock)
    if not lock_path.exists():
        print(f"找不到锁文件：{lock_path}", file=sys.stderr)
        return 3

    pairs = parse_lock(lock_path)
    if not pairs:
        print("锁文件里没解析出任何版本 —— 读数面坏了，不是'没有依赖'", file=sys.stderr)
        return 2

    cache_path = Path(args.cache)
    cache = load_cache(cache_path)
    allow = set(args.allow)

    times: dict[str, str] = {}
    missing_versions: dict[str, list[str]] = {}
    for name, ver in pairs:
        key = _key(name, ver)
        if key in cache:
            times[key] = cache[key]
        else:
            missing_versions.setdefault(name, []).append(ver)

    cache_hits = len(times)
    fetched_pkgs = 0
    errors: list[str] = []
    if missing_versions:
        got, errors = fetch_missing(sorted(missing_versions), args.registry, args.timeout, args.workers)
        fetched_pkgs = len(got)
        for name, per in got.items():
            for ver in missing_versions.get(name, []):
                if ver in per:
                    times[_key(name, ver)] = per[ver]

    now = datetime.now(timezone.utc)
    violations, undetermined, checked = evaluate(pairs, times, args.minutes, now, allow)

    if args.update_cache and times:
        merged = dict(cache)
        merged.update({k: v for k, v in times.items() if k not in merged or merged[k] == v})
        if merged != cache:
            save_cache(cache_path, merged)
            print(f"缓存已更新：{cache_path}（新增 {len(merged) - len(cache)} 条）")

    print(f"锁内版本 {len(pairs)} 个，受检 {checked} 个，豁免 {len(pairs) - checked} 个；"
          f"缓存命中 {cache_hits}，实时拉取 {sum(len(v) for v in missing_versions.values())} 条"
          f"（{fetched_pkgs} 个包）")

    if violations:
        print(f"\nTOO_YOUNG 有 {len(violations)} 个版本发布不足 {args.minutes} 分钟：")
        for key, age_min, published in sorted(violations, key=lambda x: x[1]):
            print(f"  {key:44} 发布 {age_min:8.1f} 分钟前  ({published})")
        print("\n处置：等它过窗再合，或在本门 `--allow` 点名并在 PR 写明理由（不要改缓存糊过去）。")

    if undetermined:
        print(f"\nUNDETERMINED 有 {len(undetermined)} 个版本拿不到发布时间：")
        for key, why in undetermined[:20]:
            print(f"  {key:44} {why}")
        if len(undetermined) > 20:
            print(f"  …另有 {len(undetermined) - 20} 条")
        for err in errors[:5]:
            print(f"  取数失败：{err}")
        print("\n判定不了不等于通过：网络或 registry 问题要查，别当成绿。")

    if violations:
        return 1
    if undetermined:
        return 2
    print(f"\nPASS 锁内 {checked} 个版本发布时间全部 ≥ {args.minutes} 分钟")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
