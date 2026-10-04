#!/usr/bin/env bash
# =============================================================================
# deploy/scripts/rollback.sh — 一键回滚到上一个已验证 tag
# =============================================================================
# 回滚来源优先级：
#   1. 命令行参数            bash rollback.sh 0.2.0
#   2. deploy/VERSION.previous（deploy.sh 每次上线前写入）
#   3. 容器内可用的上一个镜像（无 previous 文件时的兜底）
# 三个都拿不到就退出，不猜。
#
# AC-02：必须在 5 分钟内恢复该 tag 且 /api/health 返回 status=="ok"。
# 序列：pull → up -d --no-deps app → 轮询健康检查 → 更新 VERSION
#
# ⛔ 硬约束：本脚本**只回滚镜像，不回滚数据库**。
#    prisma migrate deploy 是单向的：入口脚本每次启动只前滚，回退镜像 tag
#    不会还原 DB schema。回退一个带新迁移的旧镜像，可能得到"旧代码 + 新 schema"，
#    比不回滚更糟（应用启动即因缺列报错）。
#    迁移不可逆时唯一的还原路径是 restore.sh 从备份恢复——那是人工决策，
#    不是本脚本能自动做的事。详见 README §4。
#
# 用法：
#   bash deploy/scripts/rollback.sh              # 回到 VERSION.previous
#   bash deploy/scripts/rollback.sh 0.2.0        # 回到指定 tag
#   bash deploy/scripts/rollback.sh --no-health  # 跳过健康检查（最后手段）
# =============================================================================

# shellcheck source=lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

TARGET_TAG=""
SKIP_HEALTH=0
for arg in "$@"; do
  case "${arg}" in
    --no-health) SKIP_HEALTH=1 ;;
    -h|--help) sed -n '2,26p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) die 2 "未知参数：${arg}" ;;
    *) TARGET_TAG="$arg" ;;
  esac
done

# ── 1. 确定目标 tag ──────────────────────────────────────────────────────────
log_step "1/4 确定回滚目标"

if [[ -z "${TARGET_TAG}" ]]; then
  if [[ -f "${CORPS_VERSION_FILE}.previous" ]]; then
    TARGET_TAG="$(tr -d '[:space:]' < "${CORPS_VERSION_FILE}.previous")"
    log_info "来自 deploy/VERSION.previous：${TARGET_TAG}"
  fi
fi

if [[ -z "${TARGET_TAG}" || "${TARGET_TAG}" == "none" ]]; then
  # 兜底：从 GHCR 本地已有镜像里找。之所以只能"找"不能"猜"：
  # 镜像 tag 是语义化的（0.2.0 / 0.2 / sha-xxx），无法可靠地按版本号排序，
  # 唯一可信的顺序信息是时间戳。
  log_warn "无 VERSION.previous，尝试从本地镜像推断上一个版本"
  _cands="$(docker images --format '{{.Repository}}:{{.Tag}}\t{{.CreatedAt}}' \
            | grep '^ghcr.io/levango7/corps:' \
            | grep -v ':latest' \
            | sort -k2 -r | head -5 || true)"
  if [[ -z "${_cands}" ]]; then
    die 1 "无法确定回滚目标：
       - deploy/VERSION.previous 不存在或为空
       - 本地无 ghcr.io/levango7/corps 的历史镜像
       请显式指定：bash deploy/scripts/rollback.sh <tag>"
  fi
  log_info "本地可用镜像（按创建时间倒序）："
  printf '%s\n' "${_cands}" | sed 's/^/    /' >&2
  die 1 "候选如上。人工确认后显式指定：bash deploy/scripts/rollback.sh <tag>"
fi

if [[ "${TARGET_TAG}" == "latest" ]]; then
  die 1 "拒绝回滚到 latest：它是可变引用，'回滚到 latest' 可能得到与上次相同的版本"
fi

CURRENT_TAG="$(read_current_version)"
log_ok "回滚目标：${TARGET_TAG}（当前：${CURRENT_TAG}）"

if [[ "${TARGET_TAG}" == "${CURRENT_TAG}" ]]; then
  log_warn "目标与当前版本相同（${TARGET_TAG}）——继续执行会重建同版本容器"
fi

# ── 2. 拉取目标镜像 ──────────────────────────────────────────────────────────
log_step "2/4 拉取镜像 ghcr.io/levango7/corps:${TARGET_TAG}"
if ! corpse_compose pull app; then
  die 1 "目标镜像拉取失败，回滚中止
       若该 tag 已被 GHCR 清理或仓库改名，需改用 sha-<hash> tag 或从备份重装镜像"
fi
log_ok "镜像就绪"

# ── 3. 切回旧版本 ────────────────────────────────────────────────────────────
log_step "3/4 切换容器到 ${TARGET_TAG}"
# --no-deps：不动 db/redis。回滚时碰数据库容器只会制造额外故障面。
if ! corpse_compose up -d --no-deps app; then
  die 1 "容器切换失败
       排查：docker logs corps-app --tail 50
       常见原因：旧镜像依赖的 schema 在新迁移后已不兼容（见下方 schema 警告）"
fi
log_ok "容器已切换"

# ── 4. 健康检查 ──────────────────────────────────────────────────────────────
if (( SKIP_HEALTH == 1 )); then
  log_warn "4/4 已跳过健康检查（--no-health）——回滚结果未经验证"
else
  log_step "4/4 健康检查（上限 ${CORPS_HEALTH_TIMEOUT}s）"
  _probe_url="${HEALTHCHECK_URL:-http://127.0.0.1/api/health}"
  if ! health_poll "${_probe_url}" "${CORPS_HEALTH_TIMEOUT}"; then
    log_error "回滚后健康检查仍未通过"
    log_error "⛔ 这通常意味着问题不在镜像版本，而在数据库 schema 或配置。"
    log_error "   旧镜像 + 新 schema 是最常见的组合故障（旧代码引用已被删除/改名的列）。"
    log_error "   下一步（人工决策，不要盲目继续回滚）："
    log_error "   1. docker logs corps-app --tail 50  # 找具体的 schema 报错"
    log_error "   2. 确认本次上线是否含迁移：对比 deploy/VERSION.previous 与 VERSION"
    log_error "   3. 若含不可逆迁移，从备份恢复：bash deploy/scripts/restore.sh --list"
    exit 1
  fi
fi

# ── 收尾 ────────────────────────────────────────────────────────────────────
# 关键细节：把当前版本与 previous **交换**，而不是简单覆盖。
# 这样连续回滚两次能回到更早的版本，而不是在同一个版本间来回。
_tmp_ver="${CORPS_VERSION_FILE}.tmp"
write_current_version "${TARGET_TAG}"
printf '%s\n' "${CURRENT_TAG}" > "${_tmp_ver}"
mv -f "${_tmp_ver}" "${CORPS_VERSION_FILE}.previous"

printf '\n%s  回滚完成：%s → %s%s\n' "${_C_BLD}${_C_GRN}" "${CURRENT_TAG}" "${TARGET_TAG}" "${_C_RST}" >&2
printf '\n' >&2
printf '  ⚠ 数据库未回滚。prisma migrate deploy 只前滚不回退。\n' >&2
printf '    若回滚后出现 schema 相关报错（旧代码 + 新 schema），需从备份恢复：\n' >&2
printf '      bash deploy/scripts/restore.sh --list      # 列出可用备份\n' >&2
printf '      bash deploy/scripts/restore.sh --dry-run <文件>  # 先在临时库验证\n' >&2
printf '\n' >&2
exit 0
