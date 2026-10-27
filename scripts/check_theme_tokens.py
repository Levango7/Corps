#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""@theme ↔ design-tokens 一致性门禁（设计方案 §7.2 第 1 步配套）。

## 为什么需要

`web/app/globals.css` 的 `@theme inline` 把语义 token 映射成 Tailwind 命名空间，
让 `bg-surface` / `text-fg` 这类类存在。但它有一个**静默失败**模式：

    写成 `--color-surface: var(--surfce);`（拼错），Tailwind 照样生成 `.bg-surface`，
    只是值是 `var(--surfce)` —— 浏览器解析失败 → 背景色静默变透明。
    构建不报错、类型检查不报错、单测（jsdom 不过 CSS）也不报错。

所以这里做静态一致性：**每个别名右侧的 token 必须在 design-tokens.css 里真实定义**。

## 诚实边界（别把它当"类一定能生成"的证明）

本门禁只证明「别名指向真实 token」。它**不**证明 Tailwind 真的产出了这条工具类
（命名空间写错、`@theme` 放错位置、插件顺序变化都可能让类不生成，而本脚本看不出来）。
那一层由 e2e 里读 computed style 的断言覆盖（B1b 的 a11y-core spec）。两层各管一段，
不要用其中一层的绿灯去替另一层背书。

## 红因

  THEME_BLOCK_MISSING   globals.css 里找不到 `@theme inline { ... }`
  THEME_DANGLING_ALIAS  别名的 var() 指向 design-tokens.css 里不存在的 token
  THEME_SELF_REFERENCE  别名的右侧与自身同名（`--color-x: var(--color-x)` 自指）
  THEME_DUPLICATE       同一个别名声明了两次（后者静默覆盖前者）
  THEME_FLOOR_MISSING   必需语义别名缺失（核心色/阴影不许无声消失）

用法：
  python scripts/check_theme_tokens.py            # 校验
  python scripts/check_theme_tokens.py --self-test  # 注入变异自检（4 个红因各一条）
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GLOBALS = ROOT / "web" / "app" / "globals.css"
TOKENS = ROOT / "design" / "design-tokens.css"

# 核心语义别名：删掉它们等于把设计系统的一部分无声拿走，必须显式走 PR
REQUIRED_ALIASES = [
    "--color-bg",
    "--color-surface",
    "--color-fg",
    "--color-muted",
    "--color-border",
    "--color-accent",
    "--color-accent-fg",
    "--color-danger",
    "--color-success",
    "--color-warn",
    "--shadow-sm",
    "--shadow-md",
]

ALIAS_RE = re.compile(r"^\s*(--[a-z0-9-]+)\s*:\s*var\(\s*(--[a-z0-9-]+)\s*\)\s*;", re.MULTILINE)


def extract_theme_block(css: str) -> str | None:
    """取出第一个 `@theme inline { ... }` 的花括号内容（按括号计数，允许嵌套）。"""
    m = re.search(r"@theme\b[^{]*\{", css)
    if not m:
        return None
    i = m.end()
    depth = 1
    start = i
    while i < len(css) and depth > 0:
        if css[i] == "{":
            depth += 1
        elif css[i] == "}":
            depth -= 1
        i += 1
    return css[start : i - 1]


def parse_aliases(block: str) -> list[tuple[str, str]]:
    return [(m.group(1), m.group(2)) for m in ALIAS_RE.finditer(block)]


def parse_token_names(css: str) -> set[str]:
    return set(re.findall(r"^\s*(--[a-z0-9-]+)\s*:", css, re.MULTILINE))


def check(aliases: list[tuple[str, str]], tokens: set[str]) -> list[str]:
    problems: list[str] = []
    seen: set[str] = set()

    for alias, target in aliases:
        if alias == target:
            problems.append(f"THEME_SELF_REFERENCE {alias} 指向自身")
        if target not in tokens:
            problems.append(f"THEME_DANGLING_ALIAS {alias} -> {target}（design-tokens.css 里没有这个 token）")
        if alias in seen:
            problems.append(f"THEME_DUPLICATE {alias} 重复声明")
        seen.add(alias)

    for required in REQUIRED_ALIASES:
        if required not in seen:
            problems.append(f"THEME_FLOOR_MISSING 必需别名缺失：{required}")

    return problems


def run(globals_css: str, tokens_css: str) -> list[str]:
    block = extract_theme_block(globals_css)
    if block is None:
        return ["THEME_BLOCK_MISSING globals.css 里没有 @theme 块"]
    return check(parse_aliases(block), parse_token_names(tokens_css))


def fatal(code: str, detail: str) -> int:
    print(f"FAIL: {code} {detail}")
    return 1


def main() -> int:
    if not GLOBALS.exists():
        return fatal("FILE_MISSING", str(GLOBALS))
    if not TOKENS.exists():
        return fatal("FILE_MISSING", str(TOKENS))

    globals_css = GLOBALS.read_text(encoding="utf-8")
    tokens_css = TOKENS.read_text(encoding="utf-8")

    if "--self-test" in sys.argv:
        # 基线夹具必须**声明全部必需别名**，否则它自己就会触发 THEME_FLOOR_MISSING，
        # 于是"基线应通过"这条会假红——自检夹具写错比门禁写错更难发现，所以这里按
        # REQUIRED_ALIASES 现生成，而不是手抄一份会漂移的样例。
        def token_for(alias: str) -> str:
            if alias.startswith("--color-"):
                return f"--{alias[len('--color-') :]}"
            if alias.startswith("--shadow-"):
                return f"--elev-{alias[len('--shadow-') :]}"
            return alias

        good_tokens = "".join(f"{token_for(a)}: 0;\n" for a in REQUIRED_ALIASES)
        full_globals = "@theme inline {\n" + "".join(
            f"  {a}: var({token_for(a)});\n" for a in REQUIRED_ALIASES
        ) + "}\n"
        cases: list[tuple[str, str, set[str]]] = [
            ("基线（应通过）", full_globals, set()),
            ("缺 @theme 块", "/* nothing */", {"THEME_BLOCK_MISSING"}),
            (
                "悬空别名",
                "@theme inline {\n  --color-bg: var(--bgx);\n}\n",
                {"THEME_DANGLING_ALIAS"},
            ),
            (
                "自指",
                "@theme inline {\n  --color-bg: var(--color-bg);\n}\n",
                {"THEME_SELF_REFERENCE"},
            ),
            (
                "重复声明",
                "@theme inline {\n  --color-bg: var(--bg);\n  --color-bg: var(--surface);\n}\n",
                {"THEME_DUPLICATE"},
            ),
            (
                "缺必需别名",
                "@theme inline {\n  --foo: var(--bg);\n}\n",
                {"THEME_FLOOR_MISSING"},
            ),
        ]
        ok = True
        for name, gcss, expect in cases:
            got = set(run(gcss, good_tokens))
            got_codes = {p.split(" ")[0] for p in got}
            if expect and not expect.issubset(got_codes):
                print(f"  FAIL  {name}：期望 {sorted(expect)}，实得 {sorted(got_codes)}")
                ok = False
            elif not expect and got:
                print(f"  FAIL  {name}：期望无问题，实得 {got}")
                ok = False
            else:
                print(f"  OK    {name} -> {sorted(got_codes) if expect else '无红因'}")
        # 基线样例必须包含全部必需别名才能判绿——这里单独证明"缺一个就红"
        print("self-test", "PASS" if ok else "FAIL")
        return 0 if ok else 1

    problems = run(globals_css, tokens_css)
    aliases = parse_aliases(extract_theme_block(globals_css) or "")
    if problems:
        for p in problems:
            print(f"  {p}")
        print(f"FAIL: {len(problems)} 项 @theme 一致性问题")
        return 1

    print(f"PASS: @theme 别名 {len(aliases)} 条，全部指向 design-tokens.css 中真实存在的 token")
    return 0


if __name__ == "__main__":
    sys.exit(main())
