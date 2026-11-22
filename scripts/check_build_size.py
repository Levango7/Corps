#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""check_build_size.py — 构建产物体积预算门禁

背景（2026-11-21）：仓库有一千六百多个文件、Next.js 16 加大量编辑器/AI 依赖，
但**没有任何门禁在看构建产物大小**。一次不小心的整包导入（例如把某个 barrel
文件从服务端挪进客户端组件树）会让 First Load JS 成倍增长：构建照样成功、
现有全部门禁照样全绿，只有真实用户的流量与首屏时间在变差。

判据（棘轮，只允许在容忍带内增长）：
  - 度量两个与用户体验/部署成本直接相关的目录：
      web/.next/static      客户端静态资源（JS/CSS/字体）—— 直接进用户浏览器
      web/.next/standalone  服务端部署产物（next.config 的 output: "standalone"）
  - 与 scripts/build-size-baseline.txt 比对，任一指标超过基线 × 1.05 判红。
  - 基线只能通过 --emit 人工收紧；脚本绝不在 CI 里自行改写基线。

口径边界（如实声明）：
  - 只比字节总量，不区分「有价值的增长」与「浪费」。新增一个真实页面必然变大，
    此时正确动作是跑 --emit 收紧基线并在 PR 里写明原因，而不是调高容忍带。
  - 受 Next.js chunk 切分与 gzip 实现影响，同一份源码在不同 runner 上有约 1%
    抖动，故容忍带取 5%（远大于抖动、远小于真实回归）。
  - 基线缺失时打印实测值并以 NO BASELINE 退出 0：首次接入无法预知真实体积，
    由 --emit 在拿到实测后补入。这是「先可观测、后判红」，不是静默跳过——
    缺基线会在日志里显式打印，且 --self-test 独立证明判据本身有射程。
  - 只度量产物目录，不度量 node_modules；镜像层大小由 docker-publish 的
    构建日志负责，不在本门禁口径内。

用法：
  python scripts/check_build_size.py              核对当前产物是否超预算
  python scripts/check_build_size.py --self-test  注入合成数字，验证判据有射程
  python scripts/check_build_size.py --emit       用当前实测值重建基线（维护用）
退出码：
  0 通过（或基线缺失时的 NO BASELINE）
  1 超预算，或 --self-test 打不红（门无射程）
  2 产物缺失（未构建就调用）
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NEXT = ROOT / "web" / ".next"
BASELINE = Path(__file__).resolve().parent / "build-size-baseline.txt"

# 容忍带：current × 100 > baseline × 105 即判红（整数比较，避免浮点边界误差）
TOLERANCE_PCT = 105

METRICS = {
    "static": NEXT / "static",
    "standalone": NEXT / "standalone",
}


def dir_bytes(path: Path) -> int | None:
    """递归统计目录字节数；目录不存在返回 None（区分「0 字节」与「没有」）。"""
    if not path.is_dir():
        return None
    total = 0
    for dirpath, _dirnames, filenames in os.walk(path):
        for name in filenames:
            fp = os.path.join(dirpath, name)
            try:
                total += os.path.getsize(fp)
            except OSError:
                pass
    return total


def measure() -> dict[str, int]:
    out: dict[str, int] = {}
    for key, path in METRICS.items():
        size = dir_bytes(path)
        if size is not None:
            out[key] = size
    return out


def load_baseline(path: Path) -> dict[str, int]:
    """读取 `key=bytes` 行；`#` 注释与空行忽略，非法值忽略。"""
    if not path.exists():
        return {}
    out: dict[str, int] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip()
        if key in METRICS and value.isdigit():
            out[key] = int(value)
    return out


def evaluate(current: dict[str, int], baseline: dict[str, int]) -> list[str]:
    """纯判据：返回超预算说明列表；空列表 = 通过。

    与 --self-test 共用，杜绝「自证用一套、实战用另一套」。
    只做整数比较，不读文件、不写基线。
    """
    bad: list[str] = []
    for key, cur in sorted(current.items()):
        base = baseline.get(key)
        if base is None:
            continue
        if cur * 100 > base * TOLERANCE_PCT:
            pct = (cur / base - 1) * 100 if base else 0.0
            bad.append(f"{key}: {cur} B > 基线 {base} B（+{pct:.1f}%，容忍 5%）")
    return bad


def human(n: int) -> str:
    value = float(n)
    for unit in ("B", "KiB", "MiB", "GiB"):
        if value < 1024 or unit == "GiB":
            return f"{int(value)} B" if unit == "B" else f"{value:.1f} {unit}"
        value /= 1024
    return f"{value:.1f} GiB"


def run_self_test() -> int:
    """注入四组合成数字，证明判据既能判红也能放行。"""
    baseline = {"static": 1_000_000, "standalone": 10_000_000}
    cases = [
        ({"static": 1_050_000, "standalone": 10_500_000}, False, "恰在 5% 容忍边界内必须放行"),
        ({"static": 1_060_000, "standalone": 10_000_000}, True, "static 超 5% 必须判红"),
        ({"static": 1_000_000, "standalone": 11_000_000}, True, "standalone 超 5% 必须判红"),
        ({"static": 900_000, "standalone": 9_000_000}, False, "体积下降必须放行"),
    ]
    ok = True
    for current, must_fail, desc in cases:
        bad = evaluate(current, baseline)
        passed = bool(bad) == must_fail
        print(f"  {'PASS' if passed else 'FAIL'} {desc}: {'判红' if bad else '放行'}")
        ok = ok and passed
    if not ok:
        print("SELF-TEST FAIL 体积判据对自己的射程是盲的，比没有门更糟")
        return 1
    print("SELF-TEST PASS 体积判据有射程（容忍内放行 / 超限判红 / 下降放行）")
    return 0


def main() -> int:
    if "--self-test" in sys.argv:
        return run_self_test()

    current = measure()
    if not current:
        print(
            f"ERROR: 未找到构建产物（{NEXT}）。本门禁必须在 next build 之后运行。",
            file=sys.stderr,
        )
        return 2

    print("当前构建产物：")
    for key in sorted(current):
        print(f"  {key:<12} {current[key]:>12} B  ({human(current[key])})")

    if "--emit" in sys.argv:
        lines = [
            "# 构建体积基线（字节）— 由 scripts/check_build_size.py --emit 生成",
            "#",
            "# 判据：任一指标超过本基线 × 1.05 判红。收紧基线是人工动作，",
            "# 只在确认体积增长合理后执行，并在 PR 描述里说明原因。",
            "# 口径与边界见脚本 docstring。",
            "",
        ]
        lines.extend(f"{key}={current[key]}" for key in sorted(current))
        BASELINE.write_text("\n".join(lines) + "\n", encoding="utf-8")
        print(f"\nBaseline written: {BASELINE}")
        return 0

    baseline = load_baseline(BASELINE)
    if not baseline:
        print(f"\nNO BASELINE: {BASELINE.name} 无有效条目。首次接入时请运行 --emit 补入。")
        print("（本次不判红：能观测到体积是第一步，判红需要人工确认过的基线。）")
        return 0

    bad = evaluate(current, baseline)
    if bad:
        print(f"\nFAIL: {len(bad)} 项超出预算：")
        for item in bad:
            print(f"  - {item}")
        print(
            "\n修复方向：检查是否新增了整包导入、未 tree-shake 的 barrel 文件，"
            "或把服务端模块带进了客户端组件树。\n"
            "若增长是真实功能所需，运行 --emit 收紧基线，并在 PR 描述里说明原因。"
        )
        return 1

    print("\nPASS: 构建产物在预算内。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
