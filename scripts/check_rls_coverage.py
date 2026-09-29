#!/usr/bin/env python3
"""
check_rls_coverage.py — RLS 覆盖率防回归检查

对 schema.prisma 中每个含 workspaceId 的租户表，核验加固脚本是否给齐了**三态**：
  1. ENABLE ROW LEVEL SECURITY   —— 不开启则策略完全不生效
  2. FORCE  ROW LEVEL SECURITY   —— 不 FORCE 则表属主可旁路
  3. 至少一条 CREATE POLICY       —— 有 ENABLE 无策略 = 全表拒绝，业务静默失效

历史教训：旧版只比对表名集合，既不查 FORCE 也不查策略，且解析 ARRAY 时不剥 SQL 注释，
导致 `-- '某表名'` 这类注释内容会被当成表名（既造成恒红误报，也可被用来伪造覆盖）。
现改为剥注释后解析，并对三态分别断言。

运行方式：
    python scripts/check_rls_coverage.py

退出码：
    0 — 所有租户表的三态齐备
    1 — 存在缺任一态的表
"""

import re
import sys
from pathlib import Path


def strip_sql_comments(sql: str) -> str:
    """移除 -- 行注释与 /* */ 块注释，避免注释里的标识符被当成语句内容。"""
    sql = re.sub(r"/\*.*?\*/", "", sql, flags=re.DOTALL)
    return re.sub(r"--[^\n]*", "", sql)


def parse_schema_tenant_tables(schema_path: Path) -> set[str]:
    """schema.prisma 中含 workspaceId 字段的模型 → 实际表名（@@map 优先）。"""
    content = schema_path.read_text(encoding="utf-8")
    models = re.findall(r"model\s+(\w+)\s*\{(.*?)\n\}", content, re.DOTALL)
    tables = set()
    for name, body in models:
        if re.search(r"^\s*workspaceId\s", body, re.MULTILINE):
            map_match = re.search(r'@@map\("(\w+)"\)', body)
            tables.add(map_match.group(1) if map_match else name.lower() + "s")
    return tables


def parse_rls_states(sql_path: Path) -> tuple[set[str], set[str], set[str]]:
    """返回 (enable 表集合, force 表集合, 有策略的表集合)。"""
    content = strip_sql_comments(sql_path.read_text(encoding="utf-8"))

    enabled: set[str] = set()
    forced: set[str] = set()

    # 1. DO 块里的 FOREACH ... IN ARRAY ARRAY[...]：批量 ENABLE + FORCE
    #    真实文本是 `FOREACH t IN ARRAY ARRAY[ ... ] LOOP ... END LOOP`，
    #    两层 ARRAY（外层是 FOREACH 语法、内层是字面量），正则必须都吃掉。
    for loop_vars, loop_body in re.findall(
            r"FOREACH\s+\w+\s+IN\s+ARRAY\s+ARRAY\[(.*?)\]\s*LOOP(.*?)END\s+LOOP",
            content, re.DOTALL | re.IGNORECASE):
        batch = set(re.findall(r"'(\w+)'", loop_vars))
        if re.search(r"ENABLE\s+ROW\s+LEVEL\s+SECURITY", loop_body, re.IGNORECASE):
            enabled |= batch
        if re.search(r"FORCE\s+ROW\s+LEVEL\s+SECURITY", loop_body, re.IGNORECASE):
            forced |= batch

    # 2. 独立 ALTER TABLE 语句
    enabled |= set(re.findall(
        r"ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:\w+\.)?\"?(\w+)\"?\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY",
        content, re.IGNORECASE))
    forced |= set(re.findall(
        r"ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:\w+\.)?\"?(\w+)\"?\s+FORCE\s+ROW\s+LEVEL\s+SECURITY",
        content, re.IGNORECASE))

    policy_tables = set(re.findall(
        r"CREATE\s+POLICY\s+\S+\s+ON\s+(?:\w+\.)?\"?(\w+)\"?", content, re.IGNORECASE))

    return enabled, forced, policy_tables


def main() -> int:
    project_root = Path(__file__).resolve().parent.parent
    schema_path = project_root / "web" / "prisma" / "schema.prisma"
    sql_path = project_root / "db" / "rls-activate.sql"

    for path, label in ((schema_path, "schema.prisma"), (sql_path, "rls-activate.sql")):
        if not path.exists():
            print(f"ERROR: {label} not found at {path}", file=sys.stderr)
            return 1

    tenant = parse_schema_tenant_tables(schema_path)
    enabled, forced, policy = parse_rls_states(sql_path)

    no_enable = sorted(tenant - enabled)
    no_force = sorted((tenant & enabled) - forced)
    no_policy = sorted(tenant - policy)

    print(f"Schema tenant tables (workspaceId): {len(tenant)}")
    print(f"rls-activate.sql: ENABLE={len(enabled)} FORCE={len(forced)} with-policy={len(policy)}")

    if not (no_enable or no_force or no_policy):
        print("PASS: 所有租户表均已 ENABLE + FORCE RLS 且至少有一条策略。")
        return 0

    print(f"\nFAIL: RLS 三态不齐，共 {len(no_enable) + len(no_force) + len(no_policy)} 项：")
    for label, items in (
        ("缺 ENABLE ROW LEVEL SECURITY（RLS 实际不生效）", no_enable),
        ("缺 FORCE ROW LEVEL SECURITY（表属主可旁路）", no_force),
        ("缺 CREATE POLICY（开启后全表拒绝，业务静默失效）", no_policy),
    ):
        for t in items:
            print(f"  [{label}] {t}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
