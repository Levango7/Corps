#!/bin/sh
# ============================================================================
# backup-db.sh — PostgreSQL 数据库备份（pg_dump + gzip + 保留 N 天轮转）
#
# 用法：
#   DATABASE_URL="postgresql://postgres:xxx@localhost:5432/corps" \
#   BACKUP_DIR="/data/backups" \
#   RETENTION_DAYS=7 \
#   bash scripts/backup-db.sh
#
# cron 示例（每天凌晨 3 点）：
#   0 3 * * * DATABASE_URL="postgresql://..." BACKUP_DIR="/data/backups" RETENTION_DAYS=7 bash /app/scripts/backup-db.sh >> /var/log/backup.log 2>&1
#
# RPO 声明：本脚本执行 pg_dump（逻辑备份），非 WAL 连续归档。
#           RPO ≈ 备份间隔（默认 24 小时），不保证零数据丢失。
# ============================================================================

set -eu

DATABASE_URL="${DATABASE_URL:?用法: $0 需要 DATABASE_URL 环境变量}"
BACKUP_DIR="${BACKUP_DIR:-/data/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/corps_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "[backup] 开始备份: $BACKUP_FILE"
pg_dump "$DATABASE_URL" | gzip > "$BACKUP_FILE"
echo "[backup] 备份完成: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"

# 轮转：删除超过 RETENTION_DAYS 天的旧备份
echo "[backup] 清理 ${RETENTION_DAYS} 天前的旧备份..."
find "$BACKUP_DIR" -name "corps_*.sql.gz" -mtime +"$RETENTION_DAYS" -delete -print | while read f; do
  echo "[backup] 已删除: $f"
done

echo "[backup] 当前备份数: $(ls "$BACKUP_DIR"/corps_*.sql.gz 2>/dev/null | wc -l)"