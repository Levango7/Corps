#!/usr/bin/env bash
# ===========================================================================
# reset-demo-db.sh — 把数据库重置为「干净演示实例」
#
# 用途：试用前/演示前把库恢复到只有演示数据的初始状态，
#       清掉历次 e2e 与手工测试留下的账号与工作区。
#
# 为什么用 DROP SCHEMA 而不是逐表 TRUNCATE：
#       99 个模型之间有大量外键，逐表删除要维护删除顺序，漏一张就失败；
#       DROP SCHEMA public CASCADE 让 Postgres 自己处理依赖，语义最干净。
#
# 用法（在项目根目录执行）：
#   ./scripts/reset-demo-db.sh              # dry-run，只打印将要做什么
#   ./scripts/reset-demo-db.sh --yes        # 真正执行
#
# 环境变量（未设置时自动从 .env 读取）：
#   RESET_DATABASE_URL   目标库连接串（须为 owner 连接，需绕过 RLS）
#
# 注意：这是破坏性操作。执行前请确认已有一份备份（见 db/backup.sh）。
# ===========================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIRM=0
for arg in "$@"; do
  [ "$arg" = "--yes" ] && CONFIRM=1
done

# 凭据变量先初始化为空，避免 set -u 在「外部直接提供 RESET_DATABASE_URL」时炸掉
PU=""
PP=""
PD=""

# ─── 解析连接串 ────────────────────────────────────────────────────────────
if [ -z "${RESET_DATABASE_URL:-}" ]; then
  if [ -f "$ROOT/.env" ]; then
    PU="$(grep -m1 '^POSTGRES_USER=' "$ROOT/.env" | cut -d= -f2- | tr -d '\r"')"
    PP="$(grep -m1 '^POSTGRES_PASSWORD=' "$ROOT/.env" | cut -d= -f2- | tr -d '\r"')"
    PD="$(grep -m1 '^POSTGRES_DB=' "$ROOT/.env" | cut -d= -f2- | tr -d '\r"')"
    # 宿主端口：compose 把 db 映射到 127.0.0.1:5433
    RESET_DATABASE_URL="postgresql://${PU:-postgres}:${PP}@127.0.0.1:5433/${PD:-corps}"
  else
    echo "[reset] 找不到 .env，请设置 RESET_DATABASE_URL 后重试" >&2
    exit 1
  fi
fi

# Prisma 的 ?schema= 查询串 psql 不认，剥掉
PSQL_URL="$(printf '%s' "$RESET_DATABASE_URL" | sed 's/?.*$//')"
SAFE_URL="$(printf '%s' "$PSQL_URL" | sed 's#://[^@]*@#://***@#')"

echo "[reset] 目标库：$SAFE_URL"

if [ "$CONFIRM" -ne 1 ]; then
  echo ""
  echo "[reset] 当前为 dry-run。执行后将："
  echo "        1) DROP SCHEMA public CASCADE —— 删除全部表与数据"
  echo "        2) prisma migrate deploy       —— 重建 schema"
  echo "        3) 运行 seed                   —— 写入演示账号与演示数据"
  echo ""
  echo "[reset] 确认执行请追加 --yes：  $0 --yes"
  exit 0
fi

# 执行 SQL：优先用本机 psql；宿主机未装客户端时回退到 db 容器
# （容器内 psql 可直连，无需再传密码）
run_sql() {
  if command -v psql >/dev/null 2>&1; then
    psql "$PSQL_URL" -v ON_ERROR_STOP=1 -q "$@"
  else
    docker exec corps-db psql -U "${PU:-postgres}" -d "${PD:-corps}" -v ON_ERROR_STOP=1 -q "$@"
  fi
}

# ─── 1. 清空 schema ────────────────────────────────────────────────────────
echo "[reset] 1/3 清空 schema…"
run_sql -c "DROP SCHEMA IF EXISTS public CASCADE;" -c "CREATE SCHEMA public;"

# ─── 2. 重建 schema（容器内 app 镜像无 prisma CLI，故用本机 web/node_modules）──
echo "[reset] 2/3 重建 schema（prisma migrate deploy）…"
(
  cd "$ROOT/web"
  DATABASE_URL="$RESET_DATABASE_URL" ./node_modules/.bin/prisma migrate deploy
)

# ─── 3. 播种演示数据 ───────────────────────────────────────────────────────
echo "[reset] 3/3 播种演示数据…"
(
  cd "$ROOT/web"
  DATABASE_URL="$RESET_DATABASE_URL" ./node_modules/.bin/tsx prisma/seed.ts
)

echo ""
echo "[reset] ✓ 完成。演示账号："
echo "          demo@corps.app  / Demo123456!  (owner)"
echo "          alice@corps.app / Alice1234!   (admin)"
echo "          bob@corps.app   / Bob12345!    (member)"
echo "[reset] 建议随后重启应用：docker compose restart app"
