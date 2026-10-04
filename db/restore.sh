#!/bin/sh
# ===========================================================================
# restore.sh — 从 backup.sh 产出的 dump 恢复数据库
#
# 用法（在项目根目录执行，容器名以 docker compose ps 为准）：
#   docker compose run --rm --entrypoint sh backup /db/restore.sh /backups/corps-20261004-030000.dump
#
#   # 或进入容器交互式恢复：
#   docker compose exec backup sh
#   # 然后：/db/restore.sh /backups/corps-<时间戳>.dump
#
# 行为：
#   - 默认 dry-run：只校验文件与连接，不写入任何数据
#   - 加 --yes 才真正执行恢复（--clean --if-exists，先清后建）
#
# 环境变量：DATABASE_OWNER_URL（必填）
# ===========================================================================
set -eu

CONFIRM=0
DUMP_FILE=""

for arg in "$@"; do
  case "$arg" in
    --yes) CONFIRM=1 ;;
    -*) echo "[restore] 未知参数：$arg" >&2; exit 2 ;;
    *) DUMP_FILE="$arg" ;;
  esac
done

if [ -z "$DUMP_FILE" ]; then
  echo "用法：$0 <dump 文件路径> [--yes]" >&2
  echo "" >&2
  echo "可用备份：" >&2
  ls -lh "${BACKUP_DIR:-/backups}"/corps-*.dump 2>/dev/null >&2 || echo "  （无）" >&2
  exit 2
fi

if [ ! -f "$DUMP_FILE" ]; then
  echo "[restore] 错误：文件不存在：$DUMP_FILE" >&2
  exit 1
fi

if [ -z "${DATABASE_OWNER_URL:-}" ]; then
  echo "[restore] 错误：DATABASE_OWNER_URL 未设置。" >&2
  exit 1
fi

# 与 backup.sh / entrypoint.sh 一致：剥掉 Prisma 的 ?schema= 查询串
RESTORE_URL="$(printf '%s' "$DATABASE_OWNER_URL" | sed 's/?.*$//')"

# 备份文件完整性校验（custom 格式可用 pg_restore --list 验证）
echo "[restore] 校验备份文件：$DUMP_FILE"
if ! pg_restore --list "$DUMP_FILE" >/dev/null 2>&1; then
  echo "[restore] 错误：备份文件损坏或格式不符（pg_restore --list 失败）。" >&2
  exit 1
fi
entries="$(pg_restore --list "$DUMP_FILE" 2>/dev/null | grep -c 'TABLE DATA' || true)"
echo "[restore] 校验通过：含 $entries 个数据段"

if [ "$CONFIRM" -ne 1 ]; then
  echo ""
  echo "[restore] 当前为 dry-run（未写入任何数据）。"
  echo "[restore] 恢复将执行 --clean --if-exists，**会先删除现有对象再重建**。"
  echo "[restore] 确认执行请追加 --yes："
  echo "           $0 $DUMP_FILE --yes"
  exit 0
fi

echo "[restore] 开始恢复（--clean --if-exists）…"
pg_restore --clean --if-exists --no-owner --dbname="$RESTORE_URL" "$DUMP_FILE"
echo "[restore] 恢复完成。建议随后执行：docker compose restart app"
