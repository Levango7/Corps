#!/usr/bin/env bash
# Staging 公共封装：base + staging overlay + .env.staging，禁止手工拼配置。
# 被 staging-up/smoke/backup/restore source，不单独执行。

# shellcheck source=lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

CORPS_COMPOSE_STAGING="${CORPS_DEPLOY_DIR}/docker-compose.staging.yml"
CORPS_ENV_STAGING="${CORPS_DEPLOY_DIR}/.env.staging"

staging_load_env() {
  if [[ ! -f "${CORPS_ENV_STAGING}" ]]; then
    die 2 "缺少 ${CORPS_ENV_STAGING}
       首次演练：cp deploy/.env.staging.example deploy/.env.staging 后填入真实值
       该文件含密钥，已被 .gitignore 覆盖，不得提交"
  fi
  parse_env_file "${CORPS_ENV_STAGING}"
}

staging_compose() {
  docker compose \
    -f "${CORPS_COMPOSE_BASE}" \
    -f "${CORPS_COMPOSE_STAGING}" \
    --env-file "${CORPS_ENV_STAGING}" \
    "$@"
}

staging_sidecar_health() {
  local cid status elapsed=0
  cid="$(staging_compose ps -q nexusloom)"
  [[ -n "${cid}" ]] || die 1 "sidecar 容器不存在"
  while (( elapsed < CORPS_HEALTH_TIMEOUT )); do
    status="$(docker inspect --format '{{.State.Health.Status}}' "${cid}")"
    [[ "${status}" == "healthy" ]] && return 0
    sleep 2
    (( elapsed += 2 ))
  done
  staging_compose logs --tail=50 nexusloom >&2 || true
  die 1 "sidecar 健康检查超时（${CORPS_HEALTH_TIMEOUT}s，最后状态=${status:-unknown}）"
}

staging_worker_health() {
  local cid status
  cid="$(staging_compose ps -q nexusloom-worker)"
  [[ -n "${cid}" ]] || die 1 "sidecar worker 容器不存在"
  status="$(docker inspect --format '{{.State.Status}}' "${cid}")"
  [[ "${status}" == "running" ]] && return 0
  staging_compose logs --tail=50 nexusloom-worker >&2 || true
  die 1 "sidecar worker 未运行（状态=${status:-unknown}）"
}

staging_health() {
  local app_url="${1:-${NEXT_PUBLIC_APP_URL:-http://127.0.0.1:3000}}"
  staging_sidecar_health
  staging_worker_health
  health_poll "${app_url%/}/api/health" "${CORPS_HEALTH_TIMEOUT}"
}

staging_cron_smoke() {
  local url="${NEXT_PUBLIC_APP_URL:-http://127.0.0.1:3000}"
  curl -fsS -m 10 \
    -H "Authorization: Bearer ${CRON_SECRET}" \
    "${url%/}/api/cron/deliverable-outbox?limit=1" >/dev/null
}
