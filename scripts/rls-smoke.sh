#!/bin/sh
# ============================================================================
# rls-smoke.sh — RLS 加固模式冒烟测试（依赖 psql + openssl）
#
# 用法（容器外本地验证）：
#   DB_URL="postgresql://corps_app:xxxx@localhost:5433/corps?schema=public"
#   OWNER_URL="postgresql://postgres:xxxx@localhost:5433/corps?schema=public"
#   bash scripts/rls-smoke.sh "$DB_URL" "$OWNER_URL"
#
# 通过标准：全部断言 OK；任一断言失败 → exit 1
# ============================================================================

set -eu

DB_URL="${1:?用法: $0 <DATABASE_URL> <DATABASE_OWNER_URL>}"
OWNER_URL="${2:?用法: $0 <DATABASE_URL> <DATABASE_OWNER_URL>}"

pass=0
fail=0

assert_contains() {
  label="$1"
  needle="$2"
  haystack="$3"
  if echo "$haystack" | grep -qi "$needle"; then
    echo "  OK  $label"
    pass=$((pass + 1))
  else
    echo "  FAIL $label — 未找到: $needle"
    fail=$((fail + 1))
  fi
}

assert_empty() {
  label="$1"
  haystack="$2"
  if [ -z "$haystack" ]; then
    echo "  OK  $label（结果为空）"
    pass=$((pass + 1))
  else
    echo "  FAIL $label — 预期为空，实际: $haystack"
    fail=$((fail + 1))
  fi
}

echo "=== RLS 冒烟测试（corps_app 角色）==="

echo "[1] SELECT 越权：无 workspace_id 上下文应返回 0 行（users 表除外）"
tasks=$(psql "$DB_URL" -At -c "SELECT count(*) FROM tasks;" 2>&1)
assert_contains "tasks 无上下文返回 0" "^0$" "$tasks"

echo "[2] SELECT 越权：跨 workspace 不可见（无恶意数据但数量为 0）"
tasks_cross=$(psql "$DB_URL" -At -c "SET app.workspace_id = '00000000-0000-0000-0000-000000000000'; SELECT count(*) FROM tasks;" 2>&1)
assert_contains "跨 wid 查询 0" "^0$" "$tasks_cross"

echo "[3] UPDATE 越权：尝试更新其他工作区的数据应 affected 0"
update_bad=$(psql "$DB_URL" -At -c "UPDATE tasks SET title = 'pwned' WHERE title = 'legit_task';" 2>&1)
assert_contains "update 无影响 0 行" "^0$" "$update_bad"

echo "[4] INSERT 越权：无 workspace_id 上下文的 INSERT 应失败"
insert_bad=$(psql "$DB_URL" -At -c "INSERT INTO tasks (id, workspace_id, title, status, priority, created_by) VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'injected', 'todo', 'low', (SELECT user_id FROM members LIMIT 1));" 2>&1)
assert_contains "insert 无上下文被拒" "permission denied\|violates row-level security\|new row violates\|access denied" "$insert_bad"

echo "[5] SELECT 正常：设置正确 workspace_id 应能读取任务"
tasks_ok=$(psql "$DB_URL" -At -c "SET app.workspace_id = (SELECT workspace_id FROM members LIMIT 1)::uuid; SELECT count(*) FROM tasks;" 2>&1)
assert_contains "set wid 后可读" "^[0-9]" "$tasks_ok"

echo "[6] FORCE ROW LEVEL SECURITY：表属主（postgres）也受约束"
owner_forced=$(psql "$OWNER_URL" -At -c "SELECT count(*) FROM tasks;" 2>&1)
assert_contains "owner 无上下文返回 0" "^0$" "$owner_forced"

echo "[7] 全部表 ENABLE RLS"
rls_tables=$(psql "$OWNER_URL" -At -c "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('members','tasks','comments','decisions','decision_versions','subscriptions','notifications','workspaces','invitations','analytics_events') AND tablename NOT IN (SELECT tablename FROM pg_tables t JOIN pg_class c ON c.relname = t.tablename WHERE c.relrowsecurity = false AND t.schemaname='public');" 2>&1)
assert_contains "所有租户表已 RLS" "members" "$rls_tables"
assert_contains "所有租户表已 RLS" "tasks" "$rls_tables"
assert_contains "所有租户表已 RLS" "workspaces" "$rls_tables"

echo "[8] corps_app 角色属性：NOBYPASSRLS"
role_attrs=$(psql "$OWNER_URL" -At -c "SELECT rolbypassrls FROM pg_roles WHERE rolname = 'corps_app';" 2>&1)
assert_contains "NOBYPASSRLS = f" "^f$" "$role_attrs"

echo ""
echo "========================================="
echo " 断言通过: $pass / $((pass + fail))"
if [ "$fail" -gt 0 ]; then
  echo " 失败: $fail  — 请检查 RLS 激活与策略是否完整"
  exit 1
else
  echo " ALL OK"
fi