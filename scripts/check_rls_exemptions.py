#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
check_rls_exemptions.py — RLS 豁免登记表防回归门禁

与 scripts/check_rls_coverage.py 的分工：那份只管"带 workspaceId 的租户表三态齐不齐"，
默认"没 workspaceId 的表不讨论"。于是留下一个盲区——新增一张既无租户键、又无租户父级、
还进了运行时读路径的表，两份门禁都不会响。本脚本补这个盲区。

三条断言：
  HARD_GAP   含 workspaceId 的模型必须在 rls-activate.sql 的 ENABLE 集合里。
             这类表漏掉就是真越权面，不接受豁免登记，所以不进基线。
  EXEMPT_*   未被引擎层覆盖的表必须恰好等于 BASELINE：
               EXEMPT_NEW   出现基线外的名字（新表未经评审就拿到豁免）
               EXEMPT_STALE 基线里的名字已不在未覆盖集合（那行该删，防基线虚胖）
  NO_MAP     所有模型必须显式 @@map。缺 map 时"模型名小写加 s"并不等价于 Prisma 默认表名，
             靠猜会把真表判成未覆盖——历史上这样误报过 17 张。

判据出处：docs/decisions/ADR-010-RLS豁免登记表.md
运行：python scripts/check_rls_exemptions.py [--self-test]
退出码：0 通过；1 失败。
"""

import re
import sys
from pathlib import Path

# 未被引擎层 RLS 覆盖的 19 张表 —— 2026-10-01 以 Prisma 自身的 @relation(fields:[...Id]) 取证冻结；
# 同日 G3 试点收编 push_tokens（20→19），删行依据：db/rls-activate.sql 已 ENABLE+FORCE+策略齐备。
# P 类 = 父表已 ENABLE RLS，同事务写入会被父表策略拒绝而整体回滚（纵深防御少一层，非当前越权面）
# G 类 = 无租户键也无租户父级（身份域 / 支付幂等 / 用户级配置）
BASELINE = {
    "ai_messages", "assistant_messages", "database_fields", "database_records",
    "database_views", "decision_action_items", "file_versions", "key_results",
    "meeting_participants", "yjs_persistence",
    "users", "sessions", "accounts", "verifications",
    "processed_payment_events", "processed_stripe_events",
    "notification_preferences", "ai_voice_preferences",
    "share_access_logs",
}

MODEL_RE = re.compile(r"^model\s+(\w+)\s*\{(.*?)\n\}", re.M | re.S)


def strip_sql_comments(sql):
    sql = re.sub(r"/\*.*?\*/", "", sql, flags=re.DOTALL)
    return re.sub(r"--[^\n]*", "", sql)


def enabled_tables(sql_text):
    sql = strip_sql_comments(sql_text)
    out = set()
    for batch in re.findall(r"FOREACH\s+\w+\s+IN\s+ARRAY\s+ARRAY\[(.*?)\]\s*LOOP", sql, re.I | re.S):
        out |= set(re.findall(r"'(\w+)'", batch))
    out |= set(re.findall(
        r"ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:\w+\.)?\"?(\w+)\"?\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY",
        sql, re.I))
    return out


def analyze(schema_text, sql_text, baseline=frozenset(BASELINE)):
    """纯函数，返回 (failures, stats)。failures 是 (code, msg) 列表，便于自检断言红因。"""
    failures = []
    models = {}
    for name, body in MODEL_RE.findall(schema_text):
        m = re.search(r'@@map\(\s*"([^"]+)"', body)
        models[name] = {
            "table": m.group(1) if m else None,
            "has_ws": bool(re.search(r"^\s*workspaceId\s", body, re.M)),
        }

    no_map = sorted(n for n, d in models.items() if d["table"] is None)
    if no_map:
        failures.append(("NO_MAP", "以下模型缺 @@map，表名只能靠猜，判据不可信: " + ", ".join(no_map)))

    tables = set()
    tenant = set()
    for d in models.values():
        if d["table"]:
            tables.add(d["table"])
            if d["has_ws"]:
                tenant.add(d["table"])

    enabled = enabled_tables(sql_text)

    hard_gap = sorted(tenant - enabled)
    if hard_gap:
        failures.append(("HARD_GAP", "含 workspaceId 却未 ENABLE RLS（真越权面，不接受豁免登记）: " + ", ".join(hard_gap)))

    uncovered = tables - enabled
    extra = sorted(uncovered - baseline)
    stale = sorted(baseline - uncovered)
    if extra:
        failures.append(("EXEMPT_NEW", "出现未登记的豁免表（新增无租户键表须先过 ADR-010 评审并说明读路径）: " + ", ".join(extra)))
    if stale:
        failures.append(("EXEMPT_STALE", "基线里有名字已不在未覆盖集合（已收编或删除，请把该行从 BASELINE 删掉）: " + ", ".join(stale)))

    stats = {"models": len(models), "tables": len(tables), "enabled": len(enabled),
             "tenant": len(tenant), "uncovered": len(uncovered)}
    return failures, stats


def self_test():
    """注入式变异：不只要求"该红的红"，还要求**因正确的原因**红。
    上一版 fixture 把 @@map 误写成 @map，四条变异全因 NO_MAP 变红，等于什么都没测。"""
    tenant = "model Parent { id String @id @@map(\"parent\")\n  workspaceId String\n}\n"
    covered = "ALTER TABLE \"parent\" ENABLE ROW LEVEL SECURITY;\n"
    orphan = "model Orphan { id String @id @@map(\"orphan\")\n}\n"
    brand = "model Brand { id String @id @@map(\"zz_new\")\n}\n"
    nomap = "model NoMap { id String @id\n  workspaceId String\n}\n"
    base = frozenset({"orphan"})
    cases = [
        ("干净基线", orphan + tenant, covered, None),
        ("新增未登记豁免表", orphan + brand + tenant, covered, "EXEMPT_NEW"),
        ("租户表丢了 RLS", orphan + tenant, "SELECT 1;\n", "HARD_GAP"),
        ("缺 @@map 不许猜表名", nomap + orphan + tenant, covered, "NO_MAP"),
        ("基线条目已收编该删行", orphan + tenant,
         covered + "ALTER TABLE \"orphan\" ENABLE ROW LEVEL SECURITY;\n", "EXEMPT_STALE"),
    ]
    bad = 0
    for label, schema, sql, want in cases:
        failures, _ = analyze(schema, sql, base)
        codes = set(c for c, _ in failures)
        if want is None:
            ok = not failures
            exp = "通过"
        else:
            ok = want in codes
            exp = "因 " + want + " 变红"
        bad += 0 if ok else 1
        note = "" if ok else "   <-- 实际红因 " + str(sorted(codes))
        print("  [" + ("OK " if ok else "BAD") + "] " + label + ": 期望" + exp + note)
    print("自检结果: " + ("全部符合预期" if bad == 0 else str(bad) + " 项失效"))
    return 0 if bad == 0 else 1


def main():
    if "--self-test" in sys.argv:
        print("== 注入式变异自检（缩小基线 + 合成 schema）==")
        return self_test()

    root = Path(__file__).resolve().parent.parent
    schema_p = root / "web" / "prisma" / "schema.prisma"
    sql_p = root / "db" / "rls-activate.sql"
    for p, label in ((schema_p, "schema.prisma"), (sql_p, "rls-activate.sql")):
        if not p.exists():
            print("ERROR: " + label + " 不存在: " + str(p), file=sys.stderr)
            return 1

    failures, stats = analyze(schema_p.read_text(encoding="utf-8"),
                              sql_p.read_text(encoding="utf-8"))
    print("schema 模型=" + str(stats["models"]) + " 表=" + str(stats["tables"]) +
          "  含 workspaceId=" + str(stats["tenant"]) +
          "  rls-activate ENABLE=" + str(stats["enabled"]) +
          "  未覆盖=" + str(stats["uncovered"]) +
          "（基线登记 " + str(len(BASELINE)) + " 张）")
    if failures:
        print("")
        print("FAIL: RLS 豁免登记表不闭合，共 " + str(len(failures)) + " 项：")
        for code, msg in failures:
            print("  - [" + code + "] " + msg)
        print("")
        print("处置办法见 docs/decisions/ADR-010-RLS豁免登记表.md")
        return 1
    print("PASS: 未覆盖集合与登记表完全一致，且所有含 workspaceId 的表均已启用引擎层 RLS。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
