#!/bin/sh
# 容器入口脚本：先执行 Prisma 数据库迁移，再启动 Next.js standalone 服务。
# - prisma migrate deploy 幂等：已应用的迁移会跳过，新迁移按顺序应用。
# - 失败时立即退出，避免应用启动后因 schema 不一致而抛错。
# prisma CLI 已在 Dockerfile 中全局安装（npm install -g prisma@6.15.0）
set -e

echo "──────────────────────────────────────────────────────────"
echo " [entrypoint] Corps Web 容器启动"
echo " NODE_ENV=${NODE_ENV}"
echo " NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}"
echo "──────────────────────────────────────────────────────────"

# 仅当 DATABASE_URL 已配置时才尝试迁移
if [ -n "${DATABASE_URL}" ]; then
  echo "[entrypoint] 执行 Prisma migrate deploy..."
  # --schema 显式指定，避免找不到 schema.prisma
  prisma migrate deploy --schema=/app/prisma/schema.prisma
  echo "[entrypoint] Prisma migrate deploy 完成"
else
  echo "[entrypoint] 警告：DATABASE_URL 未设置，跳过数据库迁移"
fi

echo "[entrypoint] 启动 Next.js standalone server..."
exec node server.js
