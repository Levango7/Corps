#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
check_nav_coverage.py — 顶层页面「有页面却无入口」防回归门禁

背景（#300 接线批的收尾）：
2026-11-08 之前 ai-usage / assistant 是典型孤儿：有 page.tsx、有 API、有 i18n，
但侧栏注册表与 Cmd+K 都没挂，用户到不了。#300 把它们接进 Cmd+K 末尾两项后才
发现：全仓没有任何门禁检查「新增顶层页面有没有入口」，下一次照样能合进一个
谁也点不到的页面。本门禁补这条线。

## 为什么入口只认三份壳层清单

入口事实源固定为：
  - web/lib/modules/registry.ts            侧栏 / 设置 / 模块可见性的唯一事实源
  - web/components/CommandPalette.tsx      Cmd+K 全功能直达
  - web/app/[locale]/w/[wid]/layout.tsx    顶栏铃铛等壳层硬编码链接

第三份不能漏：notifications 页面既不在注册表也不在 Cmd+K，它走 layout.tsx:340
的 notifHref。只读探针若只认前两份，会把它误报成孤儿；若照那个口径上基线，
等于把「本来可达」的页面钉成永久豁免，门禁反而固化了口径盲区。

反过来也不能全仓扫：任何页面都能写一句 /w/${wid}/self 自引用，全仓扫会让
「新增孤儿」永远判绿，门禁自我失效。所以只认这三份由导航 / 壳层维护的清单。

## 扫描口径与刻意不做的

- 扫描对象：web/app/[locale]/w/[wid]/<segment>/page.tsx 的静态一级目录。
  含 [ 的动态段（[aid] 等）与根 page.tsx（overview）都不算 —— 前者是详情页，
  后者是工作区首页本身。
- 二级静态页（settings/permissions、settings/calendar）**不在本门禁口径内**：
  它们由父页 Tab / 组件链接进入，判定需要另一套父级链接口径。这两页目前确实
  无导航入口，已由 docs/design/DEAD-MODULES.md §2 登记为 P1 人工项。本门禁
  绿灯不代表二级页也安全，别把「33/33」误读成「全站没有藏起来的页面」。
- 不判「入口指向不存在的页面」（悬空入口）与入口重复：那是另一个缺陷类，
  若将来要做，另起门禁，别把口径悄悄塞进这里。

## 为什么是硬失败而不是基线棘轮

main 现状实测 33 个顶层静态页面、孤儿 0（#300 接线后，且把 layout.tsx 计入）。
零存量时上棘轮是浪费 —— 直接硬失败，新增孤儿零容忍。若将来真出现合法的无壳层
入口页面（OAuth 回跳落地页之类），不要删门禁，在 ALLOWED_ORPHANS 显式登记并
写清理由；那样豁免是可见的、可审计的，而不是藏在基线文件里。

## 退出码

- 0：无孤儿（所有顶层页面都能从三份壳层清单到达）
- 1：出现未登记孤儿
- 2：入口事实源文件缺失 / 不可读，或 --self-test 未按预期变红回绿
  （缺文件判红而非静默跳过 —— 静默跳过等于一条永远绿的空门禁）

## 自检（--self-test）：门禁自己也要被门禁

在临时目录种 mini 仓库树，按真实形态验证 5 个场景。三种入口形态各由
一个页面独立承担（board 只靠 Cmd+K、wiki 只靠 registry、notifications 只靠
layout），避免某个源失效时仍被别的源兜住而测不出来：
1. 三源齐备、页面全覆盖 → 必须绿
2. 新增一个无入口顶层页 → 必须红
3. 该新页内部写自引用链接 → 必须仍红（证明只认壳层事实源）
4. 把该页挂进 layout.tsx → 必须回绿（证明第三类入口被认可）
5. 删掉一份入口事实源 → 必须 exit 2（缺文件判红）
"""

from __future__ import annotations

import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# 显式豁免：当前为空。将来要加必须在这里写明理由，不许改判定逻辑绕过。
ALLOWED_ORPHANS: frozenset[str] = frozenset()

# registry.ts 用 path: "/xxx" 形态；另两份用模板字符串 /w/${wid}/xxx 形态。
RE_REGISTRY_PATH = re.compile(r'\bpath:\s*"([^"]*)"')
RE_SHELL_LINK = re.compile(r'`\/w\/\$\{wid\}\/([^/`]+)')


class MissingSource(Exception):
    """入口事实源缺失 / 不可读：判红，不静默跳过。"""


def paths_for(root: Path) -> tuple[Path, tuple[Path, ...]]:
    pages = root / "web" / "app" / "[locale]" / "w" / "[wid]"
    sources = (
        root / "web" / "lib" / "modules" / "registry.ts",
        root / "web" / "components" / "CommandPalette.tsx",
        pages / "layout.tsx",
    )
    return pages, sources


def top_level_segments(pages_dir: Path) -> set[str]:
    if not pages_dir.is_dir():
        raise MissingSource(f"页面目录不存在：{pages_dir}")
    return {
        child.name
        for child in pages_dir.iterdir()
        if child.is_dir() and "[" not in child.name and (child / "page.tsx").is_file()
    }


def entry_segments(sources: tuple[Path, ...]) -> set[str]:
    found: set[str] = set()
    for source in sources:
        try:
            text = source.read_text(encoding="utf-8")
        except OSError as exc:
            raise MissingSource(f"入口事实源缺失或不可读：{source}（{exc}）") from exc
        for value in RE_REGISTRY_PATH.findall(text):
            seg = value.lstrip("/").split("/")[0]
            if seg:
                found.add(seg)
        found.update(RE_SHELL_LINK.findall(text))
    return found


def collect_orphans(root: Path) -> tuple[set[str], set[str], list[str]]:
    pages_dir, sources = paths_for(root)
    segments = top_level_segments(pages_dir)
    entries = entry_segments(sources)
    orphans = sorted(s for s in segments if s not in entries and s not in ALLOWED_ORPHANS)
    return segments, entries, orphans


def run_gate(root: Path) -> int:
    try:
        segments, entries, orphans = collect_orphans(root)
    except MissingSource as exc:
        print(f"FAIL: {exc}")
        return 2
    print(f"顶层静态页面 {len(segments)} 个，壳层入口 segment {len(entries)} 个")
    if orphans:
        print(f"FAIL: 发现 {len(orphans)} 个无入口顶层页面（三份壳层清单里都没有它）")
        for seg in orphans:
            print(f"  - {seg}  (web/app/[locale]/w/[wid]/{seg}/page.tsx)")
        print("  修法：把入口挂进 registry.ts / CommandPalette.tsx / layout.tsx 三者之一；")
        print("        若确属不该有壳层入口的页面，在 ALLOWED_ORPHANS 登记并写明理由。")
        return 1
    print("PASS: 顶层页面导航覆盖完整，无孤儿（防 #300 接线成果退化）")
    return 0


def _seed(
    root: Path,
    pages: dict[str, str],
    reg: str,
    cmd: str,
    lay: str,
    include_cmd: bool,
) -> None:
    pages_dir = root / "web" / "app" / "[locale]" / "w" / "[wid]"
    pages_dir.mkdir(parents=True, exist_ok=True)
    for seg, body in pages.items():
        sub = pages_dir / seg
        sub.mkdir(parents=True, exist_ok=True)
        (sub / "page.tsx").write_text(body, encoding="utf-8")
    (pages_dir / "layout.tsx").write_text(lay, encoding="utf-8")
    (root / "web" / "lib" / "modules").mkdir(parents=True, exist_ok=True)
    (root / "web" / "lib" / "modules" / "registry.ts").write_text(reg, encoding="utf-8")
    if include_cmd:
        (root / "web" / "components").mkdir(parents=True, exist_ok=True)
        (root / "web" / "components" / "CommandPalette.tsx").write_text(cmd, encoding="utf-8")


def self_test() -> int:
    """反向测试：违规样本必须变红，干净样本必须回绿，缺源必须判 2。"""
    failures: list[str] = []

    # 三种入口形态各由一个页面独立承担，互不兜底。
    reg = 'export const M = [{ path: "/wiki" }, { path: "" }];\n'
    cmd = "const navItems = [{ href: `/w/${wid}/board` }];\n"
    lay = "const notifHref = `/w/${wid}/notifications`;\n"
    stub = "export default function P() { return null; }\n"
    base: dict[str, str] = {
        "board": stub,
        "wiki": stub,
        "notifications": stub,
    }
    orphan = "new-feature"

    def probe(pages: dict[str, str], cmd_text: str, lay_text: str, include_cmd: bool = True) -> int:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _seed(root, pages, reg, cmd_text, lay_text, include_cmd)
            try:
                _, _, found = collect_orphans(root)
            except MissingSource:
                return 2
            return 1 if found else 0

    cases: list[tuple[str, int, int]] = [
        ("clean tree (3 sources each cover one page) must PASS", probe(base, cmd, lay), 0),
        (
            "new top-level page with no entry must FAIL",
            probe({**base, orphan: stub}, cmd, lay),
            1,
        ),
        (
            "self-reference inside the orphan page must STILL FAIL",
            probe({**base, orphan: "const self = `/w/${wid}/new-feature`;\n"}, cmd, lay),
            1,
        ),
        (
            "adding the page to layout.tsx must return to PASS",
            probe({**base, orphan: stub}, cmd, lay + "const x = `/w/${wid}/new-feature`;\n"),
            0,
        ),
        (
            "missing entry source must FAIL with exit 2",
            probe(base, cmd, lay, include_cmd=False),
            2,
        ),
    ]

    for label, got, expected in cases:
        if got != expected:
            failures.append(f"{label}: expected {expected}, got {got}")

    if failures:
        print("SELF-TEST FAIL（门禁自身失真，禁止上线）:")
        for item in failures:
            print(f"  - {item}")
        return 2
    print("SELF-TEST PASS: 5/5 变红回绿按预期（干净绿 / 新孤儿红 / 自引用仍红 / layout 补挂回绿 / 缺源判 2）")
    return 0


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()
    return run_gate(ROOT)


if __name__ == "__main__":
    raise SystemExit(main())
