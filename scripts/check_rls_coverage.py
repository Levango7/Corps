#!/usr/bin/env python3
"""
check_rls_coverage.py — RLS 覆盖率防回归检查

扫描 web/prisma/schema.prisma 中所有含 workspaceId 的模型（通过 @@map 获取实际表名），
与 db/rls-activate.sql 中的 RLS 表名单求差集。差集非空时输出错误并 exit 1。

用途：CI 自动化检查，防止新增含 workspaceId 的模型后忘记在 rls-activate.sql 中补齐 RLS。

运行方式：
    python scripts/check_rls_coverage.py

退出码：
    0 — 所有含 workspaceId 的表均已启用 RLS
    1 — 存在含 workspaceId 但未启用 RLS 的表（防回归失败）
"""

import re
import sys
from pathlib import Path


def parse_schema_workspace_tables(schema_path: Path) -> set[str]:
    """从 schema.prisma 中提取所有含 workspaceId 字段的模型对应的表名。

    通过 @@map("table_name") 获取实际数据库表名；若无 @@map，则使用模型名小写加 s。
    """
    content = schema_path.read_text(encoding="utf-8")
    # 匹配 model Name { ... } 块（非贪婪，到下一个 } 为止）
    models = re.findall(r"model\s+(\w+)\s*\{(.*?)\n\}", content, re.DOTALL)
    tables = set()
    for name, body in models:
        if "workspaceId" in body:
            map_match = re.search(r'@@map\("(\w+)"\)', body)
            table_name = map_match.group(1) if map_match else name.lower() + "s"
            tables.add(table_name)
    return tables


def parse_rls_tables(sql_path: Path) -> set[str]:
    """从 rls-activate.sql 中提取所有启用了 RLS 的表名。

    解析两处来源：
    1. ARRAY[...] 中的表名列表（批量 ENABLE + FORCE RLS）
    2. 独立的 ALTER TABLE ... ENABLE ROW LEVEL SECURITY 语句
    """
    content = sql_path.read_text(encoding="utf-8")
    tables = set()

    # 1. ARRAY 中的表名
    array_match = re.search(r"ARRAY\[(.*?)\]", content, re.DOTALL)
    if array_match:
        tables.update(re.findall(r"'(\w+)'", array_match.group(1)))

    # 2. 独立 ALTER TABLE ... ENABLE ROW LEVEL SECURITY
    tables.update(re.findall(r"ALTER TABLE\s+(\w+)\s+ENABLE ROW LEVEL SECURITY", content))

    return tables


def main() -> int:
    # 定位项目根目录（脚本位于 scripts/ 下，项目根是其父目录）
    project_root = Path(__file__).resolve().parent.parent
    schema_path = project_root / "web" / "prisma" / "schema.prisma"
    sql_path = project_root / "db" / "rls-activate.sql"

    if not schema_path.exists():
        print(f"ERROR: schema.prisma not found at {schema_path}", file=sys.stderr)
        return 1
    if not sql_path.exists():
        print(f"ERROR: rls-activate.sql not found at {sql_path}", file=sys.stderr)
        return 1

    workspace_tables = parse_schema_workspace_tables(schema_path)
    rls_tables = parse_rls_tables(sql_path)

    missing = workspace_tables - rls_tables

    print(f"Schema models with workspaceId: {len(workspace_tables)}")
    print(f"RLS-enabled tables in rls-activate.sql: {len(rls_tables)}")

    if not missing:
        print("PASS: All tables with workspaceId have RLS enabled.")
        return 0
    else:
        print(f"\nFAIL: {len(missing)} table(s) with workspaceId are missing RLS:")
        for table in sorted(missing):
            print(f"  - {table}")
        print("\nFix: Add the missing table(s) to the ARRAY in db/rls-activate.sql")
        return 1


if __name__ == "__main__":
    sys.exit(main())