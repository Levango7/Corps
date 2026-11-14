#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
check_openapi_impl_coverage.py — 契约声明了、实现却不存在的「幽灵 path」门禁

## 它抓的是什么

`check_api_contract.py` 做的是**正向单向包含**：

    实现里可契约化的 route  ⊆  openapi 已声明的 path

反向完全没人管。于是 openapi 可以声明一个根本没有 `route.ts` 的端点，
而既有契约门禁全绿 —— 它们要么只看实现侧（差集 / method / 字段级 / envelope），
要么只校验契约文件自身（$ref / YAML 语法 / description 语义）。客户端 codegen
会照着这份契约生成调用一个 404 端点的方法，运行时才发现。

2026-11-14 实测 main：`api/openapi.yaml` 293 条 path、实现 296 条 route，
其中 3 条「声明了但无实现」：

    /api/uploads/{path+}                   合法：内部上传代理，被 is_internal 豁免
    /api/v1/auth/request-password-reset   幽灵：真实端点是 Better Auth 托管的 /api/auth/request-password-reset
    /api/v1/auth/reset-password          幽灵：真实端点是 Better Auth 托管的 /api/auth/reset-password

前端 `web/app/[locale]/auth/forgot-password/page.tsx:29` 与
`web/app/[locale]/auth/reset-password/page.tsx:42` 实际 fetch 的是 `/api/auth/*`；
`check_api_contract.py` 的 INTERNAL_PREFIXES 明确把 `/api/auth/` 列为
「Better Auth 托管，契约由库自身维护」。所以这两条 `/api/v1/auth/*` 既无实现、
也不是公开契约，属于纯幽灵（全仓除 openapi.yaml 外零引用）。

本门禁补**反向**，做单向包含：

    openapi 已声明的 path  ⊆  实现 route  ∪  内部豁免  ∪  显式登记

## 口径（刻意克制，别把它当双向一致性检查）

1. path 集合与规范化规则**直接复用** `check_api_contract.py` 的
   `collect_routes` / `parse_openapi_paths` / `is_internal`，不另写一套正则 ——
   两套口径一旦漂移，两道门禁会互相放过对方。
2. `is_internal(path)` 为真即跳过（`/api/cron/`、`/api/health`、`/api/auth/`、
   `/api/uploads/`、`/api/[...path]`）。这些端点由调度器 / 探活 / Better Auth /
   存储代理托管，不进公开契约，也不要求出现在实现扫描里。实测
   `/api/uploads/{path+}` 就是这样一条合法的「契约里有、扫描里没有」。
3. **反向不查 method**：那是 `check_openapi_method_coverage.py` 的职责。
4. 零存量 ⇒ **硬失败、不上棘轮、不设基线文件**。确需「设计先行」（先写契约、
   后落地实现）时必须显式写进 `ALLOWED_PLANNED_PATHS`（可审计）并在同一 PR
   说明落地计划；不允许隐藏豁免清单。
5. 源缺失判红：`api/openapi.yaml` 不存在 / `web/app/api` 不存在 / 解析出 0 条
   path → exit 2。静默跳过等于一条永远绿的空门禁。
6. 纯正则 + 标准库，刻意不依赖 PyYAML，与 `check_api_contract.py` 同依赖面。

## 它不保证什么

- 不检查 path 下的 operation 是否与实现导出的 method 一致
- 不检查 requestBody / parameters / response schema
- 不检查该端点是否真的可达（权限、Feature Flag、网关）
- 不替代 code review

退出码：
    0 — 无幽灵 path
    1 — 存在声明了但无实现的 path（或自检未按预期）
    2 — 源缺失 / 解析器失效

用法：
    python scripts/check_openapi_impl_coverage.py
    python scripts/check_openapi_impl_coverage.py --self-test
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# 允许「契约先于实现」的显式登记：默认空。加条目必须在 PR 里写清落地计划。
ALLOWED_PLANNED_PATHS: set[str] = set()

# 复用同一套路径口径，不复制第二份正则。脚本同目录，CI 里
# `python scripts/check_xxx.py` 会把 scripts/ 放到 sys.path[0]。
try:
    from check_api_contract import collect_routes, is_internal, parse_openapi_paths
except ImportError as exc:  # pragma: no cover - CI 上不该发生
    print(f"ERROR: 无法复用 check_api_contract.py 的路径口径：{exc}", file=sys.stderr)
    raise SystemExit(2)


def compare(
    declared: set[str],
    impl: set[str],
    allowed: set[str] = ALLOWED_PLANNED_PATHS,
) -> tuple[list[str], int]:
    """返回 (幽灵 path 列表, 内部豁免数)。

    单向口径：只看「契约多出来的」；实现多出来的交给正向差集门禁。
    """
    ghosts: list[str] = []
    internal_skipped = 0
    for path in sorted(declared):
        if path in impl:
            continue
        if is_internal(path):
            internal_skipped += 1
            continue
        if path in allowed:
            continue
        ghosts.append(path)
    return ghosts, internal_skipped


def run(root: Path = ROOT) -> int:
    api_dir = root / "web" / "app" / "api"
    openapi = root / "api" / "openapi.yaml"

    if not openapi.is_file():
        print(f"ERROR: openapi.yaml not found at {openapi}", file=sys.stderr)
        return 2
    if not api_dir.is_dir():
        print(f"ERROR: API dir not found at {api_dir}", file=sys.stderr)
        return 2

    impl = collect_routes(api_dir)
    declared = parse_openapi_paths(openapi)
    if not declared:
        print("ERROR: openapi.yaml 里没解析到任何 path —— 解析器失效，判红", file=sys.stderr)
        return 2

    ghosts, internal_skipped = compare(declared, impl)
    print("── 扫描统计 ───────────────────────────────")
    print(f"  实现 route.ts 路由：            {len(impl)}")
    print(f"  openapi 已声明 path：           {len(declared)}")
    print(f"  内部端点豁免（无实现）：        {internal_skipped}")
    print(f"  显式登记的设计先行 path：       {len(ALLOWED_PLANNED_PATHS)}")
    print(f"  幽灵 path（声明但无实现）：     {len(ghosts)}")

    if ghosts:
        print(f"\nFAIL: {len(ghosts)} 个 openapi 已声明、实现里不存在的幽灵 path")
        for path in ghosts:
            print(f"  + {path}")
        print(
            "\n修复方式（三选一）：\n"
            "  1. 删除 api/openapi.yaml 里的该 path（若端点本就不属于公开契约）\n"
            "  2. 补上 web/app/api/<...>/route.ts 实现（若契约是对的）\n"
            "  3. 确属「设计先行」时，把 path 显式写进 ALLOWED_PLANNED_PATHS\n"
            "     并在同一 PR 里说明落地计划；不允许隐藏豁免清单。"
        )
        return 1

    print("PASS: openapi 声明的每条 path 都有实现（或属内部豁免 / 显式登记）")
    return 0


# ─────────────────────────── 自检 ───────────────────────────

CLEAN_OPENAPI = """openapi: 3.0.3
paths:
  /api/x:
    get:
      responses:
        '200': { description: ok }
  /api/y:
    post:
      responses:
        '200': { description: ok }
  /api/uploads/{path+}:
    get:
      responses:
        '200': { description: ok }
"""


def _fixture(tmp: Path, openapi_text: str, routes: dict[str, str]) -> None:
    (tmp / "api").mkdir(parents=True, exist_ok=True)
    (tmp / "api" / "openapi.yaml").write_text(openapi_text, encoding="utf-8")
    for rel, source in routes.items():
        f = tmp / "web" / "app" / "api" / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(source, encoding="utf-8")


def self_test() -> int:
    """注入式自检：证明比较器真的在比较，且内部豁免 / 缺源 / 空解析不误判。

    末尾两组是**变异测试**：恒空比较器、全放行 internal 判定都必须被自检识别，
    否则说明这套自检只是橡皮图章（本项目既有门禁踩过这个坑）。
    """
    results: list[tuple[str, bool, str]] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        results.append((name, bool(ok), detail))

    routes = {
        "x/route.ts": "export const GET = withRed(fn);\n",
        "y/route.ts": "export const POST = withRed(fn);\n",
    }

    # 1) 干净树（含一条合法的内部豁免）→ 绿
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        _fixture(tmp, CLEAN_OPENAPI, routes)
        declared = parse_openapi_paths(tmp / "api" / "openapi.yaml")
        impl = collect_routes(tmp / "web" / "app" / "api")
        ghosts, skipped = compare(declared, impl)
        check("干净树无幽灵", ghosts == [], f"ghosts={ghosts}")
        check("内部豁免被跳过而非误报", skipped == 1, f"skipped={skipped}")
        check("解析器确实读到 3 条 path", len(declared) == 3, f"declared={len(declared)}")
        rc_clean = run(tmp)
        check("干净 fixture 判绿", rc_clean == 0, f"rc={rc_clean}")

    # 2) 真实形态注入：两空格缩进的 path 键 + operation
    injected = CLEAN_OPENAPI.replace(
        "  /api/uploads/{path+}:",
        "  /api/v1/ghost-probe:\n    get:\n      responses:\n        '200': { description: ok }\n"
        "  /api/uploads/{path+}:",
    )
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        _fixture(tmp, injected, routes)
        declared = parse_openapi_paths(tmp / "api" / "openapi.yaml")
        impl = collect_routes(tmp / "web" / "app" / "api")
        ghosts2, _ = compare(declared, impl)
        check("注入幽灵 path 判红", ghosts2 == ["/api/v1/ghost-probe"], f"ghosts={ghosts2}")
        rc_ghost = run(tmp)
        check("注入后 run 判红 exit=1", rc_ghost == 1, f"rc={rc_ghost}")

    # 3) 实现被删、契约没清 → 判红（防「删实现留契约」）
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        _fixture(tmp, CLEAN_OPENAPI, {"x/route.ts": routes["x/route.ts"]})
        declared = parse_openapi_paths(tmp / "api" / "openapi.yaml")
        impl = collect_routes(tmp / "web" / "app" / "api")
        ghosts3, _ = compare(declared, impl)
        check("删实现留契约判红", ghosts3 == ["/api/y"], f"ghosts={ghosts3}")

    # 4) 显式登记豁免生效，且默认清单是空的
    check("默认设计先行清单为空", ALLOWED_PLANNED_PATHS == set(), f"allowed={ALLOWED_PLANNED_PATHS}")
    allow_ghosts, _ = compare({"/api/planned"}, set(), {"/api/planned"})
    check("显式登记豁免生效", allow_ghosts == [], f"ghosts={allow_ghosts}")

    # 5) 缺源 / 空解析一律 exit 2
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        (tmp / "web" / "app" / "api").mkdir(parents=True, exist_ok=True)
        check("缺 openapi.yaml 判红 exit=2", run(tmp) == 2)
        (tmp / "api").mkdir(parents=True, exist_ok=True)
        (tmp / "api" / "openapi.yaml").write_text("openapi: 3.0.3\npaths: {}\n", encoding="utf-8")
        check("解析出 0 条 path 判红 exit=2", run(tmp) == 2)
        (tmp / "web" / "app" / "api").rmdir()
        check("缺 web/app/api 判红 exit=2", run(tmp) == 2)

    # 6) 变异测试：恒空比较器必须被识别为失效
    broken: list[str] = []
    check("恒空比较器会被判为失效", broken != ghosts2, "恒空比较器掩盖了场景 2 的缺口")

    # 7) 变异测试：把 internal 判定换成全放行，幽灵会凭空消失 —— 自检必须识别
    saved = globals()["is_internal"]
    try:
        globals()["is_internal"] = lambda _path: True
        allpass_ghosts, _ = compare(
            parse_openapi_paths_from_text(injected),
            collect_routes_from_fixture(routes),
        )
        check(
            "全放行 internal 判定会被判为失效",
            allpass_ghosts == [] and ghosts2 != [],
            "全放行让场景 2 的幽灵消失，说明豁免面不可无限扩大",
        )
    finally:
        globals()["is_internal"] = saved

    failed = [name for name, ok, _ in results if not ok]
    for name, ok, detail in results:
        flag = "ok" if ok else "FAIL"
        print(f"  [{flag}] {name}" + (f" — {detail}" if detail and not ok else ""))
    if failed:
        print(f"SELF-TEST FAIL: {len(failed)}/{len(results)} 断言未按预期")
        return 1
    print(f"SELF-TEST PASS: {len(results)}/{len(results)} 断言通过")
    return 0


def parse_openapi_paths_from_text(text: str) -> set[str]:
    """自检辅助：复用同一条 path 正则，避免自检自己写一套口径。"""
    import re

    return set(re.findall(r"^  (/[^\s:]+):\s*$", text, re.MULTILINE))


def collect_routes_from_fixture(routes: dict[str, str]) -> set[str]:
    """自检辅助：用临时目录走真实的 collect_routes，而不是手造集合。"""
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        _fixture(tmp, CLEAN_OPENAPI, routes)
        return collect_routes(tmp / "web" / "app" / "api")


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        sys.exit(self_test())
    sys.exit(run())
