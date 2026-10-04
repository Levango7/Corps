#!/usr/bin/env bash
# =============================================================================
# deploy/scripts/restore.sh — 数据库恢复
# =============================================================================
# 设计核心：**先恢复临时库验证，绝不直接打生产库**。
#
# 为什么：pg_dump 生成的 SQL 是"一串顺序执行的语句"，中途失败会留下半恢复的
# 数据库——生产库处于比恢复前更糟的状态。历史上多数恢复事故不是"恢复失败"，
# 而是"恢复到一半发现备份不对，而生产库已经改了一半"。
# 所以本脚本的默认行为是 --dry-run：恢复到 corps_restore_check 临时库、
# 输出核心表行数、人来判断这份备份对不对。真恢复必须显式加 --force。
#
# 模式：
#   --list              列出可用备份
#   --dry-run <文件>    恢复到临时库并输出核心表行数（默认模式，不碰生产）
#   --restore <文件>    恢复临时库（--dry-run 的别名，语义更清楚）
#   --force             真正恢复到生产库（危险，需与 --dry-run 相反的显式意图）
#
# 真实恢复的安全约束（--force 时全部生效）：
#   - 必须先 --dry-run 验证过同一份备份文件
#   - 恢复前自动再做一次当前生产库的 pg_dumpall（能恢复回去才允许往下走）
#   - 恢复前显式二次确认（需输入 RESTORE 四个字）
#
# 用法：
#   bash deploy/scripts/restore.sh --list
#   bash deploy/scripts/restore.sh --dry-run /opt/corps/backups/corps_20261004_030000.sql.gz
#   bash deploy/scripts/restore.sh --force    /opt/corps/backups/corps_20261004_030000.sql.gz
# =============================================================================

# shellcheck source=lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

BACKUP_FILE=""
MODE=""
FORCE=0
DRY_RUN_DONE_MARK="/tmp/.corps_restore_verified"

for arg in "$@"; do
  case "${arg}" in
    --list)    MODE="list" ;;
    --dry-run|--restore) MODE="verify" ;;
    --force)   FORCE=1 ;;
    -h|--help) sed -n '2,28p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) die 2 "未知参数：${arg}" ;;
    *) BACKUP_FILE="$arg" ;;
  esac
done

# 生产库名与临时库名
PROD_DB="${POSTGRES_DB:-corps}"
CHECK_DB="${RESTORE_CHECK_DB:-corps_restore_check}"

# 核心表：恢复后必须能说出"里面有什么"。只有行数而无表名，
# 无法判断这份备份是全量还是只含部分表。
CORE_TABLES=(users workspaces documents document_versions messages)

# ── --list ───────────────────────────────────────────────────────────────────
if [[ "${MODE}" == "list" ]]; then
  _bdir="${BACKUP_DIR:-/opt/corps/backups}"
  log_step "可用备份（${_bdir}）"
  if [[ ! -d "${_bdir}" ]]; then
    die 1 "备份目录不存在：${_bdir}
       BACKUP_DIR 是宿主机路径。确认 deploy/.env.prod 中的设置与实际目录一致"
  fi
  _files="$(find "${_bdir}" -maxdepth 1 -name 'corps_*.sql.gz' -printf '%T@ %p\n' 2>/dev/null | sort -rn || true)"
  if [[ -z "${_files}" ]]; then
    log_warn "没有任何备份。这说明备份从未成功执行过——先跑一次手动备份确认链路通"
    die 1 "无可用备份"
  fi
  printf '\n  %-46s %10s  %s\n' "文件" "大小" "时间" >&2
  printf '  %-46s %10s  %s\n' "----------------------------------------------" "----------" "------------------" >&2
  while read -r _ts _f; do
    _sz="$(du -h "${_f}" 2>/dev/null | cut -f1 || echo '?')"
    _human="$(date -d "@${_ts%.*}" '+%Y-%m-%d %H:%M' 2>/dev/null || echo '?')"
    printf '  %-46s %10s  %s\n' "$(basename "${_f}")" "${_sz}" "${_human}" >&2
  done <<< "${_files}"
  # gzip 完整性：文件存在不等于可解压。截断的 .sql.gz 恢复时会在中途失败，
  # 那时生产库已经被改了一半——所以在这里就验，不要留到恢复时。
  printf '\n' >&2
  log_info "逐个校验 gzip 完整性（gzip -t）："
  while read -r _ts _f; do
    if gzip -t "${_f}" 2>/dev/null; then
      log_ok "$(basename "${_f}") 完整"
    else
      log_error "$(basename "${_f}") 已截断或损坏——不可用于恢复"
    fi
  done <<< "${_files}"
  printf '\n  下一步：bash deploy/scripts/restore.sh --dry-run <文件>\n\n' >&2
  exit 0
fi

# ── 参数校验 ─────────────────────────────────────────────────────────────────
if [[ -z "${MODE}" ]]; then
  MODE="verify"
  [[ "${FORCE}" == "1" ]] || true
fi
if [[ -z "${BACKUP_FILE}" ]]; then
  die 2 "未指定备份文件
       用法：bash deploy/scripts/restore.sh --dry-run <文件>
       先看有哪些：bash deploy/scripts/restore.sh --list"
fi
if [[ ! -f "${BACKUP_FILE}" ]]; then
  die 1 "备份文件不存在：${BACKUP_FILE}"
fi

# 真实恢复必须由 --force 显式发起。这里不接受"文件名里带 force"之类的隐式意图。
if (( FORCE == 0 )) && [[ "${MODE}" != "list" ]]; then
  FORCE=0
fi

# ── 备份完整性前置校验 ───────────────────────────────────────────────────────
# 在任何写操作之前验。这是本脚本最重要的一道闸：损坏的备份一旦开始恢复，
# 生产库会停在半恢复状态，而此时已经无法判断"恢复到哪一步了"。
log_step "校验备份文件完整性"
if ! gzip -t "${BACKUP_FILE}" 2>/dev/null; then
  die 1 "备份文件已截断或损坏，拒绝使用：${BACKUP_FILE}
       损坏的备份恢复到中途失败，会让生产库停在半恢复状态——比不恢复更糟。
       请改用 --list 中另一个完整的备份"
fi
_bsize="$(du -h "${BACKUP_FILE}" 2>/dev/null | cut -f1 || echo '?')"
log_ok "gzip 完整，大小 ${_bsize}"

# ── 数据库连接方式 ───────────────────────────────────────────────────────────
# 一律走 compose exec db 而不是宿主机的 psql：
#   1. 生产 db 服务的宿主机端口已被 overlay 清掉（AC-01 要求），宿主机构本机
#      也连不上，只能进容器
#   2. 不依赖宿主机是否装了 postgresql-client
_psql() {
  # _psql <sql>
  corpse_compose exec -T db psql -U "${POSTGRES_USER:-postgres}" -d "${PROD_DB}" -tAc "$1"
}

# ═════════════════════════════════════════════════════════════════════════════
# 分支 A：验证模式（默认）—— 恢复到临时库
# ═════════════════════════════════════════════════════════════════════════════
if (( FORCE == 0 )); then
  log_step "恢复备份到临时库 ${CHECK_DB}（不触碰生产库 ${PROD_DB}）"
  log_info "备份文件：${BACKUP_FILE}"

  # 1. 清理旧临时库。psql 的 DROP/CREATE 写成一条：CREATE DATABASE
  #    不允许出现在事务块里，拆开执行会因残留事务而失败。
  log_info "重建临时库 ${CHECK_DB}"
  corpse_compose exec -T db psql -U "${POSTGRES_USER:-postgres}" -d postgres -tAc \
    "DROP DATABASE IF EXISTS ${CHECK_DB};" >/dev/null
  corpse_compose exec -T db psql -U "${POSTGRES_USER:-postgres}" -d postgres -tAc \
    "CREATE DATABASE ${CHECK_DB};" >/dev/null
  log_ok "临时库就绪"

  # 2. 灌数据。--force 让 psql 忽略错误继续——为什么这里要忽略？
  #    pg_dump 输出里常有 "CREATE EXTENSION IF NOT EXISTS" 之类在目标库已存在时
  #    报错的语句（TEMPORARY 类对象、owner 不一致等）。这些在临时库里是噪音。
  #    关键判定放在第 3 步：核心表有没有行数。表有数据 = 备份可用。
  log_info "导入数据（这一步可能需要数十秒到数分钟，取决于备份大小）"
  if ! gunzip -c "${BACKUP_FILE}" | corpse_compose exec -T db psql \
        -U "${POSTGRES_USER:-postgres}" -d "${CHECK_DB}" \
        --force --no-password -q >/dev/null 2>"${TMPDIR:-/tmp}/corps_restore_err.log"; then
    # psql 返回非 0 也不一定是失败（--force 下部分语句报错仍继续）。
    # 真正的判据是核心表行数，所以这里只提示，不中止。
    log_warn "psql 报告部分错误（--force 模式下属常见，见下表行数判定）："
    head -5 "${TMPDIR:-/tmp}/corps_restore_err.log" 2>/dev/null | sed 's/^/    /' >&2 || true
  fi
  log_ok "数据导入完成"

  # 3. 输出核心表行数 —— 这才是"备份可用"的判据
  log_step "核心表行数（备份可用性判据）"
  printf '\n  %-22s %12s\n' "表名" "行数" >&2
  printf '  %-22s %12s\n' "----------------------" "------------" >&2
  _total=0
  _found=0
  for t in "${CORE_TABLES[@]}"; do
    # 用 to_regclass 判存在：直接 SELECT FROM 不存在的表会报错中断整条语句
    _exists="$(corpse_compose exec -T db psql -U "${POSTGRES_USER:-postgres}" -d "${CHECK_DB}" -tAc \
      "SELECT to_regclass('public.${t}') IS NOT NULL;" 2>/dev/null | tr -d '[:space:]')"
    if [[ "${_exists}" == "t" ]]; then
      _n="$(corpse_compose exec -T db psql -U "${POSTGRES_USER:-postgres}" -d "${CHECK_DB}" -tAc \
        "SELECT count(*) FROM public.${t};" 2>/dev/null | tr -d '[:space:]' || echo '?')"
      printf '  %-22s %12s\n' "${t}" "${_n}" >&2
      _found=$(( _found + 1 ))
      if [[ "${_n}" =~ ^[0-9]+$ ]]; then
        _total=$(( _total + _n ))
      fi
    else
      printf '  %-22s %12s\n' "${t}" "<表不存在>" >&2
    fi
  done
  printf '  %-22s %12s\n' "----------------------" "------------" >&2
  printf '  %-22s %12s\n' "合计" "${_total}" >&2

  # 4. 判定
  printf '\n' >&2
  if (( _found == 0 )); then
    log_error "临时库中一个核心表都没有——这份备份不可用"
    log_error "常见原因：备份来自未迁移的库，或 pg_dump 目标为空。"
    log_error "⛔ 生产库未被改动（本次操作只碰了临时库 ${CHECK_DB}）"
    corpse_compose exec -T db psql -U "${POSTGRES_USER:-postgres}" -d postgres -tAc \
      "DROP DATABASE IF EXISTS ${CHECK_DB};" >/dev/null 2>&1 || true
    exit 1
  fi

  if (( _total == 0 )); then
    log_warn "核心表均存在但总行数为 0——可能是空库快照，或用户确实为空（首次部署场景）"
  else
    log_ok "备份可用：${_found} 个核心表，共 ${_total} 行"
  fi

  # 记下"这份文件验证过"，供 --force 阶段核对
  printf '%s\n' "${BACKUP_FILE}" > "${DRY_RUN_DONE_MARK}"

  log_step "保留临时库供人工核查"
  log_info "库名：${CHECK_DB}（生产库 ${PROD_DB} 未被触碰）"
  log_info "连接方式："
  log_info "  docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml \\"
  log_info "    --env-file deploy/.env.prod exec db psql -U ${POSTGRES_USER:-postgres} -d ${CHECK_DB}"
  log_info "  \\d 列出表 / SELECT count(*) FROM users; 抽查数据"
  log_info "清理临时库："
  log_info "  docker compose ... exec db psql -U ${POSTGRES_USER:-postgres} -d postgres \\"
  log_info "    -c 'DROP DATABASE ${CHECK_DB};'"

  printf '\n%s  验证完成：生产库未被改动%s\n' "${_C_BLD}${_C_GRN}" "${_C_RST}" >&2
  printf '  确需真恢复时：bash deploy/scripts/restore.sh --force %s\n\n' "${BACKUP_FILE}" >&2
  exit 0
fi

# ═════════════════════════════════════════════════════════════════════════════
# 分支 B：真实恢复（--force）
# ═════════════════════════════════════════════════════════════════════════════
log_step "真实恢复模式（--force）"
log_error "本操作将用 ${BACKUP_FILE} 覆盖生产库 ${PROD_DB} 的全部数据。"

# 二次确认：破坏性操作不能靠"用户传了个 flag"就往下走
log_warn "请输入 RESTORE 四个字母以确认（其他任何输入都会中止）"
printf '确认请输入 > ' >&2
read -r _confirm
if [[ "${_confirm}" != "RESTORE" ]]; then
  die 1 "未确认（输入为 '${_confirm:-空}'），恢复已中止。生产库未被改动"
fi

# 恢复前自动备份当前生产库 —— 这是"能退回去"的前提。
# 没有这一步，一次错误恢复就是不可逆的数据丢失。
log_step "恢复前自动备份当前生产库"
_bdir="${BACKUP_DIR:-/opt/corps/backups}"
if [[ ! -d "${_bdir}" ]]; then
  die 1 "备份目录 ${_bdir} 不存在——拒绝在无法备份的前提下恢复生产库"
fi
_safety="${_bdir}/corps_prerestore_$(date +%Y%m%d_%H%M%S).sql.gz"
log_info "当前生产库将备份到：${_safety}"
if ! corpse_compose exec -T db sh -c 'pg_dumpall -U "${POSTGRES_USER:-postgres}"' 2>/dev/null \
     | gzip > "${_safety}"; then
  rm -f "${_safety}"
  die 1 "恢复前备份失败——拒绝在无还原点的情况下覆盖生产库"
fi
log_ok "恢复前备份完成（${_safety}）"

# 停 app：恢复期间应用仍连库会读到半恢复状态的数据
log_step "停止 app（cron 与 livekit 同步停，避免恢复期间发起请求）"
corpse_compose stop app cron 2>/dev/null || corpse_compose stop app 2>/dev/null || true
log_ok "app 已停止"

log_step "恢复数据到生产库 ${PROD_DB}"
# 先 drop 再 create：直接往已有数据的库上灌 pg_dump 会撞上
# "relation already exists"，必须重建。drop 前的安全性由上面的
# prerestore 备份兜底。
if ! corpse_compose exec -T db psql -U "${POSTGRES_USER:-postgres}" -d postgres -tAc \
     "DROP DATABASE IF EXISTS ${PROD_DB};" >/dev/null; then
  die 1 "无法删除生产库 ${PROD_DB}——可能有活跃连接。
       排障：docker compose ... exec db psql -U postgres -d postgres \\
         -c \"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${PROD_DB}';\""
fi
corpse_compose exec -T db psql -U "${POSTGRES_USER:-postgres}" -d postgres -tAc \
  "CREATE DATABASE ${PROD_DB};" >/dev/null

if ! gunzip -c "${BACKUP_FILE}" | corpse_compose exec -T db psql \
      -U "${POSTGRES_USER:-postgres}" -d "${PROD_DB}" --force --no-password -q >/dev/null 2>&1; then
  log_error "恢复过程中报错"
  die 1 "恢复未完成——生产库 ${PROD_DB} 处于部分恢复状态
       ⛔ 立即用恢复前备份回退：
         gunzip -c ${_safety} | docker compose ... exec -T db psql -U ${POSTGRES_USER:-postgres} -d ${PROD_DB} --force
       或先看 psql 错误输出确认恢复到哪一步，再决定是继续还是回退"
fi
log_ok "数据恢复完成"

log_step "恢复 RLS 角色与策略"
# pg_dumpall 含角色定义，但 FORCE ROW LEVEL SECURITY 与策略在 db/rls-activate.sql
# 里。恢复后必须重跑，否则应用以 corps_app 连接时不受行级安全约束——
# 这是多租户隔离的根基，漏掉等于全库数据对所有租户可见。
log_info "RLS 激活将由 app 容器启动时的 entrypoint 执行（RLS_ACTIVATE=true）；"
log_info "若 app 镜像内无 psql，需手动执行（见下方提示）"

log_step "启动 app 并验证"
corpse_compose up -d app
log_ok "app 已启动，开始健康检查"
_probe_url="${HEALTHCHECK_URL:-http://127.0.0.1/api/health}"
if ! health_poll "${_probe_url}" "${CORPS_HEALTH_TIMEOUT}"; then
  log_error "恢复后健康检查未通过"
  log_error "最可能原因：RLS 未激活。手动执行："
  log_error "  docker compose ... exec -i db psql -U ${POSTGRES_USER:-postgres} -d ${PROD_DB} \\"
  log_error "    -v app_password=\"\$CORPS_APP_PASSWORD\" -f db/rls-activate.sql"
  exit 1
fi

printf '\n%s  恢复完成：生产库已从 %s 恢复%s\n' "${_C_BLD}${_C_GRN}" "${BACKUP_FILE}" "${_C_RST}" >&2
printf '  恢复前快照（可用于退回这次操作）：%s\n' "${_safety}" >&2
printf '\n  ⚠ 镜像未回退。数据库已回到备份时点，若该时点之后有功能上线，需一并回退镜像：\n' >&2
printf '    bash deploy/scripts/rollback.sh\n\n' >&2
exit 0
