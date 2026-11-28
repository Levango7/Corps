#!/usr/bin/env bash
# Staging 只读冒烟：应用 DB、sidecar、outbox cron 三项同时健康才算通过。
# shellcheck source=lib/staging.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/staging.sh"

staging_load_env
log_step "Staging 冒烟检查"
staging_health
staging_cron_smoke
log_ok "应用、sidecar、outbox cron 均正常"
