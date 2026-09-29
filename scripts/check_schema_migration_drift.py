#!/usr/bin/env python3
"""
check_schema_migration_drift.py — Prisma schema ↔ 已部署数据库 漂移门禁（单向）

断言：schema.prisma 声明的每一张表、每一列，都必须存在于 `prisma migrate deploy`
建出来的库里。反向不检——本仓库刻意用裸 SQL 建了 Prisma 类型系统表达不了的列
（messages.body_tsv / wiki_pages.content_tsv 这类 tsvector，被 web/app/api/v1/search
与 v1/im/search 的裸 SQL 使用），若做双向相等断言会逼着人删掉真实在用的列。

历史缺陷（本门禁正是为它而加）：ai_conversations / ai_messages / push_tokens 三个模型
只存在于 schema.prisma，靠 `prisma db push` 之类的旁路活在开发库里，迁移链从未建过。
后果链：`migrate deploy` 建出的库缺表 → db/rls-activate.sql 对 ai_conversations 建策略时
ERROR: relation does not exist → 加固模式 CI 与容器启动双双中断；另有 favorites.target_type
等 5 列因模型字段漏写 @map，Prisma 按 camelCase 查列，新库上会运行期 P2022。

两种模式：
  1) 权威模式（推荐，接在 migrate deploy 之后跑）：
       python scripts/check_schema_migration_drift.py --database-url "$DATABASE_URL"
     直连库读 information_schema，零 SQL 解析、零假阳性。
  2) 静态回退模式（无库可连时，如 lint/coverage job）：
       python scripts/check_schema_migration_drift.py
     只从迁移文本比对**表名**集合。刻意不在此模式比列名：迁移 SQL 的写法多样
     （多列链式 ADD COLUMN、带引号的 "schema"."table" 前缀），文本解析会产生假阳性，
     而假阳性会让门禁被人肉忽略——那比没有门禁更糟。列级校验只在模式 1 做。

退出码：0 齐备 / 1 有缺失 / 2 无法执行（连不上库等）
"""

import argparse
import os
import re
import sys
from pathlib import Path

SCALAR_TYPES = {
    "String", "Boolean", "Int", "BigInt", "Float", "Decimal",
    "DateTime", "Json", "Jsonb", "Bytes",
}
# 表名引用可能是 "public"."tasks" / public.tasks / tasks 三种写法
_TBL = r'(?:\"?[\w$]+\"?\.)?\"?([\w$]+)\"?'


def strip_prisma_comments(text: str) -> str:
    out = []
    for line in text.split("\n"):
        if line.strip().startswith("///"):
            continue
        cut = line.find(" // ")
        out.append(line[:cut] if cut != -1 else line)
    return "\n".join(out)


def parse_schema(schema_path: Path) -> tuple[set[str], dict[str, set[str]]]:
    """返回 (表名集合, 表名 → 列名集合)；列名规则为 @map 优先、否则取字段名。"""
    content = strip_prisma_comments(schema_path.read_text(encoding="utf-8"))
    enums = set(re.findall(r"^\s*enum\s+(\w+)", content, re.MULTILINE))

    tables: set[str] = set()
    columns: dict[str, set[str]] = {}
    for name, body in re.findall(r"^model\s+(\w+)\s*\{(.*?)\n\}", content, re.MULTILINE | re.DOTALL):
        mm = re.search(r'@@map\("([^"]+)"\)', body)
        table = mm.group(1) if mm else name
        tables.add(table)
        cols: set[str] = set()
        for raw in body.split("\n"):
            line = raw.strip()
            if not line or line.startswith("@@"):
                continue
            fm = re.match(r"^(\w+)\s+([A-Za-z]\w*)(\?|\[\])?\s*(.*)$", line)
            if not fm:
                continue
            field, ftype, _card, rest = fm.groups()
            if ftype not in SCALAR_TYPES and ftype not in enums:
                continue                       # 关联字段（模型名类型），不是列
            if "@relation" in rest:
                continue
            cm = re.search(r'@map\("([^"]+)"\)', rest)
            cols.add(cm.group(1) if cm else field)
        columns[table] = cols
    return tables, columns


def strip_sql_comments(sql: str) -> str:
    sql = re.sub(r"/\*.*?\*/", "", sql, flags=re.DOTALL)
    return re.sub(r"--[^\n]*", "", sql)


def migration_tables(migrations_dir: Path) -> set[str]:
    """静态模式：从迁移文本重建表集合（含 CREATE TABLE 与 RENAME TO）。
    表名保留原文大小写（与权威模式一致；带引号建的驼峰表名不会被误判缺失）。"""
    tables: set[str] = set()
    for path in sorted(migrations_dir.rglob("*.sql")):
        sql = strip_sql_comments(path.read_text(encoding="utf-8"))
        for t in re.findall(r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?" + _TBL, sql, re.IGNORECASE):
            tables.add(t)
        for old, new in re.findall(
                r"ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?" + _TBL + r"\s+RENAME\s+TO\s+" + _TBL,
                sql, re.IGNORECASE):
            if old in tables:
                tables.discard(old)
                tables.add(new)
    return tables


def query_db(database_url: str) -> tuple[set[str], dict[str, set[str]]]:
    """权威模式：用 psql 读 information_schema。选 psql 而非 Python 驱动，是为了
    零新增依赖（CI runner 与 db 容器均已带 psql，db/rls-smoke.sh 同样依赖它）。
    库跑在容器里时可用 DRIFT_CHECK_PSQL 覆盖成 `docker exec -i <c> psql` 之类的包装。"""
    import shlex
    import subprocess
    sql = ("SELECT table_name, column_name FROM information_schema.columns "
           "WHERE table_schema = 'public' ORDER BY 1,2")
    cmd = shlex.split(os.environ.get("DRIFT_CHECK_PSQL", "psql")) + [
        database_url, "-At", "-F", "\x1f", "-v", "ON_ERROR_STOP=1", "-c", sql]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    except FileNotFoundError:
        print("ERROR: 未找到 psql；可改用不带 --database-url 的静态表名模式，"
              "或用 DRIFT_CHECK_PSQL 指定包装命令。", file=sys.stderr)
        raise SystemExit(2)
    if proc.returncode != 0:
        print(f"ERROR: psql 查询失败: {proc.stderr.strip()[:400]}", file=sys.stderr)
        raise SystemExit(2)
    rows = [ln.split("\x1f") for ln in proc.stdout.strip().splitlines() if "\x1f" in ln]
    # 刻意不做大小写折叠：这些对象是用带引号的 DDL 建的，Postgres 会保留原样大小写
    # （如 messages."isRecalled"、ai_feedback."correctedOutput"），一 lower() 就永远对不上。
    tables = {r[0] for r in rows}
    columns: dict[str, set[str]] = {}
    for t, c in rows:
        columns.setdefault(t, set()).add(c)
    return tables, columns


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--database-url", default=os.environ.get("DRIFT_CHECK_DATABASE_URL") or "")
    args = ap.parse_args()

    root = Path(__file__).resolve().parent.parent
    schema_path = root / "web" / "prisma" / "schema.prisma"
    migrations_dir = root / "web" / "prisma" / "migrations"
    if not schema_path.exists():
        print(f"ERROR: 未找到 {schema_path}", file=sys.stderr)
        return 2

    s_tables, s_cols = parse_schema(schema_path)

    if args.database_url:
        mode = "权威（information_schema）"
        try:
            d_tables, d_cols = query_db(args.database_url)
        except Exception as exc:                     # noqa: BLE001 - 门禁需明确区分"跑不动"与"有问题"
            print(f"ERROR: 无法连接数据库做漂移检查: {exc}", file=sys.stderr)
            return 2
        missing_tables = sorted(s_tables - d_tables)
        missing_cols = [f"{t}.{c}" for t in sorted(s_tables & d_tables)
                        for c in sorted(s_cols[t] - d_cols.get(t, set()))]
        actual = f"{len(d_tables)} 表 / {sum(len(v) for v in d_cols.values())} 列"
    else:
        mode = "静态回退（仅表名）"
        m_tables = migration_tables(migrations_dir)
        missing_tables = sorted(s_tables - m_tables)
        missing_cols = []
        actual = f"{len(m_tables)} 表（列级未检，需 --database-url）"

    print(f"模式: {mode}")
    print(f"schema.prisma: {len(s_tables)} 表 / {sum(len(v) for v in s_cols.values())} 列")
    print(f"实际         : {actual}")

    if not missing_tables and not missing_cols:
        print("PASS: schema 声明的对象在实际库里齐备。")
        return 0

    print("\nFAIL: 迁移链建出的库缺以下对象：")
    for t in missing_tables:
        print(f"  [缺表] {t}")
    for c in missing_cols:
        print(f"  [缺列] {c}")
    print("\n修法二选一：")
    print("  a) 用 prisma migrate diff 生成并补一条迁移（勿手写 DDL）；")
    print("  b) 若库里列名其实是 snake_case 而模型字段是 camelCase，给该字段补 @map(\"...\")。")
    print("切勿为解决本告警而删除库里存在、schema 未声明的列（tsvector 等裸 SQL 列是有意的）。")
    return 1


if __name__ == "__main__":
    sys.exit(main())
