#!/bin/sh
# ===========================================================================
# backup.sh — PostgreSQL 逻辑备份循环（compose 的 backup 服务入口）
#
# 为什么用 shell 循环而不是 crond：
#   备份容器只做一件事，不需要完整调度器；循环实现无依赖、行为可预测，
#   且「启动即备份一次」让配置错误在容器启动时立刻暴露，而不是等到第二天。
#
# 为什么独立服务而不是塞进 cron 容器：
#   备份与被备份数据分离失败域——业务定时任务的故障不应影响备份，
#   反之备份占用的资源也不应拖慢业务任务。
#
# 环境变量：
#   DATABASE_OWNER_URL          必填，owner 连接串（备份需绕过 RLS 读全量）
#   BACKUP_INTERVAL_SECONDS     可选，默认 86400（每日一次）
#   BACKUP_RETENTION_DAYS       可选，默认 7
#   BACKUP_DIR                  可选，默认 /backups
#
# 恢复方式见 db/restore.sh
# ===========================================================================
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"
RETENTION="${BACKUP_RETENTION_DAYS:-7}"

if [ -z "${DATABASE_OWNER_URL:-}" ]; then
  echo "[backup] 错误：DATABASE_OWNER_URL 未设置，无法备份。" >&2
  echo "[backup] 请在 .env 中设置（见 .env.example）。" >&2
  exit 1
fi

# pg_dump 不接受 Prisma 约定的 ?schema=public 查询串（会报
# invalid URI query parameter），与 entrypoint.sh 处理 psql 的方式一致：剥掉查询串。
DUMP_URL="$(printf '%s' "$DATABASE_OWNER_URL" | sed 's/?.*$//')"

mkdir -p "$BACKUP_DIR"

echo "[backup] 启动：目录=$BACKUP_DIR 间隔=${INTERVAL}s 保留=${RETENTION}天"

while true; do
  ts="$(date +%Y%m%d-%H%M%S)"
  target="$BACKUP_DIR/corps-$ts.dump"
  tmp="$target.partial"

  # 先写 .partial 再改名：避免「备份中途被杀」留下一个看起来完整的坏文件
  if pg_dump --format=custom --no-owner --file="$tmp" "$DUMP_URL"; then
    mv "$tmp" "$target"
    size="$(wc -c < "$target" | tr -d ' ')"
    echo "[backup] $(date -Iseconds) 成功：$(basename "$target") (${size} bytes)"
  else
    rm -f "$tmp"
    # 不退出：单次失败（如数据库重启中）不应让备份容器永久停摆
    echo "[backup] $(date -Iseconds) 失败：pg_dump 返回非零，已清理临时文件" >&2
  fi

  # 清理过期备份
  deleted="$(find "$BACKUP_DIR" -maxdepth 1 -name 'corps-*.dump' -mtime "+$RETENTION" -print -delete 2>/dev/null | wc -l | tr -d ' ')"
  if [ "$deleted" -gt 0 ]; then
    echo "[backup] 已清理 $deleted 个超过 ${RETENTION} 天的备份"
  fi

  # 剩余备份清单（便于运维一眼看出保留情况）
  count="$(find "$BACKUP_DIR" -maxdepth 1 -name 'corps-*.dump' | wc -l | tr -d ' ')"
  echo "[backup] 当前保留 $count 份备份"

  sleep "$INTERVAL"
done
