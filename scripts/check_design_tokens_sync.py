#!/usr/bin/env python3
"""design-tokens.css 同步门禁。

背景（2026-10-04 实测）：
    Token 的唯一定义层是 `design/design-tokens.css`，经 predev/prebuild 同步到
    `web/app/design-tokens.css`（Next.js Turbopack 无法解析项目根之外的路径）。
    `web/app/design-tokens.css` 因此**必须入库**——Dockerfile 的构建上下文是
    `./web`，拿不到仓库根的 `design/`，只能 `COPY . .` 复用已存在的副本
    （见 web/Dockerfile:42-43）。

    问题：这两份文件会静默漂移。实测漂移量曾达 **521 行**，且
    `design/` 源文件还因 `core.autocrlf` 变成 CRLF，导致 `next build` 报
    `CssSyntaxError: Missed semicolon`。

判据：
    1. 两份文件**字节内容必须完全一致**
    2. 两份文件**都必须为 LF 行尾**（Tailwind v4 的 @import 内联对 CRLF 敏感）

用法：
    python scripts/check_design_tokens_sync.py
    python scripts/check_design_tokens_sync.py --fix   # 自动从 design/ 同步到 app/
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "design" / "design-tokens.css"
TARGET = ROOT / "web" / "app" / "design-tokens.css"


def has_crlf(path: Path) -> bool:
    return b"\r\n" in path.read_bytes()


def main() -> int:
    fix = "--fix" in sys.argv

    for p in (SOURCE, TARGET):
        if not p.exists():
            print(f"[tokens] ✗ 文件不存在：{p.relative_to(ROOT)}")
            return 1

    src_bytes = SOURCE.read_bytes()
    tgt_bytes = TARGET.read_bytes()

    # --fix：以 design/ 为唯一真源，覆盖 web/app/ 副本
    if fix:
        if src_bytes != tgt_bytes:
            shutil.copyfile(SOURCE, TARGET)
            print("[tokens] 已从 design/ 同步到 web/app/")
            tgt_bytes = TARGET.read_bytes()

    problems: list[str] = []

    if src_bytes != tgt_bytes:
        src_lines = src_bytes.count(b"\n")
        tgt_lines = tgt_bytes.count(b"\n")
        problems.append(
            f"两份文件内容不一致（源 {len(src_bytes)} 字节/{src_lines} 行，"
            f"副本 {len(tgt_bytes)} 字节/{tgt_lines} 行）"
        )

    for label, p in (("源 design/", SOURCE), ("副本 web/app/", TARGET)):
        if has_crlf(p):
            problems.append(f"{label} 含 CRLF 行尾（Tailwind v4 内联 @import 时会导致构建失败）")

    if problems:
        print("[tokens] ✗ design-tokens.css 同步检查未通过：")
        for p in problems:
            print(f"    - {p}")
        print(
            "\n修复：python scripts/check_design_tokens_sync.py --fix\n"
            "说明：design/design-tokens.css 是唯一真源，web/app/ 下是构建用副本，"
            "两者必须逐字节一致且均为 LF。"
        )
        return 1

    print("[tokens] ✓ 通过：design/ 与 web/app/ 逐字节一致，且均为 LF 行尾")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
