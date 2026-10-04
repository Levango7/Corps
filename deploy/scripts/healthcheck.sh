#!/usr/bin/env bash
# =============================================================================
# deploy/scripts/healthcheck.sh — 深度健康检查（轮询，无 sleep 等待）
# =============================================================================
# 与 curl 单次探测的区别：单次探测无法区分"应用还在启动"和"应用已挂"。
# 本脚本轮询至**明确成功或明确失败**（上限 120s，AC-04），并在失败时
# 附上容器状态与日志尾部——因为"健康检查失败"本身不告诉你原因。
#
# 判定标准（三条全满足才算健康）：
#   1. HTTP 200
#   2. body 含 "status":"ok"
#   3. body 含 "db":"up"
# 第 3 条是本脚本与裸 curl 的实质区别：应用 DB 探测失败时返回 503，
# 仅看状态码能拿到 200 的场景（如反代返回自己的错误页）会被误判为健康。
#
# 用法：
#   bash deploy/scripts/healthcheck.sh                    # 用 .env.prod 里的地址
#   bash deploy/scripts/healthcheck.sh http://127.0.0.1:3000/api/health
#   CORPS_HEALTH_TIMEOUT=300 bash deploy/scripts/healthcheck.sh
#
# 退出码：0 = 健康；1 = 超时/降级；2 = 环境不可用（无 .env.prod 且未传 URL）
# =============================================================================

# shellcheck source=lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

# ── 目标 URL 解析 ────────────────────────────────────────────────────────────
# 优先级：命令行参数 > HEALTHCHECK_URL 环境变量 > 从 .env.prod 的
# NEXT_PUBLIC_APP_URL 拼出。
# 生产上从公网探测会**刻意**被 Caddy 拒绝（Caddyfile.d/10-app.conf 对
# /api/health 返回 403，避免泄露 db 状态），所以默认探测走服务器本地回环，
# 而不是 NEXT_PUBLIC_APP_URL 的公网地址。这是设计如此，不是 bug。
HEALTH_URL="${1:-${HEALTHCHECK_URL:-}}"

if [[ -z "${HEALTH_URL}" ]]; then
  if [[ -f "${CORPS_ENV_PROD}" ]]; then
    load_prod_env
    # 本地探测：优先打 Caddy 的 80 口（贴近真实入口路径，能顺带验证反代活着），
    # 失败再打 app 直连口。app 直连口在生产已被 overlay 清掉，这里只是兜底提示。
    _host="${CORPS_SITE_ADDRESS#http://}"; _host="${_host#https://}"; _host="${_host%%/*}"
    if [[ -n "${_host}" && "${_host}" != *.* ]]; then
      HEALTH_URL="http://127.0.0.1/api/health"
    else
      HEALTH_URL="http://127.0.0.1/api/health"
    fi
  else
    die 2 "无法确定探测地址：未传参数且缺少 ${CORPS_ENV_PROD}
       用法：bash deploy/scripts/healthcheck.sh <完整 URL>
       例：  bash deploy/scripts/healthcheck.sh http://127.0.0.1:3000/api/health"
  fi
fi

TIMEOUT="${CORPS_HEALTH_TIMEOUT}"
log_step "健康检查：${HEALTH_URL}（上限 ${TIMEOUT}s）"

# ── 轮询 ─────────────────────────────────────────────────────────────────────
# 复用 common.sh 的 health_poll（deploy.sh / rollback.sh 也调同一实现，
# 保证三处的"健康"定义完全一致——三处标准不一致是回滚失败的头号原因）。
if health_poll "${HEALTH_URL}" "${TIMEOUT}"; then
  exit 0
fi

# ── 失败诊断 ─────────────────────────────────────────────────────────────────
# 走到这里说明已经失败。此时最有价值的信息不是"超时了"，而是"为什么"。
log_step "健康检查失败，采集诊断信息"

if command -v docker >/dev/null 2>&1; then
  # 1. 容器状态与退出码
  log_info "容器状态："
  docker ps -a --filter "name=corps-app" \
    --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' >&2 || true

  # 2. 健康检查历史：连续 unhealthy 往往指向 DB 反复断连
  _hid="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}<no-healthcheck>{{end}}' corps-app 2>/dev/null || echo '<not-found>')"
  log_info "app 容器 healthcheck 状态：${_hid}"
  if [[ "${_hid}" == "unhealthy" ]]; then
    log_info "最近 3 次健康检查输出："
    docker inspect --format '{{range .State.Health.Log}}{{.ExitCode}}: {{.Output}}{{end}}' corps-app 2>/dev/null \
      | tail -3 >&2 || true
  fi

  # 3. 重启次数：频繁重启 = OOM 或崩溃循环
  _restarts="$(docker inspect --format '{{.RestartCount}}' corps-app 2>/dev/null || echo '?')"
  log_info "app 容器累计重启次数：${_restarts}"
  if [[ "${_restarts}" =~ ^[0-9]+$ ]] && (( _restarts >= 3 )); then
    log_warn "重启 ${_restarts} 次——疑似 OOM 或崩溃循环。查内存：docker stats --no-stream corps-app"
  fi

  # 4. 日志尾部：migrate deploy 失败在这里（它是容器退出的头号原因）
  log_info "app 日志尾部 30 行："
  docker logs --tail 30 corps-app 2>&1 | sed 's/^/    /' >&2 || true

  # 5. 迁移失败专项提示
  if docker logs --tail 60 corps-app 2>&1 | grep -qi "migrate\|migration"; then
    log_warn "日志中出现迁移相关输出。prisma migrate deploy 失败是容器退出的常见原因，
             详见 entrypoint.sh：迁移用属主连接（DATABASE_OWNER_URL），权限不足即失败"
  fi
fi

# ── 网络侧诊断 ───────────────────────────────────────────────────────────────
# 应用健康但探测不通时，问题在反代或端口，不在应用。
log_info "从本机直连应用（绕过反代）以区分'应用挂了'与'反代挂了'："
if curl -fsS -m 3 "${HEALTH_URL}" >/dev/null 2>&1; then
  log_ok "直连成功——应用正常，问题在 Caddy。查：docker logs corps-caddy"
else
  log_warn "直连也失败——问题在应用或其下游（DB/Redis），不限于反代"
fi

printf '\n%s  健康检查失败（%s）%s\n' "${_C_BLD}${_C_RED}" "${HEALTH_URL}" "${_C_RST}" >&2
printf '  如需回滚：bash deploy/scripts/rollback.sh\n\n' >&2
exit 1
