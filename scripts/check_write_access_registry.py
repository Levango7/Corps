#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
check_write_access_registry.py — 写接口「覆盖 or 登记」二选一门禁

背景（与 scripts/check_permission_gates.py 的分工）：
  那份门禁把写 handler 分成 T1–T5 五档，量的是「handler 源码里有没有角色判断」。
  2026-10-03 起写权限收敛到单一 choke point：`lib/auth.ts` 的 getWorkspaceContext()
  内部调用 lib/write-policy.ts 做 default-deny 裁决。于是出现一个新的判据盲区——
  **handler 只要不经过 getWorkspaceContext，就完全不在墙内**，而五档门禁只看角色判断、
  看不见这条线，会给它记一个「本来也没有角色判断」的 T3，等于默认放行。

本脚本把这条线补上，断言两条：
  COVERED_OR_REGISTERED  每个写 handler 要么（a）源码调用 getWorkspaceContext（进墙），
                         要么（b）在 scripts/write-access-registry.txt 显式登记，
                         写明为什么不进墙 + 复核截止日。两者皆无 -> 红。
  NO_REGISTRY_ROT        登记表里已经进墙的条目必须删除（防止登记表虚胖后失去信息量），
                         过期未复核（review_by < 今天）同样红 —— 登记表不是终身豁免书。

三种 red 因自检：注入变异必须各自**因正确的红因**变红，否则判据坏了会永远绿灯。

用法：
  python scripts/check_write_access_registry.py              门禁检查
  python scripts/check_write_access_registry.py --emit       按现状重刷登记表
  python scripts/check_write_access_registry.py --self-test  跑变异自检
退出码：0 通过；1 断言失败；2 自检未如期变红。
"""

from __future__ import annotations

import re
import sys
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
WEB = REPO / "web"
API_ROOT = WEB / "app" / "api"
REGISTRY = Path(__file__).resolve().parent / "write-access-registry.txt"

# 与 check_api_contract.py 同口径：这些前缀/路径不参与外部契约，也不参与本门禁
INTERNAL_PREFIXES = ("/api/cron/", "/api/health", "/api/auth/", "/api/uploads/")
# /api/[...path] 是 Next.js 兜底路由（源码形态），route_from_file 后写成 {...path}
INTERNAL_EXACT = ("/api/[...path]", "/api/{...path}")

WRITE_METHODS = ("POST", "PUT", "PATCH", "DELETE")
HANDLER_RE = re.compile(
    r"export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b"
    r"|export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\b"
)
# 进墙信号：handler 所在文件 getWorkspaceContext / getWorkspaceContextV2 调用
#（choke point 入口。V2 是 authFailure 收口引入的失败语义显式化变体，同墙同责——
#   2026-10-08 CI 红：V2 迁移批量落地后本正则不认识 V2，78 个已进墙 handler
#   被误报 UNGATED，判据漂移即修）
CHOKE_POINT_RE = re.compile(r"\bgetWorkspaceContext(?:V2)?\s*\(")

ENTRY_RE = re.compile(r"^(POST|PUT|PATCH|DELETE)\s+(\S+)\s+reason=(\S+)\s+review_by=(\d{4}-\d{2}-\d{2})$")


def route_from_file(rel: str) -> str:
    """app/api/v1/foo/[id]/route.ts -> /api/v1/foo/{id}"""
    parts = rel.split("/")
    segs: list[str] = []
    for p in parts:
        if p == "route.ts":
            continue
        if p.startswith("[") and p.endswith("]"):
            segs.append("{" + p[1:-1] + "}")
        else:
            segs.append(p)
    return "/" + "/".join(segs)


def is_internal(route: str) -> bool:
    return route in INTERNAL_EXACT or any(route.startswith(p) for p in INTERNAL_PREFIXES)


def collect_write_handlers() -> dict[tuple[str, str], bool]:
    """返回 {(method, route): covered}，covered=文件是否调用 getWorkspaceContext。"""
    out: dict[tuple[str, str], bool] = {}
    for ts in sorted(API_ROOT.rglob("route.ts")):
        rel = ts.relative_to(WEB / "app").as_posix()
        route = route_from_file(rel)
        if is_internal(route):
            continue
        src = ts.read_text(encoding="utf-8", errors="ignore")
        covered = bool(CHOKE_POINT_RE.search(src))
        for m in HANDLER_RE.finditer(src):
            method = m.group(1) or m.group(2)
            if method in WRITE_METHODS:
                out[(method, route)] = covered
    return out


def load_registry(path: Path = REGISTRY) -> dict[tuple[str, str], tuple[str, str]]:
    """解析登记表 -> {(method, route): (reason, review_by)}。"""
    out: dict[tuple[str, str], tuple[str, str]] = {}
    if not path.exists():
        return out
    for ln in path.read_text(encoding="utf-8").splitlines():
        s = ln.strip()
        if not s or s.startswith("#"):
            continue
        m = ENTRY_RE.match(s)
        if not m:
            # 语法错误由 check() 报错，这里先跳过以免二次崩溃
            continue
        out[(m.group(1), m.group(2))] = (m.group(3), m.group(4))
    return out


def check_raw() -> tuple[list[str], dict[tuple[str, str], bool]]:
    """返回 (错误列表, handler 表)。错误为空即通过。"""
    errors: list[str] = []
    handlers = collect_write_handlers()

    if not REGISTRY.exists():
        return [f"登记表缺失：{REGISTRY.name}（用 --emit 生成）"], handlers

    registry = load_registry()

    # 语法：每一行都必须能被 ENTRY_RE 解析，且 review_by 是合法日期
    for ln in REGISTRY.read_text(encoding="utf-8").splitlines():
        s = ln.strip()
        if not s or s.startswith("#"):
            continue
        m = ENTRY_RE.match(s)
        if not m:
            errors.append(f"MALFORMED 登记表行无法解析（须为 'METHOD PATH reason=... review_by=YYYY-MM-DD'）：{s}")
            continue
        try:
            date.fromisoformat(m.group(4))
        except ValueError:
            errors.append(f"BAD_DATE review_by 不是合法日期：{s}")

    today = date.today()

    for key, covered in sorted(handlers.items()):
        method, route = key
        entry = registry.get(key)
        if covered:
            if entry is not None:
                errors.append(
                    f"REGISTRY_ROT {method} {route} 已进墙（文件调用了 getWorkspaceContext），"
                    f"登记表里的这行该删"
                )
            continue
        if entry is None:
            errors.append(
                f"UNGATED {method} {route} 既不经过 getWorkspaceContext，也未在登记表里说明理由"
            )
            continue
        _reason, review_by = entry
        if date.fromisoformat(review_by) < today:
            errors.append(
                f"REVIEW_OVERDUE {method} {route} 复核截止日已过（review_by={review_by}），"
                f"需重新确认它为什么不进墙"
            )

    # 登记表里指向已不存在的 handler（改名/删除后残留）
    for key in sorted(set(registry) - set(handlers)):
        errors.append(f"REGISTRY_ROT 登记条目已无对应 handler：{key[0]} {key[1]}")

    return errors, handlers


def emit() -> int:
    handlers = collect_write_handlers()
    today = date.today()
    review = date(today.year, 12, 31)
    lines = [
        "# 写接口登记册 —— 未经过 getWorkspaceContext 的写 handler 必须在此说明原因",
        "#",
        "# 格式：METHOD PATH reason=一句话说明为什么不进墙 review_by=YYYY-MM-DD",
        "#   - 进墙（文件调用了 getWorkspaceContext）的 handler 不得出现在这里，出现即 REGISTRY_ROT 红",
        "#   - review_by 过期同样红：登记表不是终身豁免书，到期必须重新论证",
        f"# 由 python scripts/check_write_access_registry.py --emit 重刷于 {today.isoformat()}",
        "#",
    ]
    for (method, route), covered in sorted(handlers.items()):
        if covered:
            continue
        lines.append(
            f"{method} {route} reason=TO_BE_CLASSIFIED review_by={review.isoformat()}"
        )
    REGISTRY.write_text("\n".join(lines) + "\n", encoding="utf-8")
    n = len(lines) - 7
    print(f"written {REGISTRY.name}: {n} entries")
    return 0


def check() -> int:
    errors, handlers = check_raw()
    print(f"Write handlers scanned: {len(handlers)}")
    print(f"Covered by choke point: {sum(1 for c in handlers.values() if c)}")
    print(f"Registered explicitly:  {sum(1 for c in handlers.values() if not c)} (行为以登记表为准)")
    if errors:
        print("\n".join("  " + e for e in errors))
        print(f"FAIL: {len(errors)} 项写访问控制缺口（见上方 {sorted({e.split()[0] for e in errors})}）")
        return 1
    print("PASS: 每个写 handler 要么进墙，要么登记并给出理由。")
    return 0


EXPECTED_REASONS = {"UNGATED", "REGISTRY_ROT", "REVIEW_OVERDUE"}


def red_reasons(errors: list[str]) -> set[str]:
    return {e.split()[0] for e in errors if e.split()}


def self_test() -> int:
    """三种变异必须各自因正确的红因变红。"""
    original = REGISTRY.read_text(encoding="utf-8") if REGISTRY.exists() else None
    handlers = collect_write_handlers()
    uncovered = [k for k, c in handlers.items() if not c]
    if not uncovered:
        print("SKIP: 当前没有未进墙的写 handler，无法构造变异")
        return 0

    mutations = []

    # 变异 1：把一条未进墙的 handler 从登记表里删掉 -> UNGATED
    victim = uncovered[0]
    lines = original.splitlines() if original else []
    lines = [ln for ln in lines if not ln.startswith(f"{victim[0]} {victim[1]} ")]
    mutations.append(("删除登记行 -> UNGATED", lines, {"UNGATED"}))

    # 变异 2：给一条已进墙的 handler 补一条登记表行 -> REGISTRY_ROT
    covered = [k for k, c in handlers.items() if c]
    if covered:
        bad = covered[0]
        lines2 = (original.splitlines() if original else []) + [
            f"{bad[0]} {bad[1]} reason=X review_by=2099-01-01"
        ]
        mutations.append(("给已进墙者补登记 -> REGISTRY_ROT", lines2, {"REGISTRY_ROT"}))

    # 变异 3：把 review_by 改成过去 -> REVIEW_OVERDUE
    lines3 = (original.splitlines() if original else [])[:]
    for i, ln in enumerate(lines3):
        s = ln.strip()
        if s and not s.startswith("#") and s.startswith(f"{victim[0]} {victim[1]} "):
            lines3[i] = re.sub(r"review_by=\d{4}-\d{2}-\d{2}", "review_by=2000-01-01", ln)
    mutations.append(("把复核日改成过去 -> REVIEW_OVERDUE", lines3, {"REVIEW_OVERDUE"}))

    ok = True
    for name, patched, expected in mutations:
        try:
            REGISTRY.write_text("\n".join(patched) + "\n", encoding="utf-8")
            errors, _ = check_raw()
            got = red_reasons(errors)
            hit = expected & got
            if not errors or not hit:
                print(f"  FAIL {name}：未因 {sorted(expected)} 变红（实得 {sorted(got)}）")
                ok = False
            else:
                print(f"  OK   {name} -> {sorted(hit)}")
        finally:
            if original is not None:
                REGISTRY.write_text(original, encoding="utf-8")

    print("self-test PASS" if ok else "self-test FAILED: 判据失效")
    return 0 if ok else 2


if __name__ == "__main__":
    if "--emit" in sys.argv:
        raise SystemExit(emit())
    if "--self-test" in sys.argv:
        raise SystemExit(self_test())
    raise SystemExit(check())
