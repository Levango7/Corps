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
#       → push_tokens 用户级隔离（G3 收编试点）：自可见 1 / 跨用户读写 0 / 未注入 GUC 0
#       → share_access_logs 工作区级隔离（G4 收编）：自可见 1 / 跨租户读写 0 / 孤儿 NULL 行不可见
# ============================================================================
set -euo pipefail

DB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${DATABASE_OWNER_URL:?需要 DATABASE_OWNER_URL（超级用户/表属主连接串）}"
: "${CORPS_APP_PASSWORD:?需要 CORPS_APP_PASSWORD（corps_app 角色密码）}"
APP_URL="${APP_DATABASE_URL:-postgresql://corps_app:${CORPS_APP_PASSWORD}@${DB_HOST:-localhost}:${DB_PORT:-5432}/${POSTGRES_DB:-corps}}"

UA='11111111-1111-4111-8111-aaaaaaaaaaa1'; UB='22222222-2222-4222-8222-bbbbbbbbbbb2'
WA='33333333-3333-4333-8333-ccccccccccc3'; WB='44444444-4444-4444-8444-dddddddddddd'
T1='55555555-5555-4555-8555-eeeeeeeeeee5'; T2='66666666-6666-4666-8666-ffffffffffff'
P1='77777777-7777-4777-8777-777777777771'; P2='88888888-8888-4888-8888-888888888882'
S1='99999999-9999-4999-8999-999999999991'; S2='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
S3='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3'

PSQL=(psql -v ON_ERROR_STOP=1 -q)

echo "== [1/8] 幂等应用 RLS 加固（角色/FORCE/策略）=="
"${PSQL[@]}" "$DATABASE_OWNER_URL" -v app_password="$CORPS_APP_PASSWORD" -f "$DB_DIR/rls-activate.sql"

echo "== [2/8] 写入双租户夹具（tasks 工作区级 + push_tokens 用户级 + share_access_logs 含孤儿行）=="
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
insert into push_tokens (id, user_id, platform, token, updated_at) values
  ('$P1', '$UA', 'android', 'smoke-a-fcm-token', now()),
  ('$P2', '$UB', 'android', 'smoke-b-fcm-token', now())
on conflict do nothing;
-- S3 为孤儿行（workspace_id 为 NULL，模拟实体已删除的历史行），任何 GUC 下都不可见
insert into share_access_logs (id, workspace_id, entity_type, entity_id, accessed_at) values
  ('$S1', '$WA', 'task', '$T1', now()),
  ('$S2', '$WB', 'task', '$T2', now()),
  ('$S3', null,  'task', '$T2', now())
on conflict (id) do nothing;
SQL

# 以 corps_app 身份执行查询；GUC 经 PGOPTIONS 在连接建立时设置（libpq 标准机制）
GUC_OPTS="-c app.workspace_id=$WA -c app.user_id=$UA -c app.auth_op=login"
run_app() { PGOPTIONS="$GUC_OPTS" psql "$APP_URL" -v ON_ERROR_STOP=1 -At -c "$1"; }
fail() { echo "❌ RLS 冒烟失败：$1" >&2; exit 1; }

echo "== [3/8] 引擎断言①：无 WHERE 全表查询只可见本租户（AC-04 核心）=="
n_all=$(run_app "select count(*) from tasks" ) || fail "corps_app 连接失败（检查密码/URL）"
[ "$n_all" = "1" ] || fail "无 WHERE 的 select count(*) 返回 $n_all 行（期望 1，仅本租户）→ 表级 RLS 未生效"

echo "== [4/8] 引擎断言②③：跨租户读不可见 / 跨租户写影响 0 行 =="
n_b=$(run_app "select count(*) from tasks where workspace_id='$WB'")
[ "$n_b" = "0" ] || fail "跨租户 SELECT 可见 $n_b 行（期望 0）"
upd=$(PGOPTIONS="$GUC_OPTS" psql "$APP_URL" -v ON_ERROR_STOP=1 -c "update tasks set title='hacked' where workspace_id='$WB'")
[[ "$upd" == *"UPDATE 0"* ]] || fail "跨租户 UPDATE 影响行数非 0：$upd"

echo "== [5/8] 引擎断言④：push_tokens 用户级隔离（G3 收编试点，自可见 1 / 跨用户读写 0）=="
n_own_tok=$(run_app "select count(*) from push_tokens") || fail "corps_app 在 push_tokens 上查询失败（GRANT/FORCE 检查）"
[ "$n_own_tok" = "1" ] || fail "push_tokens 无 WHERE 全表查询返回 $n_own_tok 行（期望 1，仅本用户）→ 用户级 RLS 未生效"
n_cross_tok=$(run_app "select count(*) from push_tokens where user_id='$UB'")
[ "$n_cross_tok" = "0" ] || fail "push_tokens 跨用户 SELECT 可见 $n_cross_tok 行（期望 0）"
upd_tok=$(PGOPTIONS="$GUC_OPTS" psql "$APP_URL" -v ON_ERROR_STOP=1 -c "update push_tokens set token='hacked' where user_id='$UB'")
[[ "$upd_tok" == *"UPDATE 0"* ]] || fail "push_tokens 跨用户 UPDATE 影响行数非 0：$upd_tok"

echo "== [6/8] 引擎断言⑤：push_tokens 未注入 app.user_id 时零可见（=加固模式下裸查静默返空的形态）=="
n_bare_tok=$(psql "$APP_URL" -v ON_ERROR_STOP=1 -At -c "select count(*) from push_tokens")
[ "$n_bare_tok" = "0" ] || fail "未注入 app.user_id 时 push_tokens 可见 $n_bare_tok 行（期望 0）"

echo "== [7/8] 引擎断言⑥：share_access_logs 工作区级隔离（G4 收编，自可见 1 / 跨租户读写 0 / 孤儿行不可见）=="
n_own_log=$(run_app "select count(*) from share_access_logs") || fail "corps_app 在 share_access_logs 上查询失败（GRANT/FORCE 检查）"
[ "$n_own_log" = "1" ] || fail "share_access_logs 无 WHERE 全表查询返回 $n_own_log 行（期望 1：本租户 S1；若为 2 说明孤儿 NULL 行可见）"
n_cross_log=$(run_app "select count(*) from share_access_logs where workspace_id='$WB'")
[ "$n_cross_log" = "0" ] || fail "share_access_logs 跨租户 SELECT 可见 $n_cross_log 行（期望 0）"
upd_log=$(PGOPTIONS="$GUC_OPTS" psql "$APP_URL" -v ON_ERROR_STOP=1 -c "update share_access_logs set ip='hacked' where workspace_id='$WB'")
[[ "$upd_log" == *"UPDATE 0"* ]] || fail "share_access_logs 跨租户 UPDATE 影响行数非 0：$upd_log"
upd_orphan=$(PGOPTIONS="$GUC_OPTS" psql "$APP_URL" -v ON_ERROR_STOP=1 -c "update share_access_logs set ip='hacked' where workspace_id is null")
[[ "$upd_orphan" == *"UPDATE 0"* ]] || fail "孤儿 NULL 行对本租户可写：$upd_orphan"

echo "== [8/8] 引擎断言⑦：share_access_logs 未注入 app.workspace_id 时零可见 =="
n_bare_log=$(psql "$APP_URL" -v ON_ERROR_STOP=1 -At -c "select count(*) from share_access_logs")
[ "$n_bare_log" = "0" ] || fail "未注入 app.workspace_id 时 share_access_logs 可见 $n_bare_log 行（期望 0）"

echo "✅ RLS 引擎级冒烟通过：租户隔离在读（全表/定向）与写（UPDATE）三方向由数据库层强制；push_tokens 用户级隔离（自可见 1 / 跨用户 0 / 裸连接 0 / 跨用户 UPDATE 0 行）与 share_access_logs 工作区级隔离（自可见 1 / 跨租户 0 / 孤儿 NULL 行 0 / 裸连接 0）同样成立"
