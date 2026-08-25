#!/usr/bin/env bash
# ============================================================================
# rls-smoke.sh — RLS 引擎层冒烟断言（AC-04 的引擎级补充）
#
# 背景：CI 集成测试以 postgres 超级用户连接（超级用户绕过 RLS，即使 FORCE 也一样），
# 因此 AC-04 只能在应用层做等价回归。本脚本以 corps_app（NOBYPASSRLS 最小权限角色）
# 直连数据库，在【数据库引擎层】验证租户隔离真实生效。
#
# 用法（本地 / CI 均可）：
#   DATABASE_OWNER_URL=postgresql://postgres:...@host:5432/corps \
#   CORPS_APP_PASSWORD=... \
#   APP_DATABASE_URL=postgresql://corps_app:...@host:5432/corps \  # 缺省按 parts 拼
#   bash db/rls-smoke.sh
#
# 步骤：幂等应用 rls-activate.sql → 写双租户夹具（超级用户不受 FORCE 约束）
#       → 以 corps_app 断言：无 WHERE 全表查询仅见本租户、跨租户读不可见、写影响 0 行
# ============================================================================
set -euo pipefail

DB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${DATABASE_OWNER_URL:?需要 DATABASE_OWNER_URL（超级用户/表属主连接串）}"
: "${CORPS_APP_PASSWORD:?需要 CORPS_APP_PASSWORD（corps_app 角色密码）}"
APP_URL="${APP_DATABASE_URL:-postgresql://corps_app:${CORPS_APP_PASSWORD}@${DB_HOST:-localhost}:${DB_PORT:-5432}/${POSTGRES_DB:-corps}"

UA='11111111-1111-4111-8111-aaaaaaaaaaa1'; UB='22222222-2222-4222-8222-bbbbbbbbbbb2'
WA='33333333-3333-4333-8333-ccccccccccc3'; WB='44444444-4444-4444-8444-dddddddddddd'
T1='55555555-5555-4555-8555-eeeeeeeeeee5'; T2='66666666-6666-4666-8666-ffffffffffff'

PSQL=(psql -v ON_ERROR_STOP=1 -q)

echo "== [1/4] 幂等应用 RLS 加固（角色/FORCE/策略）=="
"${PSQL[@]}" "$DATABASE_OWNER_URL" -v app_password="$CORPS_APP_PASSWORD" -f "$DB_DIR/rls-activate.sql"

echo "== [2/4] 写入双租户夹具 =="
"${PSQL[@]}" "$DATABASE_OWNER_URL" <<SQL
insert into users (id, email) values
  ('$UA', 'rls-smoke-a@test.local'),
  ('$UB', 'rls-smoke-b@test.local')
on conflict (email) do nothing;
insert into workspaces (id, name, slug, owner_id) values
  ('$WA', 'RLS-Smoke-A', 'rls-smoke-a', '$UA'),
  ('$WB', 'RLS-Smoke-B', 'rls-smoke-b', '$UB')
on conflict (slug) do nothing;
insert into members (user_id, workspace_id, role) values
  ('$UA', '$WA', 'owner'),
  ('$UB', '$WB', 'owner')
on conflict (user_id, workspace_id) do nothing;
insert into tasks (id, workspace_id, title) values
  ('$T1', '$WA', 'smoke-a-task'),
  ('$T2', '$WB', 'smoke-b-task')
on conflict (id) do nothing;
SQL

# 以 corps_app 身份执行查询；GUC 经 PGOPTIONS 在连接建立时设置（libpq 标准机制）
GUC_OPTS="-c app.workspace_id=$WA -c app.user_id=$UA -c app.auth_op=login"
run_app() { PGOPTIONS="$GUC_OPTS" psql "$APP_URL" -v ON_ERROR_STOP=1 -At -c "$1"; }
fail() { echo "❌ RLS 冒烟失败：$1" >&2; exit 1; }

echo "== [3/4] 引擎断言①：无 WHERE 全表查询只可见本租户（AC-04 核心）=="
n_all=$(run_app "select count(*) from tasks" ) || fail "corps_app 连接失败（检查密码/URL）"
[ "$n_all" = "1" ] || fail "无 WHERE 的 select count(*) 返回 $n_all 行（期望 1，仅本租户）→ 表级 RLS 未生效"

echo "== [4/4] 引擎断言②③：跨租户读不可见 / 跨租户写影响 0 行 =="
n_b=$(run_app "select count(*) from tasks where workspace_id='$WB'")
[ "$n_b" = "0" ] || fail "跨租户 SELECT 可见 $n_b 行（期望 0）"
upd=$(PGOPTIONS="$GUC_OPTS" psql "$APP_URL" -v ON_ERROR_STOP=1 -c "update tasks set title='hacked' where workspace_id='$WB'")
[[ "$upd" == *"UPDATE 0"* ]] || fail "跨租户 UPDATE 影响行数非 0：$upd"

echo "✅ RLS 引擎级冒烟通过：租户隔离在读（全表/定向）与写（UPDATE）三个方向均由数据库层强制"
