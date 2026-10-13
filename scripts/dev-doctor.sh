#!/usr/bin/env bash
# =============================================================================
# scripts/dev-doctor.sh —— 本机开发环境一键体检
# =============================================================================
# 背景：本机的开发环境有一类**间歇性故障**反复出现，每次都要人工逐项排查：
#   1. Docker Desktop 会自行退出（栈全停，CI/本地测试全红）；
#   2. Docker Desktop 重启后，个别公告端口的宿主监听器不重建——
#      容器配置里映射完好（docker inspect PortBindings 可见）、`docker ps`
#      也显示映射，但宿主 netstat 无监听，表现是"服务 healthy 但连不上"；
#   3. Windows Hyper-V 动态保留段会吞端口（netsh excludedportrange 漂移），
#      容器重建时报 "bind: ...access a socket in a way forbidden"，无管理员
#      权限时只能换端口（本仓 db 已因 5433 被吞迁到 6433，见 docker-compose.override.yml）。
# 本脚本把上述排查清单固化为**可重复执行**的体检，每条给出可行动修复提示。
#
# 用法：
#   bash scripts/dev-doctor.sh          # 体检
# 退出码：0 = 全绿或有警告且不致命；1 = 有硬失败
# =============================================================================

set -u

# ── 输出原语（与 deploy/scripts/preflight.sh 同风格）─────────────────────────
_C_RED=$'\033[31m'; _C_GRN=$'\033[32m'; _C_YLW=$'\033[33m'; _C_RST=$'\033[0m'
CHECKS=(); FAILURES=(); WARNINGS=()
ok()   { CHECKS+=("$1"); printf '  %s[ ok ]%s %s\n' "${_C_GRN}" "${_C_RST}" "$1"; }
warn() { WARNINGS+=("$1"); printf '  %s[warn]%s %s\n' "${_C_YLW}" "${_C_RST}" "$1"; }
fail() { FAILURES+=("$1"); printf '  %s[fail]%s %s\n' "${_C_RED}" "${_C_RST}" "$1"; }
step() { printf '\n▸ %s\n' "$1"; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

hr() { printf '%s\n' "════════════════════════════════════════════════════════════"; }

# ═════════════════════════════════════════════════════════════
# 1/6 Docker 引擎
# ═════════════════════════════════════════════════════════════
step "1/6 Docker 引擎"
if docker info > /dev/null 2>&1; then
  ok "Docker 引擎在跑"
else
  fail "Docker 引擎不可达——本机常见故障：Docker Desktop 自行退出。
       修复：起 'E:\\Docker\\Program\\Docker Desktop.exe'，等 docker info 通过
       （公众号/此仓库文档里的路径；装在哪看 'where docker' 反推）"
fi

# ═════════════════════════════════════════════════════════════
# 2/6 corps 容器（运行中 + healthy）
# ═════════════════════════════════════════════════════════════
step "2/6 corps 容器"
if docker info > /dev/null 2>&1; then
  _cps="$(docker ps --format '{{.Names}}|{{.Status}}' 2>/dev/null | grep '^corps-' || true)"
  if [ -z "${_cps}" ]; then
    fail "没有任何 corps-* 容器在跑——修复：cd ${REPO_ROOT} && docker compose up -d"
  else
    ok "在跑：$(echo "${_cps}" | cut -d'|' -f1 | tr '\n' ' ')"
    # healthy 是 healthcheck 的定义；无 healthcheck 的服务（backup/cron）只看在跑。
    for svc in corps-db corps-app corps-redis; do
      if echo "${_cps}" | grep -q "^${svc}|.*healthy"; then
        ok "${svc} healthy"
      elif echo "${_cps}" | grep -q "^${svc}|"; then
        fail "${svc} 在跑但不 healthy——看日志：docker logs ${svc} --tail 50"
      else
        fail "${svc} 未在运行——修复：cd ${REPO_ROOT} && docker compose up -d ${svc#corps-}"
      fi
    done
    # 备份容器：停了 = 每日备份静默停摆（2026-10-13 恢复演练实证）
    if echo "${_cps}" | grep -q "^corps-backup|"; then
      ok "corps-backup 在跑（每日备份链路活着）"
    else
      warn "corps-backup 未运行——每日备份停摆中。修复：docker compose up -d backup"
    fi
  fi
else
  fail "跳过（Docker 引擎不可达）"
fi

# ═════════════════════════════════════════════════════════════
# 3/6 公告端口的宿主监听器（转发丢失是已知间歇故障）
# ═════════════════════════════════════════════════════════════
step "3/6 宿主端口监听器"
# 从运行中容器的映射反推应监听的端（不猜端口：override/迁移都会改映射）
expected_ports() {
  docker ps --format '{{.Names}}|{{.Ports}}' 2>/dev/null | while IFS='|' read -r name ports; do
    case "${name}" in
      corps-db|corps-app)
        echo "${ports}" | grep -oE '127\.0\.0\.1:[0-9]+' | cut -d: -f2 | while read -r p; do
          echo "${name}|${p}"
        done
        ;;
    esac
  done
}
if docker info > /dev/null 2>&1; then
  _found=0
  while IFS='|' read -r name port; do
    [ -z "${name}" ] && continue
    _found=1
    if netstat -ano 2>/dev/null | grep -qE "[:.]${port}[[:space:]].*LISTENING"; then
      ok "${name} 宿主端口 ${port} 有监听"
    else
      fail "${name} 映射端口 ${port} 无宿主监听（Docker Desktop 转发丢失，已知故障）。
       修复：docker compose up -d --force-recreate ${name#corps-}"
    fi
  done <<< "$(expected_ports)"
  [ "${_found}" = "0" ] && warn "无可检查的端口映射（容器未跑？）"
else
  fail "跳过（Docker 引擎不可达）"
fi

# ═════════════════════════════════════════════════════════════
# 4/6 Windows 保留段检查（Hyper-V 动态排除段会吞端口）
# ═════════════════════════════════════════════════════════════
step "4/6 Windows 保留段（吞端口的老坑）"
if command -v netsh > /dev/null 2>&1; then
  _ranges="$(netsh interface ipv4 show excludedportrange protocol=tcp 2>/dev/null || true)"
  if [ -z "${_ranges}" ]; then
    warn "netsh 无输出（非 Windows 或权限不足）——跳过"
  else
    _hit=0
    while IFS='|' read -r name port; do
      [ -z "${name}" ] && continue
      if echo "${_ranges}" | awk -v p="${port}" '/^ *[0-9]+ +[0-9]+/ { if (p >= $1 && p <= $2) exit 0 } END { exit 1 }'; then
        fail "端口 ${port}（${name}）落在 Windows 保留段内——容器重建时会 bind 失败。
       出解：无管理员时改 docker-compose.override.yml 换端口；有管理员：net stop/start winnat 清段"
        _hit=1
      fi
    done <<< "$(expected_ports)"
    [ "${_hit}" = "0" ] && ok "当前公告端口均不在保留段内"
  fi
else
  warn "netsh 不可用——跳过（非 Windows 环境）"
fi

# ═════════════════════════════════════════════════════════════
# 5/6 应用健康（真探活，不只看容器状态）
# ═════════════════════════════════════════════════════════════
step "5/6 应用健康探活"
_app_port="$(docker ps --format '{{.Names}}|{{.Ports}}' 2>/dev/null | grep '^corps-app|' | grep -oE '127\.0\.0\.1:[0-9]+' | cut -d: -f2 | head -1)"
if [ -n "${_app_port}" ]; then
  _resp="$(curl -s --max-time 10 "http://127.0.0.1:${_app_port}/api/health" 2>/dev/null || true)"
  if echo "${_resp}" | grep -q '"status":"ok"'; then
    ok "app /api/health → ok（端口 ${_app_port}）"
  else
    fail "app /api/health 异常（端口 ${_app_port}）：${_resp:-<无响应>}
       看日志：docker logs corps-app --tail 50"
  fi
else
  warn "未找到 corps-app 的宿主端口——跳过（容器未跑？）"
fi

# ═════════════════════════════════════════════════════════════
# 6/6 备份新鲜度（本地栈的每日备份在 volume 里）
# ═════════════════════════════════════════════════════════════
step "6/6 备份新鲜度"
if docker info > /dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^corps-backup$'; then
  _latest="$(docker exec corps-backup sh -c 'ls -t /backups/corps-*.dump 2>/dev/null | head -1' 2>/dev/null || true)"
  if [ -n "${_latest}" ]; then
    _age_h="$(docker exec corps-backup sh -c "f=\$(ls -t /backups/corps-*.dump | head -1); echo \$(( ( \$(date +%s) - \$(stat -c %Y \"\$f\") ) / 3600 ))" 2>/dev/null || echo '?')"
    if [ "${_age_h}" = "?" ]; then
      warn "拿到最新备份 ${_latest} 但算不出年龄（stat 不可用？）"
    elif [ "${_age_h}" -le 26 ] 2>/dev/null; then
      ok "最新每日备份 ${_age_h}h 前（≤26h）"
    else
      fail "最新每日备份已 ${_age_h}h 未更新（>26h）——备份可能停摆。
       看日志：docker logs corps-backup --tail 20"
    fi
  else
    warn "volume 里没有 corps-*.dump（首次部署后一分钟内属正常）"
  fi
else
  warn "跳过（backup 容器未跑——见 2/6）"
fi

# ═════════════════════════════════════════════════════════════
hr
if (( ${#FAILURES[@]} == 0 )); then
  printf '  %sdev-doctor：全绿（%d 项通过，%d 项警告）%s\n' "${_C_GRN}" "${#CHECKS[@]}" "${#WARNINGS[@]}" "${_C_RST}"
  hr
  exit 0
else
  printf '  %sdev-doctor：%d 项失败（%d 项通过）%s\n' "${_C_RED}" "${#FAILURES[@]}" "${#CHECKS[@]}" "${_C_RST}"
  printf '\n  失败清单（按此顺序修）：\n'
  for f in "${FAILURES[@]}"; do printf '   - %s\n' "${f%%$'\n'*}"; done
  printf '\n'
  hr
  exit 1
fi
