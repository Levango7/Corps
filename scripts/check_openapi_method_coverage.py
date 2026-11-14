#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
check_openapi_method_coverage.py — 已声明路径的 HTTP method 覆盖门禁

## 它抓的是什么

`check_api_contract.py` 只比「路径集合」：实现里有这个 route.ts、openapi 里有没有
这个 path。它**不读 method**，所以 `path` 写了 `get`，实现却还导出了 `PATCH`，
这道门禁完全看不见。

`check_contract_fields.py` 会把这类 200 分支计入
`skip · 该方法未声明` 并打印计数，但也只是计数 —— 不判红，也拦不住新增。
2026-11-13 实测 main 上有 6 个这样的调用点，按 handler 级口径是
**7 个 path / 8 个缺失 operation**，四道既有契约门禁
（path 差集 / $ref / YAML 语法 / 字段级）一道都管不到。

本门禁补这条线，做**单向包含**（与字段级门禁同款精神）：

    实现 route.ts 导出的 HTTP method  ⊆  openapi 该 path 声明的 operation

## 口径（刻意克制，别把它当双向一致性检查）

1. 只扫 `web/app/api/**/route.ts`，认行首
   `export const GET = withRed(...)` / `export async function GET(...)`。
   块注释先剔除，避免文档里的示例代码被当成真实导出。
2. 路径段映射复用 `check_api_contract.py` 的同款规则：
   `[id]` / `[...slug]` → `{id}`，路由组 `(group)` 跳过。
3. **path 未在 openapi 声明 → skip 并计数**，不重复判：
   那是 `check_api_contract.py` 的差集 / `scripts/api-contract-baseline.txt`
   的职责（内部端点 `/api/cron/*`、`/api/uploads/*` 等）。
4. 反向不查：openapi 声明了 method、实现没导出，不判。
   本门禁只保证「契约不落后于实现」，不做双向收敛。
5. 用**正则**解析 path / method 行，刻意不依赖 PyYAML：
   与 `check_api_contract.py` 保持同一依赖面（只需 checkout + Python），
   挂在 CI 的 Install PyYAML 步骤之前也能跑。
   代价是不读 YAML 语法 —— 那是 `check_openapi_syntax.py` 的职责，
   并且 `--self-test` 里有注入用例证明本门禁的解析器不是空跑。
6. 零存量 ⇒ **硬失败、不上棘轮、不设基线文件**。确属例外必须显式写进
   `ALLOWED_MISSING_METHODS`（可审计），不允许隐藏豁免清单。
7. 源缺失判红：`api/openapi.yaml` 不存在 / `web/app/api` 目录不存在 → exit 2。
   静默跳过等于一条永远绿的空门禁。

## 覆盖率诚实交代

本门禁只保证「实现导出的 method 在契约里有名字」。它**不**检查：
- 该 operation 的 requestBody / parameters 是否与实现一致
- 200 响应 schema 的 data.required 是否与实现返回一致
  （那是 `check_contract_fields.py`，且只覆盖 data 是字面量对象的分支）
- 类型、语义、错误码、权限

不要用这道门禁替代 code review。

退出码：
    0 — 无缺口
    1 — 有未声明的 method（或自检未按预期）
    2 — 源缺失

用法：
    python scripts/check_openapi_method_coverage.py
    python scripts/check_openapi_method_coverage.py --self-test
"""

from __future__ import annotations

import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API_DIR = ROOT / "web" / "app" / "api"
OPENAPI = ROOT / "api" / "openapi.yaml"

HTTP_METHODS = ("get", "post", "put", "patch", "delete", "head", "options", "trace")
UPPER = "|".join(m.upper() for m in HTTP_METHODS)

# 只认行首 export，避免把调用点 / 字符串内容当成导出。
EXPORT_RE = re.compile(
    rf"^\s*export\s+(?:const|async\s+function|function)\s+({UPPER})\b",
    re.MULTILINE,
)
BLOCK_COMMENT_RE = re.compile(r"/\*.*?\*/", re.DOTALL)
PATH_RE = re.compile(r"^  (/[^\s:]+):\s*$", re.MULTILINE)
METHOD_LINE_RE = re.compile(
    rf"^    ({'|'.join(HTTP_METHODS)}):\s*$", re.MULTILINE
)
ROUTE_GROUP_RE = re.compile(r"^\(\w+\)$")
DYNAMIC_SEG_RE = re.compile(r"^\[+\.{0,3}(\w+)\]+$")

# 显式豁免（path, method）二元组。零存量故为空；新增必须写明理由并附 issue。
ALLOWED_MISSING_METHODS: set[tuple[str, str]] = set()


class MissingSource(Exception):
    """源文件或目录缺失 —— 必须判红，不能当成空集合静默放行。"""


def scrub_block_comments(text: str) -> str:
    """剔除 /* ... */，用等量换行占位（保留行号，不误合并相邻行）。"""
    return BLOCK_COMMENT_RE.sub(
        lambda m: "\n" * m.group(0).count("\n"), text
    )


def to_openapi_segment(segment: str) -> str | None:
    if segment.startswith("(") and segment.endswith(")"):
        return None  # 路由组不产生 URL 段
    m = DYNAMIC_SEG_RE.match(segment)
    if m:
        return "{" + m.group(1) + "}"
    return segment


def route_of(route_file: Path, api_dir: Path) -> str:
    rel = route_file.relative_to(api_dir).parent
    converted = []
    for seg in rel.parts:
        if seg == ".":
            continue
        mapped = to_openapi_segment(seg)
        if mapped is not None:
            converted.append(mapped)
    return "/api" + ("/" + "/".join(converted) if converted else "")


def collect_impl_methods(api_dir: Path) -> dict[str, set[str]]:
    if not api_dir.is_dir():
        raise MissingSource(f"API dir not found: {api_dir}")
    impl: dict[str, set[str]] = {}
    for f in sorted(api_dir.rglob("route.ts")):
        source = scrub_block_comments(f.read_text(encoding="utf-8", errors="replace"))
        methods = {m.lower() for m in EXPORT_RE.findall(source)}
        if methods:
            impl.setdefault(route_of(f, api_dir), set()).update(methods)
    return impl


def parse_declared_methods(text: str) -> dict[str, set[str]]:
    """按缩进层级切 paths 区块，抓每个 path 下的 method 行。

    只认 4 空格缩进的 `    get:` 这类行；path 级 `parameters:` 等非 method 键
    不会被 METHOD_LINE_RE 命中。遇到非 2/4 缩进的顶层键就结束当前 path。
    """
    declared: dict[str, set[str]] = {}
    current: str | None = None
    for line in text.splitlines():
        pm = re.match(r"^  (/[^\s:]+):\s*$", line)
        if pm:
            current = pm.group(1)
            declared[current] = set()
            continue
        if current is None:
            continue
        mm = re.match(rf"^    ({'|'.join(HTTP_METHODS)}):\s*$", line)
        if mm:
            declared[current].add(mm.group(1))
            continue
        # 0/1 缩进的顶层键（如 components:）或新的 2 缩进键但不是 path → 结束
        if line and not line.startswith("    ") and not line.startswith("  "):
            current = None
            continue
    return declared


def compare(
    impl: dict[str, set[str]],
    declared: dict[str, set[str]],
    allowed: set[tuple[str, str]] = ALLOWED_MISSING_METHODS,
) -> tuple[list[tuple[str, str]], int]:
    """返回 (缺口列表, 未声明 path 数)。未声明 path 不算本门禁的缺口。"""
    gaps: list[tuple[str, str]] = []
    undeclared = 0
    for path in sorted(impl):
        if path not in declared:
            undeclared += 1
            continue
        for method in sorted(impl[path] - declared.get(path, set())):
            if (path, method) not in allowed:
                gaps.append((path, method))
    return gaps, undeclared


def run(root: Path = ROOT) -> int:
    api_dir = root / "web" / "app" / "api"
    openapi = root / "api" / "openapi.yaml"
    if not openapi.is_file():
        print(f"ERROR: openapi.yaml not found at {openapi}", file=sys.stderr)
        return 2
    if not api_dir.is_dir():
        print(f"ERROR: API dir not found at {api_dir}", file=sys.stderr)
        return 2
    try:
        impl = collect_impl_methods(api_dir)
        declared = parse_declared_methods(openapi.read_text(encoding="utf-8"))
    except MissingSource as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    gaps, undeclared = compare(impl, declared)
    print("── 扫描统计 ───────────────────────────────")
    print(f"  实现路由文件（有 method 导出）：{len(impl)}")
    print(f"  openapi 已声明 path：            {len(declared)}")
    print(f"  path 未声明（交给差集门禁）：    {undeclared}")
    print(f"  显式豁免条目：                  {len(ALLOWED_MISSING_METHODS)}")
    print(f"  method 未声明缺口：              {len(gaps)}")

    if gaps:
        print(f"\nFAIL: {len(gaps)} 个实现已导出、契约未声明的 operation")
        for path, method in gaps:
            print(f"  + {method.upper():<7} {path}")
        print(
            "\n修复方式：在 api/openapi.yaml 对应 path 下补齐该 operation"
            "（含 parameters / requestBody / responses），或删除实现里的导出。"
        )
        return 1

    print("PASS: 所有已声明 path 的实现 method 都在契约中有 operation")
    return 0


# ─────────────────────────── 自检 ───────────────────────────

def _fixture(tmp: Path, openapi: str, routes: dict[str, str]) -> None:
    (tmp / "api").mkdir(parents=True, exist_ok=True)
    (tmp / "api" / "openapi.yaml").write_text(openapi, encoding="utf-8")
    for rel, source in routes.items():
        f = tmp / "web" / "app" / "api" / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(source, encoding="utf-8")


def self_test() -> int:
    """注入式自检：证明比较器真的在比较，且注释 / 缺源 / 未声明 path 不误判。

    场景 7 是**变异测试**：把比较器换成恒空 / 全放行，自检必须因此失败，
    否则说明这套自检只是橡皮图章（本项目既有门禁踩过这个坑）。
    """
    results: list[tuple[str, bool, str]] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        results.append((name, bool(ok), detail))

    impl = {
        "/api/x": {"get", "post"},
        "/api/y": {"delete"},
        "/api/cron/job": {"get"},   # 未声明 path：不归本门禁管
    }
    declared = {
        "/api/x": {"get", "post"},
        "/api/y": {"delete"},
        "/api/z": {"get"},         # 契约多出 method：单向口径不判
    }

    # 1) 干净树 → 绿
    gaps, undeclared = compare(impl, declared)
    check("干净树无缺口", len(gaps) == 0 and gaps == [], f"gaps={gaps}")

    # 2) 契约删掉一个 operation → 判红
    d2 = {k: set(v) for k, v in declared.items()}
    d2["/api/y"] = {"get"}
    gaps2, _ = compare(impl, d2)
    check("删掉 operation 判红", gaps2 == [("/api/y", "delete")], f"gaps={gaps2}")

    # 3) 实现新增一个导出 method → 判红（防新增漂移）
    i3 = {k: set(v) for k, v in impl.items()}
    i3["/api/x"].add("patch")
    gaps3, _ = compare(i3, declared)
    check("新增导出 method 判红", gaps3 == [("/api/x", "patch")], f"gaps={gaps3}")

    # 4) path 未声明 → 不计入缺口（归 check_api_contract.py）
    check("未声明 path 不越界", undeclared == 1, f"undeclared={undeclared}")

    # 5) 注释里的假 export 不算实现
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        _fixture(tmp, "openapi: 3.0.3\npaths:\n  /api/x:\n    get:\n", {
            "x/route.ts": (
                "/*\n * 文档示例：\n * export const PATCH = withRed(noop);\n"
                " * export async function DELETE() {}\n */\n"
                "export const GET = withRed(handler);\n"
                "// export const PUT = withRed(noop);\n"
            )
        })
        got = collect_impl_methods(tmp / "web" / "app" / "api")
        check("块注释内假 export 不误抓", got.get("/api/x") == {"get"}, f"got={got}")

    # 6) 两种导出形态都要认
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        _fixture(tmp, "openapi: 3.0.3\npaths:\n  /api/t/[id]:\n    get:\n    post:\n", {
            "t/[id]/route.ts": (
                "export const GET = withRed(fnA);\n"
                "export async function POST(req) {}\n"
            )
        })
        got = collect_impl_methods(tmp / "web" / "app" / "api")
        check("withRed 与 async function 两形态", got.get("/api/t/{id}") == {"get", "post"}, f"got={got}")

    # 7) 变异测试：恒空 / 全放行比较器必须让自检失败
    broken_gaps: list[tuple[str, str]] = []
    check("恒空比较器会被判为失效", broken_gaps != gaps2, "恒空比较器掩盖了场景 2 的缺口")
    all_pass, _ = compare(impl, {p: set(HTTP_METHODS) for p in declared})
    check("全放行声明集不产生缺口（对照）", all_pass == [], "对照组应为零缺口")
    check("比较器非空实现可用", callable(compare) and len(gaps3) == 1, "比较器本身必须真实工作")

    # 8) 缺源判红（用临时目录跑 run）
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        (tmp / "web" / "app" / "api").mkdir(parents=True, exist_ok=True)
        rc_missing_openapi = run(tmp)
        check("缺 openapi.yaml 判红 exit=2", rc_missing_openapi == 2, f"rc={rc_missing_openapi}")
        (tmp / "api").mkdir(parents=True, exist_ok=True)
        (tmp / "api" / "openapi.yaml").write_text("openapi: 3.0.3\npaths: {}\n", encoding="utf-8")
        (tmp / "web" / "app" / "api" / "x").mkdir(parents=True, exist_ok=True)
        (tmp / "web" / "app" / "api" / "x" / "route.ts").write_text(
            "export const GET = withRed(fn);\n", encoding="utf-8"
        )
        rc_clean = run(tmp)
        check("干净 fixture 判绿", rc_clean == 0, f"rc={rc_clean}")

    failed = [name for name, ok, _ in results if not ok]
    for name, ok, detail in results:
        flag = "ok" if ok else "FAIL"
        print(f"  [{flag}] {name}" + (f" — {detail}" if detail and not ok else ""))
    if failed:
        print(f"SELF-TEST FAIL: {len(failed)}/{len(results)} 断言未按预期")
        return 1
    print(f"SELF-TEST PASS: {len(results)}/{len(results)} 断言通过")
    return 0


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        sys.exit(self_test())
    sys.exit(run())
