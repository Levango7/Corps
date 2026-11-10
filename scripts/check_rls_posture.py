#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
check_rls_posture.py — 目标库 RLS 姿态实测（只读，不执行任何 DDL/DML）

与 scripts/check_rls_exemptions.py 的分工：
  那份是**静态解析** db/rls-activate.sql 文本（证明"脚本会建这些策略"）；
  本脚本**直连目标库**读 pg_class / pg_policies（证明"目标库真的通电"）。
  区别正是 DEPLOY-VERCEL.md「未跑激活脚本时线上是什么状态」一节记录的失效模式：
  静态门禁 81/81/272 全绿，线上 relrowsecurity 全 false、租户隔离只剩应用层过滤。

用法（连接串必须显式作为 argv 传入，禁止靠环境变量隐式继承）：
  python3 scripts/check_rls_posture.py "$DATABASE_URL"
  python3 scripts/check_rls_posture.py "$DATABASE_URL" --guc-workspace <某个真实工作区 uuid>

§1-3 任何角色都能跑（目录视图只读）。
§4 GUC 通路只在连接角色 NOBYPASSRLS 时有意义：bypassrls 角色（如 neondb_owner）
设不设 GUC 都能看到全表，测了是假绿，脚本拒绝执行并说明原因。

判定（结构不变量，不硬编码 81/272——表数随 schema 增长）：
  HARD-1  §3 非空（ENABLE 了却无策略 = 永远读不到，配置错误）
  HARD-2  §1 rls_on + §2 未覆盖数 != 用户表总数（读数自相矛盾）
  HARD-3  §4 三条不满足（无 GUC→0 行；对 GUC→该工作区行数>0；错 GUC→0 行），
          或指定了 --guc-workspace 但连接角色 rolbypassrls=true（GUC 通路未测，假绿风险）
  SOFT    §1 rls_on = 0（未激活；Vercel serverless 无 entrypoint 的已知形态）

退出码：0=加固姿态已验证 1=姿态不达预期 3=读数故障（连接/SQL 错）
连接串与密码绝不打印；输出只含 host/db/user/role/计数/表名。
"""
import sys
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlparse


def die(msg, code=3):
    print(f"FATAL: {msg}", file=sys.stderr)
    sys.exit(code)


def main():
    argv = sys.argv[1:]
    if not argv:
        die("usage: check_rls_posture.py <DATABASE_URL> [--guc-workspace <uuid>]")
    url = argv[0]
    guc_ws = None
    if "--guc-workspace" in argv:
        i = argv.index("--guc-workspace")
        if i + 1 >= len(argv):
            die("--guc-workspace 需要一个 uuid 参数")
        guc_ws = argv[i + 1]

    u = urlparse(url)
    if u.scheme != "postgresql":
        die("scheme 必须是 postgresql")
    q = parse_qs(u.query)
    kwargs = dict(
        host=u.hostname,
        port=u.port or 5432,
        user=u.username,
        password=u.password,
        dbname=u.path.lstrip("/"),
    )
    if "sslmode" in q:
        kwargs["sslmode"] = q["sslmode"][0]

    try:
        import psycopg2
    except ImportError:
        die("本机无 psycopg2（pip install psycopg2-binary）；CI 侧用 db/rls-verify.sql + psql")

    try:
        conn = psycopg2.connect(**kwargs)
    except Exception as e:
        die(f"连接失败: {type(e).__name__}: {str(e).splitlines()[0]}（连接串不回显）")

    cur = conn.cursor()
    try:
        cur.execute("SELECT version()")
        server = cur.fetchone()[0]
        cur.execute("SELECT current_user, rolbypassrls FROM pg_roles WHERE rolname = current_user")
        role, bypass = cur.fetchone()
        print(f"target: host={u.hostname} port={u.port} db={u.path.lstrip('/')} user={u.username}")
        print(f"role: {role} rolbypassrls={bypass}")
        print(f"server: {server}")
        print(f"measured_at_utc: {datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}")

        # §1 引擎层状态
        cur.execute(
            "SELECT count(*) FILTER (WHERE c.relrowsecurity),"
            " count(*) FILTER (WHERE c.relforcerowsecurity),"
            " (SELECT count(*) FROM pg_policies WHERE schemaname = 'public')"
            " FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace"
            " WHERE n.nspname = 'public' AND c.relkind = 'r'"
        )
        rls_on, rls_forced, policies = cur.fetchone()
        cur.execute(
            "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace"
            " WHERE n.nspname = 'public' AND c.relkind = 'r'"
        )
        total_tables = cur.fetchone()[0]

        # §2 未被引擎层覆盖的表
        cur.execute(
            "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace"
            " WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity"
            " ORDER BY c.relname"
        )
        uncovered = [r[0] for r in cur.fetchall()]

        # §3 受保护但没有策略的表
        cur.execute(
            "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace"
            " LEFT JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = c.relname"
            " WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity"
            " GROUP BY c.relname HAVING count(p.policyname) = 0 ORDER BY c.relname"
        )
        no_policy = [r[0] for r in cur.fetchall()]

        print(f"rls_on={rls_on} rls_forced={rls_forced} policies={policies} user_tables={total_tables}")
        print(f"unprotected_tables={len(uncovered)}: {', '.join(uncovered) if uncovered else '(none)'}")
        print(f"enabled_but_policyless={len(no_policy)}: {', '.join(no_policy) if no_policy else '(none)'}")

        verdict = []
        if rls_on + len(uncovered) != total_tables:
            verdict.append("HARD-2 读数自相矛盾（rls_on + 未覆盖数 != 用户表总数）")
        if no_policy:
            verdict.append("HARD-1 存在 ENABLE 了却无策略的表（永远读不到）")
        if rls_on == 0:
            verdict.append("SOFT 未激活（rls_on=0；Vercel serverless 无 entrypoint 的已知形态）")

        # §4 GUC 通路：只在 NOBYPASSRLS 角色上有意义
        guc_ok = None
        if guc_ws:
            if bypass:
                print("guc_path: SKIPPED（当前角色 rolbypassrls=true，测 GUC 通路是假绿，换 corps_app 连接再跑）")
                verdict.append("HARD-3d 指定了 --guc-workspace 但连接角色 rolbypassrls=true（GUC 通路未测，换 corps_app 连接再跑）")
            else:
                try:
                    cur.execute("SELECT count(*) FROM messages")
                    without_guc = cur.fetchone()[0]
                    cur.execute("SET LOCAL app.workspace_id = %s", (guc_ws,))
                    cur.execute("SELECT count(*) FROM messages")
                    with_guc = cur.fetchone()[0]
                    cur.execute("SET LOCAL app.workspace_id = '00000000-0000-0000-0000-000000000000'")
                    cur.execute("SELECT count(*) FROM messages")
                    with_wrong_guc = cur.fetchone()[0]
                    conn.rollback()
                    print(f"guc_path: without_guc={without_guc} with_matching_guc={with_guc} with_wrong_guc={with_wrong_guc}")
                    if without_guc != 0:
                        verdict.append("HARD-3a 无 GUC 应看到 0 行（静默空集才是正确形态）")
                    if with_guc <= 0:
                        verdict.append("HARD-3b 对 GUC 应看到该工作区的行（>0；uuid 须是真实有消息的工作区）")
                    if with_wrong_guc != 0:
                        verdict.append("HARD-3c 错 GUC 应看到 0 行（跨租户在引擎层被挡）")
                    guc_ok = (without_guc == 0 and with_guc > 0 and with_wrong_guc == 0)
                except Exception as e:
                    conn.rollback()
                    die(f"§4 执行失败: {type(e).__name__}: {str(e).splitlines()[0]}")
        else:
            print("guc_path: SKIPPED（未传 --guc-workspace）")

        if any(v.startswith("HARD") for v in verdict):
            print("VERDICT: RED " + " | ".join(verdict))
            sys.exit(1)
        if rls_on == 0:
            print("VERDICT: UNACTIVATED（引擎层隔离未通电；处置见 DEPLOY-VERCEL.md「Docker/K8s 专用项」）")
            sys.exit(1)
        print("VERDICT: GREEN 加固姿态已验证（rls_on>0、无策略空洞、" + ("GUC 通路三线成立" if guc_ok else "GUC 通路未测") + "）")
        sys.exit(0)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
