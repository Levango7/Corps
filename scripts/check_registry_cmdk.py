#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
check_registry_cmdk.py — 「模块注册表 → Cmd+K」单向包含门禁

判据（动态读两份清单，绝不冻结成常量/基线）：
    {registry.ts WORKSPACE_MODULES 的 path 归一化} ⊆ {CommandPalette.tsx navItems 的 href 归一化}

## 背景

web/lib/modules/registry.ts 自述是「布局 / Cmd+K / 设置页唯一事实源」，但
web/components/CommandPalette.tsx 实际在 useMemo 里硬编码了第二份 navItems 清单，
两者并未真正复用。有人只改注册表、漏改命令面板时（在途 PR #315 把 meetings 整项
换成 remote-control，23 个改动文件里没有 CommandPalette.tsx），新增模块在 Cmd+K
里到不了；而既有 check_nav_coverage.py 取三份壳层清单的**并集**判「孤儿」，并集
永远含旧入口，全绿抓不到这类漂移。本门禁补「单向包含」这条线。

## 口径（务必看清楚，别把它当万能）

- 只比**归一化后的路由 segment 集合**：registry.path 的 "" / "/xxx" 对应 navItems
  href 去掉 `/w/${wid}` 前缀后的 "" / "/xxx"。
- 单向：只要求 registry ⊆ Cmd+K。反向（Cmd+K 多出的项）**刻意不判** —— #300 接线时
  Cmd+K 有意多了 ai-usage / assistant 两项产品差异，判双向会常年红。
- 刻意不比：id（nav-* 前缀 vs 裸 id，全不同）、icon（键名字符串 vs lucide 组件引用）、
  titleKey/labelKey（menu.* vs nav.menu.* 命名空间前缀不同，原样相等 0/31）、顺序、
  viewerHidden、exact、group。这些比了会 31 项全红，且都不是「入口在不在」的事实。
- 必须先从 CommandPalette.tsx **精确切出 navItems 数组**再解析，且在该段内只认
  `kind:"nav"` + `id` 前缀 `nav-` 的对象。否则搜索结果项（useEffect 里 map 出的项）、
  文件其它 href 字面量、注释里的 `/w/${wid}/self` 自引用会被误算成入口，让漏挂的
  模块「被兜住」而判绿。registry 侧同样只切 WORKSPACE_MODULES 数组，避免把
  moduleHref() 里的模板字符串等误算。

## 零存量 → 硬失败，不上棘轮

origin/main 现状 registry 31 项、Cmd+K 33 项，单向包含成立（31/31）。零存量时上
棘轮是浪费，故直接硬失败。若将来出现合法的无 Cmd+K 入口模块，不要删门禁、不要塞
隐藏基线文件，在 ALLOWED_MISSING_IN_CMDK 显式登记并写清理由（可见、可审计）。

## 过渡护栏，不替代根因修复

真正的修复是让 CommandPalette 复用 registry 这一份事实源，从根上消灭第二份清单。
本门禁只是过渡护栏：它保证「注册表里的模块在命令面板点得到」，不保证翻译键、图标、
分组、权限、页面是否真的存在，也不替代 code review。根因修复不在本批。

## 退出码

- 0：registry ⊆ Cmd+K（所有注册模块在命令面板都有入口）
- 1：registry 有模块在 Cmd+K 里缺失（未登记豁免）
- 2：源缺失 / 不可读 / 解析出空清单，或 --self-test 未按预期变红回绿
  （缺文件判红而非静默跳过 —— 静默跳过等于一条永远绿的空门禁）

## 自检（--self-test）

在临时构造的两份 mini 清单上验证 8 场景；红场景用**精确集合**断言，保证比较器被
改成恒空、或豁免集被改成全放行时，自检自身会失败（门禁自己也要被门禁）。
"""

from __future__ import annotations

import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# 显式可审计豁免口：当前为空。将来要加必须在此写明理由，不许改判定逻辑绕过。
# 用途：极少数「注册表有模块、但产品上刻意不给 Cmd+K 入口」的情形；登记即留痕。
# 绝不放基线文件、绝不写当前 31 项清单 —— 那是把判据冻结成假绿（#315 合入后
# 仍是 31 项但内容已变）。参照 check_nav_coverage.py 的 ALLOWED_ORPHANS。
ALLOWED_MISSING_IN_CMDK: frozenset[str] = frozenset()

REGISTRY_REL = Path("web/lib/modules/registry.ts")
CMDK_REL = Path("web/components/CommandPalette.tsx")

RE_REGISTRY_ARRAY = re.compile(r"export\s+const\s+WORKSPACE_MODULES\b[^=]*=\s*\[")
RE_CMDK_ARRAY = re.compile(r"\bconst\s+navItems\b[^=]*=\s*\[")
RE_REGISTRY_PATH = re.compile(r'\bpath\s*:\s*"([^"]*)"')
RE_OBJ_ID = re.compile(r'\bid\s*:\s*"([^"]*)"')
RE_OBJ_KIND = re.compile(r'\bkind\s*:\s*"([^"]*)"')
RE_OBJ_HREF = re.compile(r"\bhref\s*:\s*`([^`]*)`")
# href 模板形态：/w/${xxx} 或 /w/${xxx}/... → 取出 /... 相对段
RE_HREF_PREFIX = re.compile(r"^/w/\$\{[^}]+\}(/.*)?$")


class MissingSource(Exception):
    """事实源缺失 / 不可读 / 解析异常：判红，不静默跳过。"""


def _scan_delimited(text: str, start: int, opener: str, closer: str) -> tuple[str, int]:
    """从 text[start] == opener 起，跳过字符串/模板字符串/注释，返回配对内容与结束下标。"""
    depth = 1
    i = start + 1
    n = len(text)
    while i < n and depth:
        c = text[i]
        if c == "/" and i + 1 < n and text[i + 1] == "/":
            j = text.find("\n", i)
            i = n if j < 0 else j + 1
            continue
        if c == "/" and i + 1 < n and text[i + 1] == "*":
            j = text.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        if c in ('"', "'", "`"):
            quote = c
            i += 1
            while i < n:
                if text[i] == "\\":
                    i += 2
                    continue
                if text[i] == quote:
                    i += 1
                    break
                i += 1
            continue
        if c == opener:
            depth += 1
        elif c == closer:
            depth -= 1
            if depth == 0:
                return text[start + 1 : i], i
        i += 1
    raise MissingSource(f"括号不配对：{opener}...{closer}")


def _strip_comments(text: str) -> str:
    """去掉 // 与 /* */ 注释，但完整保留字符串/模板字符串内容（含 `${wid}`）。"""
    out: list[str] = []
    i = 0
    n = len(text)
    while i < n:
        c = text[i]
        if c == "/" and i + 1 < n and text[i + 1] == "/":
            j = text.find("\n", i)
            if j < 0:
                i = n
            else:
                out.append("\n")
                i = j + 1
            continue
        if c == "/" and i + 1 < n and text[i + 1] == "*":
            j = text.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        if c in ('"', "'", "`"):
            quote = c
            start = i
            i += 1
            while i < n:
                if text[i] == "\\":
                    i += 2
                    continue
                if text[i] == quote:
                    i += 1
                    break
                i += 1
            out.append(text[start:i])
            continue
        out.append(c)
        i += 1
    return "".join(out)


def _extract_array(text: str, pattern: re.Pattern[str]) -> str:
    """按声明锚点找到数组字面量，精确切出其（已去注释的）内容。"""
    m = pattern.search(text)
    if not m:
        raise MissingSource(f"找不到数组声明（{pattern.pattern[:48]}）")
    bracket = m.end() - 1
    if bracket < 0 or text[bracket] != "[":
        raise MissingSource("数组声明后不是 '['")
    content, _ = _scan_delimited(text, bracket, "[", "]")
    return _strip_comments(content)


def _split_objects(clean_text: str) -> list[str]:
    """把（已去注释的）数组文本按顶层 { ... } 切成对象文本列表。"""
    objects: list[str] = []
    i = 0
    n = len(clean_text)
    while i < n:
        c = clean_text[i]
        if c in ('"', "'", "`"):
            quote = c
            i += 1
            while i < n:
                if clean_text[i] == "\\":
                    i += 2
                    continue
                if clean_text[i] == quote:
                    i += 1
                    break
                i += 1
            continue
        if c == "{":
            content, end = _scan_delimited(clean_text, i, "{", "}")
            objects.append(content)
            i = end + 1
            continue
        i += 1
    return objects


def _normalize_registry_path(path: str) -> str:
    p = path.strip()
    if not p:
        return ""
    if not p.startswith("/"):
        p = "/" + p
    return p.rstrip("/")


def _normalize_href(template: str) -> str | None:
    m = RE_HREF_PREFIX.match(template.strip())
    if not m:
        return None
    return (m.group(1) or "").rstrip("/")


def parse_registry_paths(text: str) -> set[str]:
    arr = _extract_array(text, RE_REGISTRY_ARRAY)
    return {_normalize_registry_path(p) for p in RE_REGISTRY_PATH.findall(arr)}


def parse_cmdk_segments(text: str) -> set[str]:
    arr = _extract_array(text, RE_CMDK_ARRAY)
    segments: set[str] = set()
    for obj in _split_objects(arr):
        id_m = RE_OBJ_ID.search(obj)
        kind_m = RE_OBJ_KIND.search(obj)
        href_m = RE_OBJ_HREF.search(obj)
        if not (id_m and kind_m and href_m):
            continue
        if not id_m.group(1).startswith("nav-"):
            continue
        if kind_m.group(1) != "nav":
            continue
        segment = _normalize_href(href_m.group(1))
        if segment is None:
            continue
        segments.add(segment)
    return segments


def missing_segments(
    registry_segments: set[str],
    cmdk_segments: set[str],
    allowed: frozenset[str] = ALLOWED_MISSING_IN_CMDK,
) -> list[str]:
    """单向包含的差集：registry 里既不在 Cmd+K、又未登记豁免的 segment。"""
    return sorted(
        s for s in registry_segments if s not in cmdk_segments and s not in allowed
    )


def run_gate(root: Path) -> int:
    reg_path = root / REGISTRY_REL
    cmdk_path = root / CMDK_REL
    try:
        reg_text = reg_path.read_text(encoding="utf-8")
        cmdk_text = cmdk_path.read_text(encoding="utf-8")
    except OSError as exc:
        print(f"FAIL: 事实源缺失或不可读（{exc}）")
        return 2
    try:
        registry_segments = parse_registry_paths(reg_text)
        cmdk_segments = parse_cmdk_segments(cmdk_text)
    except MissingSource as exc:
        print(f"FAIL: {exc}")
        return 2
    if not registry_segments:
        print("FAIL: registry 解析出 0 个模块（拒绝空门禁 / 解析器失真）")
        return 2
    missing = missing_segments(registry_segments, cmdk_segments)
    print(
        f"registry 模块 {len(registry_segments)} 个，Cmd+K nav 入口 {len(cmdk_segments)} 个，"
        f"豁免登记 {len(ALLOWED_MISSING_IN_CMDK)} 项（ALLOWED_MISSING_IN_CMDK，显式可审计）"
    )
    if missing:
        print(
            f"FAIL: registry ⊆ Cmd+K 不成立，{len(missing)} 个注册模块在命令面板缺入口："
        )
        for seg in missing:
            print(f"  - {seg or '(根 /w/${wid})'}")
        print("  修法：在 CommandPalette.tsx 的 navItems 里补挂对应 href；")
        print("        若确属刻意不给 Cmd+K 入口，在 ALLOWED_MISSING_IN_CMDK 登记并写明理由。")
        return 1
    print("PASS: registry ⊆ Cmd+K 成立（所有注册模块在命令面板都有入口）")
    return 0


# ---------------------------------------------------------------------------
# --self-test：mini 清单构造 + 8 场景 + 精确集合断言
# ---------------------------------------------------------------------------

def _reg_text(paths: list[str], labelkey: str = "menu.x") -> str:
    items = ", ".join(
        f'{{ id: "m{i}", path: "{p}", labelKey: "{labelkey}", icon: "x", group: "core" }}'
        for i, p in enumerate(paths)
    )
    return (
        "export const WORKSPACE_MODULES: readonly WorkspaceModule[] = [\n  "
        + items
        + "\n];\n"
    )


def _cmd_text(
    hrefs: list[str],
    extra_items: str = "",
    titlekey: str = "nav.menu.x",
) -> str:
    objs = [
        f'{{ id: "nav-x{i}", titleKey: "{titlekey}", kind: "nav", href: `{h}`, icon: X }}'
        for i, h in enumerate(hrefs)
    ]
    body = ",\n      ".join(objs)
    if extra_items:
        body += ",\n      " + extra_items
    return (
        "export default function CP() {\n"
        "  const items = useMemo<CmdItem[]>(() => {\n"
        "    const navItems: CmdItem[] = [\n      "
        + body
        + "\n    ];\n    return navItems;\n  }, []);\n}\n"
    )


def _probe(
    reg_paths: list[str],
    hrefs: list[str],
    extra_items: str = "",
    titlekey: str = "nav.menu.x",
    allowed: frozenset[str] | None = None,
) -> tuple[set[str], set[str], list[str]]:
    reg = parse_registry_paths(_reg_text(reg_paths))
    cmd = parse_cmdk_segments(_cmd_text(hrefs, extra_items, titlekey))
    miss = missing_segments(
        reg, cmd, ALLOWED_MISSING_IN_CMDK if allowed is None else allowed
    )
    return reg, cmd, miss


def self_test() -> int:
    """反向测试：违规样本必须变红、干净样本必须回绿、缺源必须判 2。"""
    failures: list[str] = []

    def check(label: str, got: object, expected: object) -> None:
        if got != expected:
            failures.append(f"{label}: expected {expected!r}, got {got!r}")

    # ① 干净树绿（含 path:"" ↔ href:`/w/${wid}` 根项归一化）
    r1, c1, m1 = _probe(
        ["", "/board", "/meetings"],
        ["/w/${wid}", "/w/${wid}/board", "/w/${wid}/meetings"],
    )
    check("① clean tree incl. root must PASS", m1, [])
    check("① root segment present in both sides", ("" in r1, "" in c1), (True, True))

    # ② registry 新增模块、Cmd+K 漏挂 → 红
    _, _, m2 = _probe(
        ["", "/board", "/new-mod"],
        ["/w/${wid}", "/w/${wid}/board"],
    )
    check("② new registry module missing in Cmd+K must FAIL", m2, ["/new-mod"])

    # ③ registry 把 path 改名（/meetings→/remote-control）、Cmd+K 仍旧 → 红（#315 形态）
    _, _, m3 = _probe(
        ["", "/board", "/remote-control"],
        ["/w/${wid}", "/w/${wid}/board", "/w/${wid}/meetings"],
    )
    check("③ renamed registry path still pointing at old Cmd+K must FAIL", m3, ["/remote-control"])

    # ④ Cmd+K 单方面多项（#300 有意差异）→ 仍绿
    _, _, m4 = _probe(
        ["", "/board"],
        ["/w/${wid}", "/w/${wid}/board", "/w/${wid}/ai-usage", "/w/${wid}/assistant"],
    )
    check("④ Cmd+K-only extra items must STILL PASS", m4, [])

    # ⑤ menu.* / nav.menu.* 命名空间差异不判红（key 根本不参与比较）
    _, _, m5 = _probe(
        ["", "/board"],
        ["/w/${wid}", "/w/${wid}/board"],
        titlekey="completely.different.namespace",
    )
    check("⑤ labelKey/titleKey namespace diff must NOT fail", m5, [])

    # ⑥ 种入 kind:"document" 搜索结果项 + id 非 nav- 项 + 注释内自引用 → 清单不变
    inject = (
        "// 自引用 `/w/${wid}/self` 不算 Cmd+K 入口\n"
        "      { id: \"nav-ghost\", titleKey: \"x\", kind: \"document\", href: `/w/${wid}/ghost`, icon: X },\n"
        "      { id: \"search-1\", titleKey: \"x\", kind: \"nav\", href: `/w/${wid}/ghost`, icon: X }"
    )
    r6, c6, m6 = _probe(
        ["", "/board", "/ghost"],
        ["/w/${wid}", "/w/${wid}/board"],
        extra_items=inject,
    )
    check("⑥ injected document / search / comment items must NOT count", m6, ["/ghost"])
    check("⑥ cmdk set unchanged by injections", "/ghost" in c6, False)

    # ⑦ 源缺失 → exit 2（真实子进程测 CLI 退出码，不静默跳过）
    with tempfile.TemporaryDirectory() as tmp:
        empty_root = Path(tmp) / "empty_root"
        empty_root.mkdir()
        proc = subprocess.run(
            [sys.executable, str(Path(__file__).resolve()), "--root", str(empty_root)],
            capture_output=True,
            text=True,
        )
        check("⑦ missing source must exit 2", proc.returncode, 2)

    # ⑧ 红因集合精确等于预期（多项缺失，不多不少）
    _, _, m8 = _probe(
        ["", "/a", "/b", "/c"],
        ["/w/${wid}", "/w/${wid}/a"],
    )
    check("⑧ missing set exactly {/b, /c}", m8, ["/b", "/c"])

    # ⑧b 豁免语义：只豁免明确列入的项（防「豁免集改成全放行」变异让自检失真）
    _, _, m8b = _probe(["/a", "/b"], [], allowed=frozenset({"/a"}))
    check("⑧b allowlist exempts only the listed item", m8b, ["/b"])

    if failures:
        print("SELF-TEST FAIL（门禁自身失真，禁止上线）:")
        for item in failures:
            print(f"  - {item}")
        return 2
    print(
        "SELF-TEST PASS: 9/9 断言通过（①干净树含根项绿 / ②漏挂红 / ③改名红 / "
        "④Cmd+K多项仍绿 / ⑤命名空间差异不判红 / ⑥种入项不计 / ⑦缺源判2 / "
        "⑧红因集合精确 / ⑧b豁免语义）；比较器恒空或豁免全放行都会让红场景断言失败"
    )
    return 0


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()
    root = ROOT
    if "--root" in sys.argv:
        i = sys.argv.index("--root")
        if i + 1 >= len(sys.argv):
            print("FAIL: --root 缺少路径参数")
            return 2
        root = Path(sys.argv[i + 1])
    return run_gate(root)


if __name__ == "__main__":
    raise SystemExit(main())
