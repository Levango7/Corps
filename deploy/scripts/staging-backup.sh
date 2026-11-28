#!/usr/bin/env bash
# Staging 备份：PostgreSQL custom dump + sidecar 数据 tar；备份后立即验证归档目录。
# shellcheck source=lib/staging.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/staging.sh"

staging_load_env
stamp="$(date +%Y%m%d_%H%M%S)"
mkdir -p "${BACKUP_DIR}"
dump_file="${BACKUP_DIR}/corps-staging-${stamp}.dump"
data_file="${BACKUP_DIR}/corps-staging-${stamp}-sidecar.tgz"

# sidecar 的 SQLite 使用 WAL；冻结进程后连同 wal/shm 一起复制才是一致快照。
# 不能用 docker stop：它会把 awaiting_approval 的任务正常取消，备份反而改变业务状态。
# app/cron 同时停写，防止数据库 dump 与 outbox/sidecar 快照之间继续推进任务。
writers_stopped=0
resume_writers() {
  if [[ "${writers_stopped}" == "1" ]]; then
    staging_compose unpause nexusloom nexusloom-worker >/dev/null 2>&1 || true
    staging_compose start app cron >/dev/null 2>&1 || true
  fi
}
trap resume_writers EXIT
log_step "暂停 app/cron，并冻结 sidecar（备份期间短暂不可用）"
writers_stopped=1
staging_compose stop app cron
staging_compose pause nexusloom nexusloom-worker

log_step "备份 PostgreSQL 到 ${dump_file}"
staging_compose exec -T db pg_dump --format=custom \
  -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB}" > "${dump_file}"
# custom 归档必须可读目录，否则视为失败，不把空文件当成功备份。
staging_compose exec -T db pg_restore --list < "${dump_file}" >/dev/null

log_step "备份 sidecar 数据到 ${data_file}"
if [[ ! -d "${NEXUSLOOM_DATA_DIR}" ]]; then
  die 1 "sidecar 数据目录不存在：${NEXUSLOOM_DATA_DIR}"
fi
(
  cd "${NEXUSLOOM_DATA_DIR}" || exit 1
  # 走 stdout，避免 Windows 路径 F:/... 被 tar 解释成远程主机。
  tar -czf - . > "${data_file}"
)
tar -tzf - < "${data_file}" >/dev/null

log_step "恢复写入方并做健康检查"
staging_compose unpause nexusloom nexusloom-worker
staging_sidecar_health
staging_worker_health
staging_compose start app cron
writers_stopped=0
trap - EXIT
staging_health
staging_cron_smoke

log_ok "备份完成：$(basename "${dump_file}") + $(basename "${data_file}")"
log_info "恢复验证：bash deploy/scripts/staging-restore.sh ${dump_file}"
