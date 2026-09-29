#!/usr/bin/env python3
"""
check_api_contract.py — OpenAPI 契约覆盖率防回归检查

背景：
    api/openapi.yaml 声明自身为前后端唯一契约（single contract），但历史上
    契约增长滞后于路由增长（脚本会打印实时覆盖率）。考虑到一次性补齐
    数百个 path 的工程量与收益不匹配，本检查采用**基线快照 + 防恶化**策略：

      1. 扫描 web/app/api/**/route.ts 得到全部实际路由（Next.js 段语法规范化）
      2. 解析 api/openapi.yaml 得到已声明 path
      3. 差集 = 未声明路由；与基线文件 scripts/api-contract-baseline.txt 比对
         - 出现基线外的新未声明路由 → FAIL（契约漂移，需同步契约或显式入基线）
         - 基线中存在但已声明/已删除的条目 → FAIL（豁免腐烂，必须删行）

    即：基线只允许收缩，不允许被"静默扩大"，也不允许修好后仍挂在豁免清单上。

运行方式：
    python scripts/check_api_contract.py

退出码：
    0 — 无新增未声明路由，且基线无已修未删条目
    1 — 出现新的未声明路由（契约漂移），或基线含已声明/已删除的条目（豁免腐烂）
"""

import re
import sys
from pathlib import Path

# 有意不纳入 OpenAPI 契约的内部端点：
# 这些端点面向内部调度/探活/库托管，不是前后端业务契约的一部分。
INTERNAL_PREFIXES = (
    "/api/cron/",  # 定时作业，仅由调度器调用
    "/api/health",  # 探活端点
    "/api/auth/",  # Better Auth 托管，契约由库自身维护
    "/api/uploads/",  # 文件读写代理（内部存储转发）
)
INTERNAL_EXACT = ("/api/[...path]",)  # API 兜底路由

BASELINE_PATH = Path(__file__).resolve().parent / "api-contract-baseline.txt"


def to_openapi_segment(segment: str) -> str | None:
    """把 Next.js 目录段转换为 OpenAPI path 段。

    - 路由组 `(group)` 不产生 URL 段，返回 None（由调用方跳过）
    - 动态段 `[id]` / `[...slug]` / `[[...slug]]` 统一转为 `{slug}`
    - 普通静态段原样返回
    """
    if segment.startswith("(") and segment.endswith(")"):
        return None
    match = re.fullmatch(r"\[+\.{0,3}(\w+)\]+", segment)
    if match:
        return "{" + match.group(1) + "}"
    return segment


def collect_routes(api_dir: Path) -> set[str]:
    """扫描 route.ts 文件，返回规范化后的路由集合（含 /api 前缀）。"""
    routes: set[str] = set()
    for route_file in api_dir.rglob("route.ts"):
        rel = route_file.relative_to(api_dir).parent
        segments = [s for s in rel.parts if s != "."]
        converted = []
        for seg in segments:
            mapped = to_openapi_segment(seg)
            if mapped is not None:
                converted.append(mapped)
        routes.add("/api" + ("/" + "/".join(converted) if converted else ""))
    return routes


def parse_openapi_paths(openapi_path: Path) -> set[str]:
    """解析 openapi.yaml 顶级 paths 下的 path 键（形如 `  /api/v1/...:`）。"""
    content = openapi_path.read_text(encoding="utf-8")
    # 仅取 paths: 块内的两级缩进 path 行，避免把 components 等其它键误当路径
    return set(re.findall(r"^  (/[^\s:]+):\s*$", content, re.MULTILINE))


def is_internal(route: str) -> bool:
    if route in INTERNAL_EXACT:
        return True
    return any(route.startswith(prefix) for prefix in INTERNAL_PREFIXES)


def load_baseline(path: Path) -> set[str]:
    """读取基线文件；`#` 开头与空行忽略。文件不存在时返回空集（首轮会全部报新）。"""
    if not path.exists():
        return set()
    lines = path.read_text(encoding="utf-8").splitlines()
    return {ln.strip() for ln in lines if ln.strip() and not ln.strip().startswith("#")}


def write_baseline(path: Path, routes: set[str]) -> None:
    """写入基线文件（维护用：`python scripts/check_api_contract.py --write-baseline`）。

    仅在显式调用时执行，不在 CI 中触发，避免脚本自行"抹平"漂移。
    """
    header = [
        "# OpenAPI 契约基线 — 已存在但尚未纳入 api/openapi.yaml 的路由",
        "#",
        "# 用途：check_api_contract.py 用它区分「历史遗留」与「新增漂移」。",
        "#   - 基线内的未声明路由：允许存在（逐步补齐即可）",
        "#   - 基线外的未声明路由：CI 失败（新增路由必须同步契约，或显式追加到本文件）",
        "#",
        "# 维护原则：本文件只允许收缩 —— 补齐契约或删除路由后，请移除对应条目。",
        "# 重建方式：python scripts/check_api_contract.py --write-baseline",
        "# 格式：每行一个路由路径，'#' 开头为注释。",
        "",
    ]
    path.write_text("\n".join(header + sorted(routes)) + "\n", encoding="utf-8")


def main() -> int:
    project_root = Path(__file__).resolve().parent.parent
    api_dir = project_root / "web" / "app" / "api"
    openapi_path = project_root / "api" / "openapi.yaml"

    if not api_dir.exists():
        print(f"ERROR: API dir not found at {api_dir}", file=sys.stderr)
        return 1
    if not openapi_path.exists():
        print(f"ERROR: openapi.yaml not found at {openapi_path}", file=sys.stderr)
        return 1

    all_routes = collect_routes(api_dir)
    declared = parse_openapi_paths(openapi_path)
    internal = {r for r in all_routes if is_internal(r)}
    contractable = all_routes - internal
    missing = contractable - declared

    # 维护模式：重建基线后直接退出（不参与 CI 判定）
    if "--write-baseline" in sys.argv:
        write_baseline(BASELINE_PATH, missing)
        print(f"Baseline written: {BASELINE_PATH} ({len(missing)} entries)")
        return 0

    baseline = load_baseline(BASELINE_PATH)

    covered = len(contractable) - len(missing)
    pct = (covered / len(contractable) * 100) if contractable else 100.0

    print(f"Routes total:            {len(all_routes)}")
    print(f"Internal (excluded):     {len(internal)}")
    print(f"Contractable routes:     {len(contractable)}")
    print(f"Declared in openapi.yaml:{len(declared)}")
    print(f"Undeclared:              {len(missing)}  (coverage {pct:.1f}%)")
    print(f"Baseline entries:        {len(baseline)}")

    # 1) 防恶化：基线外的新未声明路由 → 失败
    new_drift = missing - baseline
    # 2) 防豁免腐烂：已声明或已删除的基线条目 → 同样失败
    stale = baseline - missing

    failed = False
    if new_drift:
        failed = True
        print(f"\nFAIL: {len(new_drift)} new undeclared route(s) not in baseline:")
        for route in sorted(new_drift):
            print(f"  + {route}")
        print(
            "\nFix (choose one):\n"
            "  1. Add the path to api/openapi.yaml (preferred)\n"
            f"  2. If intentionally out of contract, append it to {BASELINE_PATH.name}"
        )

    if stale:
        failed = True
        print(f"\nFAIL: {len(stale)} baseline entr(ies) no longer undeclared — 基线只允许收缩:")
        for route in sorted(stale):
            print(f"  - {route}")
        print(
            f"\nFix: 这些路由已在 api/openapi.yaml 声明或已删除，从 {BASELINE_PATH.name} 中删掉对应行。"
            "\n（此前只 print 不 fail：docstring 声称「基线只允许收缩」，但豁免清单可以只增不减，"
            "实际是单向棘轮的假象。）"
        )

    if failed:
        return 1

    print("\nPASS: No new undeclared routes (contract drift is not growing).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
