#!/usr/bin/env bash
# =============================================================================
# deploy/scripts/deploy.sh — 一键升级（失败自动回滚）
# =============================================================================
# 固定序列（每步失败即中止并自动调 rollback.sh）：
#   1. 跑 preflight.sh（不通过就不许动生产）
#   2. 记录当前 tag 到 deploy/VERSION.previous（回滚依据）
#   3. 触发一次备份（上线前留还原点）
#   4. docker compose pull app
#   5. docker compose up -d --no-deps app
#   6. 轮询健康检查，上限 120s
#   7a. 通过 → 写 VERSION，退出 0
#   7b. 失败 → 自动 rollback.sh，退出 1
#
# 关于 --no-deps：只重建 app 容器，不动 db/redis/livekit。
# 误用（不带 --no-deps）会在 app 有新迁移时连带重建 db 容器——db 容器重建
# 本身不丢数据（数据在卷里），但会中断现有连接并触发不必要的重启窗口。
#
# ⛔ 本脚本**不回滚数据库**。prisma migrate deploy 只前滚不回退，
#    回退镜像 tag 不会还原 DB schema。详见 README §4「回滚盲点」。
#
# 用法：
#   bash deploy/scripts/deploy.sh                       # 用 .env.prod 的 CORPS_IMAGE_TAG
#   CORPS_IMAGE_TAG=0.2.1 bash deploy/scripts/deploy.sh # 临时指定 tag 部署
#   bash deploy/scripts/deploy.sh --skip-preflight      # 紧急场景（需在工单记录原因）
# =============================================================================

# shellcheck source=lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

SKIP_PREFLIGHT=0
for arg in "$@"; do
  case "${arg}" in
    --skip-preflight) SKIP_PREFLIGHT=1 ;;
    -h|--help)
      sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) die 2 "未知参数：${arg}（用 --help 查看用法）" ;;
  esac
done

# 记录本次部署的起始 tag，供自动回滚使用
# 在任何可能失败的步骤之前赋值——若在赋值前就崩，自动回滚无据可依
DEPLOY_FROM_TAG=""
AUTO_ROLLBACK_ARMED=0

# 任何失败都触发回滚的 trap。
# 为什么用 trap 而不是逐步 if：部署中途的失败点不止"健康检查"一处
# （pull 失败、up 失败、VERSION 写入失败……），逐个包 if 迟早漏一个。
# 漏掉的那个就是"部署到一半失败且没人回滚"的事故。
on_error() {
  local exit_code=$?
  local line_no="$1"
  trap - ERR
  log_error "部署在第 ${line_no} 行失败（退出码 ${exit_code}）"
  if (( AUTO_ROLLBACK_ARMED == 1 )); then
    trigger_rollback "部署中断（第 ${line_no} 行，退出码 ${exit_code}）"
  else
    log_warn "未装备自动回滚（失败发生在记录原版本之前，线上未被改动）"
  fi
  exit "${exit_code}"
}
trap 'on_error $LINENO' ERR

trigger_rollback() {
  local reason="$1"
  log_step "触发自动回滚：${reason}"
  local rb="${CORPS_SCRIPTS_DIR}/rollback.sh"
  if [[ -x "${rb}" || -f "${rb}" ]]; then
    if CORPS_IMAGE_TAG="${DEPLOY_FROM_TAG}" bash "${rb}"; then
      log_error "已回滚到 ${DEPLOY_FROM_TAG}，线上恢复到部署前状态"
      log_error "⛔ 数据库未回滚。若本次上线含不可逆迁移，schema 仍停留在新版本。"
      log_error "   请人工评估：是否需要 deploy/scripts/restore.sh 从第 3 步的备份恢复"
    else
      log_error "⛔ 自动回滚失败。线上状态未知，需立即人工介入："
      log_error "   1. docker compose ps / docker logs corps-app --tail 50"
      log_error "   2. 手动执行：CORPS_IMAGE_TAG=${DEPLOY_FROM_TAG} bash deploy/scripts/rollback.sh"
      log_error "   3. 备份位置：${BACKUP_DIR:-/opt/corps/backups}"
    fi
  else
    log_error "找不到回滚脚本 ${rb}"
  fi
}

# ── 1. preflight ─────────────────────────────────────────────────────────────
if (( SKIP_PREFLIGHT == 0 )); then
  log_step "1/7 部署前置校验"
  if ! bash "${CORPS_SCRIPTS_DIR}/preflight.sh"; then
    die 1 "preflight 未通过，拒绝部署（--skip-preflight 可强制跳过，但需在工单记录原因）"
  fi
else
  log_warn "1/7 已跳过 preflight（--skip-preflight）——请确认这是有意为之并已记录原因"
fi

# ── 2. 记录当前版本 ──────────────────────────────────────────────────────────
# 必须放在"动生产"之前。这是回滚的唯一依据，写晚了就永远不知道该退回哪。
log_step "2/7 记录当前版本"
DEPLOY_FROM_TAG="$(read_current_version)"
if [[ -z "${DEPLOY_FROM_TAG}" || "${DEPLOY_FROM_TAG}" == "none" ]]; then
  # 首次部署：VERSION 为空，尝试从运行中的容器反查实际镜像 tag
  _running="$(docker inspect --format '{{.Config.Image}}' corps-app 2>/dev/null || true)"
  if [[ -n "${_running}" ]]; then
    DEPLOY_FROM_TAG="${_running##*:}"
    log_warn "deploy/VERSION 为空，从运行中容器反查到当前 tag：${DEPLOY_FROM_TAG}"
  else
    log_warn "deploy/VERSION 为空且无运行中的 corps-app 容器——按首次部署处理，本次失败无镜像可回滚"
  fi
fi
printf '%s\n' "${DEPLOY_FROM_TAG}" > "${CORPS_VERSION_FILE}.previous"
log_ok "当前版本：${DEPLOY_FROM_TAG}（已写入 deploy/VERSION.previous）"

TARGET_TAG="${CORPS_IMAGE_TAG:-}"
if [[ -z "${TARGET_TAG}" ]]; then
  die 2 "CORPS_IMAGE_TAG 未设置，无法确定部署目标"
fi
if [[ "${TARGET_TAG}" == "${DEPLOY_FROM_TAG}" ]]; then
  log_warn "目标 tag 与当前版本相同（${TARGET_TAG}）——通常意味着 VERSION 未更新或是空转部署"
fi
log_ok "目标版本：${TARGET_TAG}"

# 从此往后任何失败都要能回滚
AUTO_ROLLBACK_ARMED=1

# ── 3. 上线前备份 ────────────────────────────────────────────────────────────
# 为什么不直接部署：镜像 tag 回退只回退代码。schema 变了就是不可逆的，
# 那一刻唯一的还原点就是这次部署前的备份。
# 顺序在 pull 之前：备份要早于任何状态变更，否则"备份"里可能已含新 schema。
log_step "3/7 上线前备份"
_bdir="${BACKUP_DIR:-}"
if [[ -z "${_bdir}" || ! -d "${_bdir}" ]]; then
  log_error "备份目录不可用：${_bdir:-<未设置>}"
  trigger_rollback "上线前备份失败（目录不可用）——继续部署等于放弃唯一的 schema 还原点"
  exit 1
fi
# 先捕获实际文件名再写：清理时必须删掉「真正写出的那个文件」。
# 旧写法写入 *.sql.gz 却 rm *.sql.gz.tmp，通配符不匹配，清理从未生效——
# 失败时会留下 0 字节或截断的 .sql.gz（restore.sh 的 gzip -t 能兜住误恢复，
# 但垃圾文件会堆积，且与注释声明的意图不符）。
_bak="${_bdir}/corps_predeploy_$(date +%Y%m%d_%H%M%S).sql.gz"
# stderr 落到临时文件而不是 /dev/null：备份失败时"pg_dumpall 失败"这句话
# 本身不提供任何可行动信息（是权限？连接？卷满？），排查得手工重跑一遍。
_err_log="$(mktemp 2>/dev/null || echo "${_bak}.err")"
if ! corpse_compose exec -T db sh -c 'pg_dumpall -U "${POSTGRES_USER:-postgres}"' 2>"${_err_log}" \
     | gzip > "${_bak}"; then
  # pg_dumpall 失败时清掉半截文件：留下一个 0 字节或截断的 .sql.gz，
  # 将来 restore.sh 拿它恢复会得到一个"看起来有文件、实则残缺"的假安全感
  rm -f "${_bak}" 2>/dev/null || true
  log_error "pg_dumpall 失败，stderr 末尾 5 行："
  tail -n 5 "${_err_log}" 2>/dev/null | while IFS= read -r _l; do log_error "  ${_l}"; done
  rm -f "${_err_log}" 2>/dev/null || true
  trigger_rollback "上线前备份失败——继续部署等于放弃唯一的 schema 还原点"
  exit 1
fi
rm -f "${_err_log}" 2>/dev/null || true
_bf="$(ls -t "${_bdir}"/corps_predeploy_*.sql.gz 2>/dev/null | head -1)"
_bf_size="$(du -h "${_bf}" 2>/dev/null | cut -f1 || echo '?')"
log_ok "备份完成：${_bf}（${_bf_size}）"

# ── 4. 拉取镜像 ──────────────────────────────────────────────────────────────
log_step "4/7 拉取镜像 ghcr.io/levango7/corps:${TARGET_TAG}"
log_warn "GHCR 在国内访问不稳定；若此处超时，先配置镜像加速再重试（README §3）"
if ! corpse_compose pull app; then
  die 1 "镜像拉取失败"
fi
log_ok "镜像就绪"

# ── 5. 重建 app 容器 ─────────────────────────────────────────────────────────
log_step "5/7 重建 app 容器（--no-deps，不动 db/redis）"
# 不加 --no-deps 会连带重建 db 容器：数据在卷里不会丢，但会中断所有连接
# 并拉长重启窗口。app 有新迁移时 db 也不需要重建。
if ! corpse_compose up -d --no-deps app; then
  die 1 "app 容器启动失败"
fi
log_ok "app 容器已重建"

# ── 6. 健康检查轮询 ──────────────────────────────────────────────────────────
log_step "6/7 健康检查（上限 ${CORPS_HEALTH_TIMEOUT}s）"
_probe_url="${HEALTHCHECK_URL:-http://127.0.0.1/api/health}"
if ! health_poll "${_probe_url}" "${CORPS_HEALTH_TIMEOUT}"; then
  log_error "新版本健康检查未通过"
  trigger_rollback "新版本 ${TARGET_TAG} 健康检查未通过"
  exit 1
fi

# ── 7. 收尾 ──────────────────────────────────────────────────────────────────
log_step "7/7 更新版本记录"
write_current_version "${TARGET_TAG}"
log_ok "deploy/VERSION 已更新为 ${TARGET_TAG}"

trap - ERR

printf '\n%s  部署成功：%s → %s%s\n' "${_C_BLD}${_C_GRN}" "${DEPLOY_FROM_TAG}" "${TARGET_TAG}" "${_C_RST}" >&2
printf '\n' >&2
printf '  ⚠ 回滚提醒：镜像已回退，但 prisma migrate deploy 只前滚不回退。\n' >&2
printf '    若本次上线含数据库迁移，请确认其可逆性（README §4）。\n' >&2
printf '    如需回滚：bash deploy/scripts/rollback.sh\n\n' >&2
exit 0
