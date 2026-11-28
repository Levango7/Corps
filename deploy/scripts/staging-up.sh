#!/usr/bin/env bash
# Staging 启动：固定 base+staging overlay，默认构建源码镜像；--no-build 只起容器。
# shellcheck source=lib/staging.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/staging.sh"

staging_load_env
log_step "启动 Staging（固定数据目录：${NEXUSLOOM_DATA_DIR}）"
if [[ "${1:-}" != "--no-build" ]]; then
  staging_compose build app nexusloom
fi

# bind mount 在干净 Linux 主机上必须显式建立并交给镜像的 app(uid=1001)，
# 否则 Docker 自动建的 root 目录会让 sidecar 起不来。root 只用于这一次性初始化容器。
mkdir -p "${NEXUSLOOM_DATA_DIR}"
staging_compose run --rm --no-deps --user root --entrypoint sh nexusloom -c \
  'mkdir -p /app/data/state /app/data/checkpoints /app/data/logs /app/data/versions /app/data/backups /app/data/output && chown -R 1001:1001 /app/data'
staging_compose up -d

log_step "应用、sidecar 与 cron 健康检查"
staging_health
staging_cron_smoke
log_ok "Staging 已就绪"
