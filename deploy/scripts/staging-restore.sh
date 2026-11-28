#!/usr/bin/env bash
# Staging 恢复：默认只恢复临时库验证；--force 才允许覆盖目标库与 sidecar 数据。
# 用法：bash deploy/scripts/staging-restore.sh <dump> [--force]
# shellcheck source=lib/staging.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/staging.sh"

BACKUP_FILE="${1:?请提供 custom dump 文件}"
FORCE="${2:-}"
CHECK_DB="${RESTORE_CHECK_DB:-corps_restore_check}"

[[ -f "${BACKUP_FILE}" ]] || die 1 "备份不存在：${BACKUP_FILE}"
staging_load_env
staging_compose exec -T db pg_restore --list < "${BACKUP_FILE}" >/dev/null

restore_into() {
  local target_db="$1"
  staging_compose exec -T db psql -U "${POSTGRES_USER:-postgres}" -d postgres -tAc \
    "DROP DATABASE IF EXISTS ${target_db};" >/dev/null
  staging_compose exec -T db psql -U "${POSTGRES_USER:-postgres}" -d postgres -tAc \
    "CREATE DATABASE ${target_db};" >/dev/null
  staging_compose exec -T db pg_restore --exit-on-error --no-owner --no-privileges \
    -U "${POSTGRES_USER:-postgres}" -d "${target_db}" < "${BACKUP_FILE}" >/dev/null
}

if [[ "${FORCE}" != "--force" ]]; then
  log_step "恢复到临时库 ${CHECK_DB}（不触碰 ${POSTGRES_DB}）"
  restore_into "${CHECK_DB}"
  log_step "恢复后核心表行数"
  staging_compose exec -T db psql -U "${POSTGRES_USER:-postgres}" -d "${CHECK_DB}" -tAc \
    "SELECT 'users=' || count(*) FROM users; SELECT 'workspaces=' || count(*) FROM workspaces; SELECT 'deliverables=' || count(*) FROM deliverables; SELECT 'outbox=' || count(*) FROM delivery_outbox;"
  log_ok "备份可用于恢复（生产库未修改）"
  exit 0
fi

log_warn "真恢复将覆盖 ${POSTGRES_DB} 与 sidecar 数据目录；请输入 RESTORE 确认"
read -r confirm
[[ "${confirm}" == "RESTORE" ]] || die 1 "未确认，恢复已取消"

# 必须在任何覆盖动作之前验证目标配对归档；缺 tar 不能变成只恢复半套。
data_file="${BACKUP_FILE%.dump}-sidecar.tgz"
[[ -f "${data_file}" ]] || die 1 "sidecar 备份不存在：${data_file}（必须与 dump 同名配对）"
tar -tzf - < "${data_file}" >/dev/null

# 真恢复前保留当前库与数据目录，避免错误恢复没有退路。
log_step "恢复前安全备份"
bash "${CORPS_SCRIPTS_DIR}/staging-backup.sh"

log_step "停止写入方并恢复数据库"
staging_compose stop app cron nexusloom nexusloom-worker
restore_into "${POSTGRES_DB}"

log_step "恢复 RLS 角色与策略"
staging_compose exec -T db psql -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB}" \
  -v ON_ERROR_STOP=1 -v app_password="${CORPS_APP_PASSWORD}" \
  -f - < "${CORPS_REPO_ROOT}/db/rls-activate.sql" >/dev/null

log_step "恢复 sidecar 数据目录"
[[ -d "${NEXUSLOOM_DATA_DIR}" ]] || mkdir -p "${NEXUSLOOM_DATA_DIR}"
# 只清目录内容，不删除目录本身；这是 --force 已确认的破坏性操作。
find "${NEXUSLOOM_DATA_DIR}" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
(
  cd "${NEXUSLOOM_DATA_DIR}" || exit 1
  # 与备份相同走 stdin，兼容 Git Bash 的 Windows 绝对路径。
  tar -xzf - < "${data_file}"
)

log_step "启动并验证恢复后的服务"
staging_compose up -d
staging_health
staging_cron_smoke
log_ok "恢复完成并验证通过"
