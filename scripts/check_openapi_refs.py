#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
check_openapi_refs.py — api/openapi.yaml 内部 $ref 解析校验（仅标准库）

为什么需要它：check_api_contract.py 只比对「实际路由 vs path 声明」的差集，不看 $ref。
2026-10-30 实测：#218（契约第六批）带进 15 处悬空引用（14 个未定义的 Envelope_*
+ 1 处 schemas/InternalError 拼错为 responses/），yaml.safe_load 与正则契约检查都放行，
一路合进 main —— 客户端 codegen 拿到这种文件会直接报错。本脚本补这条线。

口径：
- 只校验 #/ 开头的内部引用；外部文件引用（相对路径）不在本文件职责内
- 组件名从 components 段收集：2 空格缩进是子段（schemas/parameters/responses/...），
  其下 4 空格缩进的键是该子段的一个定义
- 悬空引用即 FAIL，逐条列出 ref 与最多 3 处出现行号

自检（--self-test）：把文件复制到临时目录，注入一条悬空引用 → 必须因 DANGLE_REF 变红；
恢复原件 → 必须变绿。门禁自己也要被门禁。

退出码：0 通过；1 有悬空引用或结构异常；2 自检未按预期变红/变绿。
"""

from __future__ import annotations

import re
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OPENAPI_CANDIDATES = (
    ROOT / "api" / "openapi.yaml",
    ROOT / "web" / "app" / "api" / "openapi.yaml",
    ROOT / "docs" / "api" / "openapi.yaml",
)

SECTION_RE = re.compile(r"^  ([A-Za-z][A-Za-z0-9_]*):\s*$")
DEF_RE = re.compile(r"^    ([A-Za-z0-9_][A-Za-z0-9_.-]*):")
REF_RE = re.compile(r"\$ref:\s*['\"]#/components/([A-Za-z0-9_]+)/([A-Za-z0-9_.-]+)['\"]")


def find_openapi() -> Path | None:
    for cand in OPENAPI_CANDIDATES:
        if cand.exists():
            return cand
    return None


def collect_defs(lines: list[str]) -> tuple[dict[str, set[str]], int]:
    """返回 ({子段: {定义名}}, components 起始行号)。"""
    start = None
    for i, ln in enumerate(lines, start=1):
        if ln.rstrip("\n") == "components:":
            start = i
            break
    if start is None:
        return {}, -1
    defs: dict[str, set[str]] = {}
    cur: str | None = None
    for ln in lines[start:]:
        if ln.startswith("  ") and not ln.startswith("    "):
            m = SECTION_RE.match(ln)
            cur = m.group(1) if m else None
            if cur is not None:
                defs.setdefault(cur, set())
            continue
        if cur is None or not ln.startswith("    "):
            continue
        m = DEF_RE.match(ln)
        if m:
            defs[cur].add(m.group(1))
    return defs, start


def collect_refs(lines: list[str]) -> dict[tuple[str, str], list[int]]:
    """返回 {(子段, 名): [行号...]}。"""
    refs: dict[tuple[str, str], list[int]] = {}
    for i, ln in enumerate(lines, start=1):
        for m in REF_RE.finditer(ln):
            refs.setdefault((m.group(1), m.group(2)), []).append(i)
    return refs


def check_text(text: str) -> list[str]:
    """对给定文本跑校验，返回错误列表（空 = 通过）。"""
    lines = text.splitlines()
    defs, start = collect_defs(lines)
    if start < 0:
        return ["OPENAPI_STRUCTURE 未找到 components: 段"]
    errors: list[str] = []
    for (section, name), places in sorted(collect_refs(lines).items()):
        if section not in defs:
            errors.append(
                f"DANGLE_REF #/components/{section}/{name} —— 子段 '{section}' 在 components 下不存在"
                f"（首次出现 行 {places[0]}）"
            )
        elif name not in defs[section]:
            shown = ", ".join(f"行 {p}" for p in places[:3])
            more = f" 等 {len(places)} 处" if len(places) > 3 else ""
            errors.append(
                f"DANGLE_REF #/components/{section}/{name} —— 未定义（出现于 {shown}{more}）"
            )
    return errors


def run(path: Path) -> int:
    text = path.read_text(encoding="utf-8")
    errors = check_text(text)
    if errors:
        print(f"FAIL: {len(errors)} 处悬空 $ref —— {path}")
        for e in errors:
            print("  " + e)
        return 1
    print(f"PASS: 内部 $ref 全部可解析（{path}）")
    return 0


def self_test(path: Path) -> int:
    original = path.read_text(encoding="utf-8")
    with tempfile.TemporaryDirectory() as td:
        mutated = Path(td) / "openapi.yaml"
        # 注入一条必然悬空的引用（放在文件尾，不影响原有结构判断）
        mutated.write_text(
            original.rstrip("\n")
            + "\nx-self-test-ref:\n  $ref: '#/components/schemas/__NoSuchSchema__'\n",
            encoding="utf-8",
        )
        red = check_text(mutated.read_text(encoding="utf-8"))
        if not any("__NoSuchSchema__" in e for e in red):
            print("SELF-TEST FAIL: 注入的悬空引用未被捕获（门禁没在工作）")
            return 2
        green = check_text(original)
        if green:
            print("SELF-TEST FAIL: 原件本应通过，却报错：")
            for e in green:
                print("  " + e)
            return 2
    print("SELF-TEST PASS: 悬空引用变红 / 原件回绿")
    return 0


def main() -> int:
    path = find_openapi()
    if path is None:
        print("FAIL: 找不到 api/openapi.yaml")
        return 1
    if "--self-test" in sys.argv:
        return self_test(path)
    return run(path)


if __name__ == "__main__":
    sys.exit(main())
