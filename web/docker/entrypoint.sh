#!/bin/sh
# 容器入口脚本：
#   1) 以 DATABASE_OWNER_URL 执行 Prisma migrate deploy（DDL 需要属主权限）
#   2) RLS_ACTIVATE=true 时，执行 db/rls-activate.sql（创建 corps_app 角色 + FORCE RLS）
#   3) 应用以 DATABASE_URL（corps_app 最小权限角色）运行
# prisma CLI 已在 Dockerfile 中全局安装（npm install -g prisma@6.15.0）
set -e

echo "----------------------------------------------------------"
echo " [entrypoint] Corps Web 容器启动"
echo " NODE_ENV=${NODE_ENV}"
echo " NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}"
echo " RLS_ACTIVATE=${RLS_ACTIVATE:-false}"
echo "----------------------------------------------------------"

if [ -n "${DATABASE_OWNER_URL}" ]; then
  echo "[entrypoint] 以 owner 连接执行 Prisma migrate deploy..."
  # prisma 6 的 schema 固定从 env("DATABASE_URL") 读取 datasource url，
  # 临时覆盖 DATABASE_URL 让 migrate deploy 走属主连接；RNS 子命令忽略
  # 我们额外设的 PRISMA_DATABASE_URL（不识别的前缀），所以必须用 DATABASE_URL
  DATABASE_URL="${DATABASE_OWNER_URL}" \
    prisma migrate deploy --schema=/app/prisma/schema.prisma
  echo "[entrypoint] Prisma migrate deploy 完成"
else
  echo "[entrypoint] 警告：DATABASE_OWNER_URL 未设置，跳过数据库迁移"
fi

if [ "${RLS_ACTIVATE}" = "true" ]; then
  if [ -n "${DATABASE_OWNER_URL}" ] && [ -n "${CORPS_APP_PASSWORD}" ]; then
    if command -v psql >/dev/null 2>&1; then
      echo "[entrypoint] 激活 RLS 加固（corps_app 角色 + FORCE ROW LEVEL SECURITY）..."
      psql "${DATABASE_OWNER_URL}" -v ON_ERROR_STOP=1 \
        -v app_password="${CORPS_APP_PASSWORD}" \
        -f /app/db/rls-activate.sql >/dev/null
      echo "[entrypoint] RLS 激活完成"
    else
      # v0.2.0 镜像未装 postgresql-client（Dockerfile 阶段可加；本地/挂载式环境
      # 通常已在 db 容器手动跑过 rls-activate.sql）；若未做会启动失败但不会阻断
      echo "[entrypoint] 警告：镜像内无 psql，跳过 rls-activate.sql（请在 db 容器手动执行" >&2
      echo "           psql -U postgres -d corps -v app_password=\$CORPS_APP_PASSWORD \\" >&2
      echo "               -f db/rls-activate.sql  # 需 FORCE RLS 提前激活）" >&2
    fi
  else
    echo "[entrypoint] 错误：RLS_ACTIVATE=true 需要 DATABASE_OWNER_URL 与 CORPS_APP_PASSWORD" >&2
    exit 1
  fi
else
  echo "[entrypoint] 提示：RLS_ACTIVATE 未开启，引擎层租户隔离未激活（见 runbook-deploy 加固章节）"
fi

echo "[entrypoint] 启动 Next.js standalone server..."
exec node server.js