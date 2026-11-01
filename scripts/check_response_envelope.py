#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
check_response_envelope.py — 响应信封 code 约定的棘轮门禁（仅标准库）

## 约定（本门禁把它从"隐式"变成"明写"）

API 响应体里的 `code` 等于 HTTP 状态码：成功即 200，新建即 201。

这条约定**在文档里一个字都没有**，但它是真的在被消费——这不是风格问题：

- `web/lib/api.ts:114`  `json?.code ?? res.status` —— 统一错误码的来源
- `web/components/pwa/PushSubscribe.tsx:63`  `if (subscribeJson.code !== 200)` —— 拿它判成功

所以 `code: 0` 是一个**会被读成"失败"的值**。现状（2026-11-01 实测）：
63 个生产路由文件、**101 处**真实用法（多数内联在 `NextResponse.json({...})`，其余是跨行对象），
对照 389 处用状态码——全仓存在第二套方言。

> 朴素 `grep -c 'code: 0'` 会数出 **117 处 / 65 个文件**，多出的 16 处是**文档注释在描述信封格式**
> （如 `ai/mail-assistant/route.ts:6` 的 `// - summarize：{ code: 0, data: ... }`），
> 另有 2 个文件只在注释里出现。这类误报本项目踩过：score_maturity 曾把注释里的
> `withRed(` 当成真实调用点。所以本脚本先逐行剔注释再计数，基线登记的是 101。

## 为什么先棘轮、不直接批量改

117 处横跨 ai / mail / push / notifications / favorites / forms / workflows / sync 等域。
统一口径是**行为变更**，藏在数据批次里做等于悄悄改契约。#183 的结论里写过同一条纪律：
"统一口径属行为变更，不夹带在数据批次里"。所以本门禁只做一件事：
**把存量冻结住，让它只许减少**，清偿按域分批走（见 docs/API-CONVENTIONS.md）。

## 口径（克制到只判无歧义的那一类）

- 只判 `code: 0`。HTTP 状态码**永不为 0** ⇒ 出现即不一致，不需要配对分析。
- **不判** `code: <N>` 与 `{ status: <M> }` 的配对（`code: 200, status: 201` 这种要 AST 才分得清，
  误报代价高于收益），也不判 `message` 字段的形态差异。
- 仅扫生产路由 `web/app/api/**/route.ts`；测试与夹具不在射程内。
- 注释行不算（`//`、`*`、`/*` 开头的行）——这类误报本项目已经踩过一次
  （score_maturity 曾把文档注释里的 `withRed(` 当成真实调用点）。

红因（与 check_p0_content.py 同口径）：
- `NEW_FILE`     基线外首次出现 code: 0     -> 红：新方言，要么真修、要么显式登记
- `REGRESSION`   已登记文件的处数变多        -> 红：只许减少
- 归零/减少**只打印提示、不判红**——否则修好一处的人会被自己的门禁卡住

退出码：0 通过；1 有新增/变多；2 自检未按预期。

用法：
    python scripts/check_response_envelope.py             # 门禁（CI 用这个）
    python scripts/check_response_envelope.py --emit      # 刷新基线（提交前人工核对 diff）
    python scripts/check_response_envelope.py --self-test # 注入式自检（钉误报/漏报边界）
"""

from __future__ import annotations

import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API_DIR = ROOT / "web" / "app" / "api"
BASELINE = ROOT / "scripts" / "envelope-code-baseline.txt"

# `code: 0` —— 前面不能是 `.` 或标识符字符（排除 error.code: 0 / xcode: 0），后面不能接数字（排除 00）
VIOLATION_RE = re.compile(r"(?<![.\w$])code\s*:\s*0(?![0-9])")
COMMENT_ONLY_RE = re.compile(r"^\s*(?:\*|//|/\*)")

HEADER = """\
# 响应信封 code 约定基线（棘轮）—— 现存 code: 0 全部登记，只许收缩、不许新增
#
# 由 `python scripts/check_response_envelope.py --emit` 生成/刷新，**提交前必须人工核对 diff**。
# 每行格式：<相对仓库根的路径> <违反处数>
#
# 约定：响应体 code 应等于 HTTP 状态码（成功 200 / 新建 201）。这条约定没有文档写过，
# 但 web/lib/api.ts:114 与 web/components/pwa/PushSubscribe.tsx:63 在真实消费它，
# 所以 code: 0 会被读成"失败"。详见 docs/API-CONVENTIONS.md。
#
# 判据（红因集合）：
#   NEW_FILE     基线外首次出现 code: 0   -> CI 红：新方言，真修或显式登记
#   REGRESSION   已登记文件的处数变多      -> CI 红：只许减少
#   （归零/减少的条目只打印提示、不判红——否则修好一处的人会被门禁卡住）
#
# 为什么是棘轮不是一刀切：上线时全仓已有上百处真实违反（63 文件 / 101 处），
# 一道上线就全红的门禁只会被 --no-verify 掉。登记 ≠ 认可，每一条都是待还的技术债，
# 清偿按域分批（见 docs/API-CONVENTIONS.md §3）。
"""


def _is_comment_only(line: str) -> bool:
    return bool(COMMENT_ONLY_RE.match(line))


def scan(api_dir: Path, root: Path | None = None) -> dict[str, int]:
    """返回 {相对 root 的 POSIX 路径: 违反处数}，只含有违反的文件。"""
    base = root or api_dir.parents[2]
    counts: dict[str, int] = {}
    if not api_dir.is_dir():
        return counts
    for path in sorted(api_dir.rglob("route.ts")):
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        n = sum(
            1
            for line in text.splitlines()
            if VIOLATION_RE.search(line) and not _is_comment_only(line)
        )
        if n:
            counts[path.relative_to(base).as_posix()] = n
    return counts


def load_baseline(path: Path = BASELINE) -> dict[str, int]:
    entries: dict[str, int] = {}
    if not path.exists():
        return entries
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.rsplit(None, 1)
        if len(parts) != 2:
            continue
        key, value = parts
        try:
            entries[key] = int(value)
        except ValueError:
            continue
    return entries


def compare(current: dict[str, int], baseline: dict[str, int]) -> tuple[list[str], list[str], list[str]]:
    """返回 (红因, 收紧提示, 其余提示)。"""
    reds: list[str] = []
    shrink: list[str] = []
    for path in sorted(current):
        n = current[path]
        if path not in baseline:
            reds.append(f"NEW_FILE    {path} —— 首次出现 {n} 处 code: 0（约定是 code = HTTP 状态码）")
        elif n > baseline[path]:
            reds.append(f"REGRESSION  {path} —— {baseline[path]} -> {n} 处（只许减少）")
    for path in sorted(baseline):
        n = current.get(path, 0)
        if n < baseline[path]:
            shrink.append(f"已清偿     {path} —— {baseline[path]} -> {n} 处（跑 --emit 收紧基线）")
    total_now, total_base = sum(current.values()), sum(baseline.values())
    info = [f"合计：基线 {total_base} 处 -> 当前 {total_now} 处（{len(current)} 个文件）"]
    return reds, shrink, info


def emit(current: dict[str, int]) -> int:
    lines = [HEADER.rstrip("\n"), ""]
    for path in sorted(current):
        lines.append(f"{path} {current[path]}")
    lines.append("")
    BASELINE.write_text("\n".join(lines), encoding="utf-8")
    total = sum(current.values())
    print(f"已写入 {BASELINE.relative_to(ROOT).as_posix()}：{len(current)} 个文件 / {total} 处")
    print("提交前必须人工核对 diff：这份基线是待还债务清单，不是成绩单。")
    return 0


def run() -> int:
    current = scan(API_DIR)
    baseline = load_baseline()
    reds, shrink, info = compare(current, baseline)
    for line in info:
        print(line)
    if reds:
        print(f"FAIL: {len(reds)} 项新增/变多")
        for line in reds:
            print("  " + line)
        return 1
    for line in shrink:
        print("  " + line)
    print(f"PASS: 无异于存量的 code: 0（登记 {len(baseline)} 个文件 / {sum(baseline.values())} 处）")
    return 0


def self_test() -> int:
    """在临时树里钉住检测器的漏报与误报边界，以及比较器的两种红因。"""
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        api = root / "web" / "app" / "api" / "v1"
        (api / "hit").mkdir(parents=True)
        (api / "miss").mkdir(parents=True)

        # 应被计入：内联信封 + 跨行信封（两种写法真实存在，各占 63 / 36）
        (api / "hit" / "route.ts").write_text(
            "export async function GET() {\n"
            "  return NextResponse.json({ code: 0, data: [], message: \"OK\" });\n"
            "}\n"
            "export async function POST() {\n"
            "  return NextResponse.json({\n"
            "    code: 0,\n"
            "    data: null,\n"
            "  });\n"
            "}\n",
            encoding="utf-8",
        )
        # 不应被计入：属性访问 / 非 0 值 / 注释行（注释占了朴素 grep 的 18/117）
        (api / "miss" / "route.ts").write_text(
            "// 输出：{ code: 0, data: { summary: string } }\n"
            "export async function GET() {\n"
            "  const e = err.code: 0;\n"
            "  return NextResponse.json({ code: 200, data: null });\n"
            "}\n"
            "/* code: 0 */\n"
            " * 返回 { code: 0, data, message } 信封格式。\n",
            encoding="utf-8",
        )

        got = scan(api, root)
        expected = {"web/app/api/v1/hit/route.ts": 2}
        if got != expected:
            print("SELF-TEST FAIL: 检测器口径不对")
            print(f"  期望 {expected}")
            print(f"  实际 {got}")
            return 2

        # 比较器：两种红因 + 一种收敛提示
        reds, shrink, _ = compare(
            {"a/route.ts": 2, "b/route.ts": 1},
            {"b/route.ts": 3, "c/route.ts": 1},
        )
        if not any("NEW_FILE" in r and "a/route.ts" in r for r in reds):
            print("SELF-TEST FAIL: 基线外的文件未被判红（NEW_FILE 检测失效）")
            for r in reds:
                print("  " + r)
            return 2
        if any("B" in r for r in reds):
            print("SELF-TEST FAIL: 减少的条目被误判成红（会卡住修的人）")
            return 2
        if not any("b/route.ts" in s for s in shrink):
            print("SELF-TEST FAIL: 处数减少未产生收敛提示")
            return 2

        reds2, _, _ = compare({"b/route.ts": 4}, {"b/route.ts": 3})
        if not any("REGRESSION" in r for r in reds2):
            print("SELF-TEST FAIL: 处数变多未被判红（REGRESSION 检测失效）")
            return 2

    print("SELF-TEST PASS: 命中真实信封 / 排除属性访问与注释 / NEW_FILE 与 REGRESSION 均判红 / 减少不判红")
    return 0


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()
    if "--emit" in sys.argv:
        return emit(scan(API_DIR))
    return run()


if __name__ == "__main__":
    sys.exit(main())
