#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""check_picomatch_fix.py — picomatch 安全豁免的"上游修复版"到期探测

背景（2026-11-21）：
  Security Audit 用 `--ignore=GHSA-fc5q-39xc-vjpf` 精准豁免 picomatch ReDoS
  （影响 <=4.0.7）。豁免的唯一正当理由是"上游 latest=4.0.7 仍受影响、无修复版"。
  该理由有到期条件：一旦上游发布 >4.0.7 的修复版，豁免就从"精准"变成"掩盖漏洞"，
  必须立刻移除 --ignore 并升级依赖。

  #368 只在 ci.yml 写了人工复核期限 2026-12-31 —— 期限是提醒，不是机器判据：
  若 12-31 前就发了修复版，CI 仍会静默放行。本门禁把"上游是否已发布修复版"
  变成每次 CI 都会跑的判据，挂在已有 required job `Security Audit` 上。

判据：
  取 `https://registry.npmjs.org/picomatch` 的 dist-tags.latest：
    - latest > 4.0.7  → FAIL（退出码 1）：修复版已发布，移除豁免 + 升级
    - latest <= 4.0.7 → PASS（退出码 0）：豁免仍然有效
    - 取不到 / 版本无法解析 → UNDETERMINED（退出码 2），不静默放行

口径边界（如实声明）：
  - 只比 `dist-tags.latest` 的主版本三段 major.minor.patch，忽略 pre-release 后缀；
    保守起见 4.0.8-beta.1 也算修复版已发布（宁可提前提醒，不掩盖）。
  - FIXED_AT 是写死的阈值（GHSA-fc5q-39xc-vjpf 声明的最后受影响版本）。若上游
    修订了 advisory 的影响范围，必须同步改这里并在 PR 写明依据；2026-12-31
    人工复核时也要确认 advisory 范围未变。
  - 不检查本地锁文件是否已升级：本门只回答"豁免是否还站得住"，升级动作由人执行。
  - 网络取不到一律 UNDETERMINED 判红，无 --offline 之类的静默放行口子
    （与 check_dependency_age.py 同一口径）。

用法：
  python scripts/check_picomatch_fix.py              主检查（联网）
  python scripts/check_picomatch_fix.py --self-test  注入式自测（离线，不联网）
退出码：0 PASS / 1 修复版已发布 / 2 UNDETERMINED / 3 用法错误
"""
from __future__ import annotations

import json
import re
import sys
import urllib.request
from pathlib import Path

REGISTRY = "https://registry.npmjs.org/picomatch"
UA = "corps-picomatch-advisory-gate/1 (+repo: Levango7/Corps)"
ADVISORY = "GHSA-fc5q-39xc-vjpf"
# GHSA-fc5q-39xc-vjpf 声明的最后受影响版本；strictly greater 即视为修复版已发布。
FIXED_AT = (4, 0, 7)
CI_FILE = ".github/workflows/ci.yml"
TIMEOUT = 15


def parse_version(raw: str) -> tuple[int, int, int] | None:
    """取主版本三段；无法解析返回 None（判 UNDETERMINED，不猜）。"""
    m = re.match(r"^\s*(\d+)\.(\d+)\.(\d+)", raw or "")
    if not m:
        return None
    return tuple(int(x) for x in m.groups())  # type: ignore[return-value]


def is_fixed(latest: str) -> bool | None:
    """latest 是否已是修复版。None=版本无法解析。"""
    v = parse_version(latest)
    if v is None:
        return None
    return v > FIXED_AT


def fetch_latest() -> str:
    """从 npm registry 取 dist-tags.latest；任何失败抛异常交 check() 判 UNDETERMINED。"""
    req = urllib.request.Request(
        REGISTRY,
        headers={"User-Agent": UA, "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return str(data["dist-tags"]["latest"])


def check(fetcher=fetch_latest) -> int:
    try:
        latest = fetcher()
    except Exception as exc:  # noqa: BLE001 — 任何取数失败都是 UNDETERMINED
        print(f"UNDETERMINED: 取 picomatch latest 失败：{exc}")
        print("  判定不了不等于通过 —— 请检查网络/registry 后重跑 CI。")
        return 2

    fixed = is_fixed(latest)
    if fixed is None:
        print(f"UNDETERMINED: picomatch latest 版本无法解析：{latest!r}")
        return 2
    if fixed:
        print(f"FAIL: picomatch 已发布修复版 latest={latest} > "
              f"{FIXED_AT[0]}.{FIXED_AT[1]}.{FIXED_AT[2]}")
        print(f"  {ADVISORY} 的精准豁免已失去正当性，必须：")
        print(f"    1) 从 {CI_FILE} 移除 --ignore={ADVISORY} 及其注释")
        print(f"    2) 升级 web/pnpm-lock.yaml 的 picomatch 至 >= {latest}")
        return 1

    print(f"PASS: picomatch latest={latest} <= "
          f"{FIXED_AT[0]}.{FIXED_AT[1]}.{FIXED_AT[2]}，{ADVISORY} 豁免仍有效")
    return 0


def self_test() -> int:
    """注入版本与取数失败，断言判据两侧都对；防 is_fixed 退化成恒 True/恒 False。"""
    ok = True
    # 两侧边界 + prerelease 保守侧 + 无法解析
    cases = [
        ("4.0.6", False),
        ("4.0.7", False),
        ("4.0.7-beta.1", False),   # pre-release of unaffected version 仍不受影响
        ("4.0.8", True),
        ("4.0.8-beta.1", True),    # 保守：修复版候选出现即提醒
        ("4.1.0", True),
        ("5.0.0", True),
        ("garbage", None),
        ("", None),
    ]
    for raw, expected in cases:
        got = is_fixed(raw)
        if got != expected:
            print(f"  FAIL is_fixed({raw!r}) 期望 {expected}，实得 {got}")
            ok = False
        else:
            print(f"  OK   is_fixed({raw!r}) -> {got}")

    # 恒放行 / 恒判红退化：上面两侧必须同时有 PASS 与 FAIL 样本，已由 cases 覆盖。
    # 取数失败必须 UNDETERMINED(2)，不许静默 PASS。
    def boom():
        raise RuntimeError("simulated registry failure")

    rc = check(boom)
    if rc != 2:
        print(f"  FAIL 取数失败应判 UNDETERMINED(2)，实得 {rc}")
        ok = False
    else:
        print("  OK   取数失败 -> UNDETERMINED(2)")

    # 可解析 latest 的端到端判定（桩 fetcher，不联网）
    if check(lambda: "4.0.7") != 0:
        print("  FAIL 桩 latest=4.0.7 应 PASS(0)")
        ok = False
    else:
        print("  OK   桩 latest=4.0.7 -> PASS(0)")
    if check(lambda: "4.0.8") != 1:
        print("  FAIL 桩 latest=4.0.8 应 FAIL(1)")
        ok = False
    else:
        print("  OK   桩 latest=4.0.8 -> FAIL(1)")

    print("self-test PASS" if ok else "self-test FAILED")
    return 0 if ok else 2


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        raise SystemExit(self_test())
    if len(sys.argv) > 1:
        print(f"用法错误：未知参数 {sys.argv[1]}")
        raise SystemExit(3)
    raise SystemExit(check())
