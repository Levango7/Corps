#!/usr/bin/env bash
# =============================================================================
# deploy/scripts/preflight.sh — 部署前置校验
# =============================================================================
# 目的：在真正动生产之前，把"一定会炸"的配置错误拦下来。
# 部署失败本身不是最坏的结果——最坏的是**部署到一半才发现 db 端口暴露**、
# **密钥是空的**这类问题，因为此时线上可能已经处于半损坏状态。
#
# 断言项（AC-01 强制项 + 运维前置）：
#   1. deploy/.env.prod 存在且可解析
#   2. CORPS_IMAGE_TAG 已设且 ≠ latest
#   3. app 服务无 build 段（生产禁现场 next build，2C4G 会 OOM）
#   4. db 服务无宿主机端口
#   5. app 服务无宿主机端口
#   6. app.image 指向 GHCR 且含 tag
#   7. 7 个必填密钥非空且长度达标
#   8. 密钥不得为历史泄漏值或示例占位值
#   9. 磁盘余量 > 20%
#  10. 80/443 未被占用
#  11. Compose 版本支持 !reset/!override（>= v2.24）
#  12. prod overlay 能成功渲染（语法正确性）
#
# 退出码：0 = 全部通过（可部署）；非 0 = 有断言失败，**禁止部署**
#
# 用法：
#   bash deploy/scripts/preflight.sh
# =============================================================================

# shellcheck source=lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

# 断言失败计数与清单。用数组收集，最后统一汇报——一次性列出所有问题，
# 而不是失败一条就退出（逐条失败要重启脚本十几轮，没人受得了）
declare -a FAILURES=()
declare -a CHECKED=()

fail() {
  FAILURES+=("$1")
  log_error "$1"
}

ok() {
  CHECKED+=("$1")
  log_ok "$1"
}

# ── 0. 环境加载 ──────────────────────────────────────────────────────────────
log_step "0/12 加载生产环境变量"
if [[ ! -f "${CORPS_ENV_PROD}" ]]; then
  fail "缺少 ${CORPS_ENV_PROD}（cp deploy/.env.prod.example deploy/.env.prod）"
  log_error "后续断言依赖该文件，已跳过。修正后重跑。"
  printf '\n%spreflight 失败：%d 项不通过%s\n' "${_C_BLD}${_C_RED}" "${#FAILURES[@]}" "${_C_RST}" >&2
  exit 2
fi
load_prod_env
ok "已加载 ${CORPS_ENV_PROD}"

# ── 1. 镜像 tag ──────────────────────────────────────────────────────────────
log_step "1/12 镜像 tag"
if [[ -z "${CORPS_IMAGE_TAG:-}" ]]; then
  fail "CORPS_IMAGE_TAG 未设置
       禁止留空：回滚需要确定性的版本标识。推荐 commit SHA（sha-<hash>）或语义化版本"
elif [[ "${CORPS_IMAGE_TAG}" == "latest" ]]; then
  fail "CORPS_IMAGE_TAG=latest 被明确禁止
       latest 是可变引用：回滚时无法确定'上一个版本'到底是哪个，回滚能力直接失效
       请改用 commit SHA（sha-<hash>）或语义化版本（如 0.2.0），二者均由 CI docker-publish 产出"
else
  ok "CORPS_IMAGE_TAG=${CORPS_IMAGE_TAG}（非 latest）"
fi

# ── 2. 依赖检查 ──────────────────────────────────────────────────────────────
log_step "2/12 依赖与 Compose 版本"
for bin in docker curl python3; do
  if ! command -v "${bin}" >/dev/null 2>&1; then
    fail "缺少命令 ${bin}（生产服务器需先安装）"
  fi
done
if ! docker compose version >/dev/null 2>&1; then
  fail "docker compose 不可用（需 Docker Compose v2，见 README §2）"
else
  # !reset / !override 需要 v2.24+（overlay 删除 ports/build 的语法基础）
  _cv="$(docker compose version --short 2>/dev/null | tr -d 'v' | cut -d. -f1,2)"
  if [[ "${_cv}" =~ ^([0-9]+)\.([0-9]+)$ ]] \
     && (( BASH_REMATCH[1] > 2 || (BASH_REMATCH[1] == 2 && BASH_REMATCH[2] >= 24) )); then
    ok "docker compose ${_cv}（支持 !reset/!override）"
  else
    fail "docker compose 版本过低（当前 ${_cv:-unknown}，需 >= v2.24）
       deploy/docker-compose.prod.yml 依赖 !reset 删除 db/app 的 ports 与 app 的 build 段，
       低版本会静默忽略这两个标签——overlay 看起来生效了，实际 db 端口仍暴露在宿主机"
  fi
fi

# ── 3. overlay 渲染 ──────────────────────────────────────────────────────────
# 语法正确性的机器判据。渲染失败时后续基于渲染结果的断言全部无法进行。
#
# 只渲染一次：渲染结果既用于"语法是否正确"的判定，也直接喂给字段解析。
# 早期实现分两步（先 config 存变量、再单独 config 一次取字段），
# 在本机要 40 秒以上——每次 config 都会重新展开 LiveKit 的 101 个 UDP 端口。
log_step "3/12 渲染 prod overlay"
DB_PORTS=""; APP_PORTS=""; APP_HAS_BUILD=""; APP_IMAGE=""; CRON_IMAGE=""
LOG_DB=""; LOG_APP=""; LOG_REDIS=""; LOG_CRON=""; LOG_LIVEKIT=""; LOG_CADDY=""
REDIS_COMMAND=""; LIVEKIT_PORTS=""; CADDY_PORTS=""; APP_URL=""

if ! _rendered="$(corpse_compose config 2>&1)"; then
  fail "prod overlay 渲染失败（compose -f docker-compose.yml -f deploy/docker-compose.prod.yml config）：
${_rendered}"
  RENDER_OK=0
else
  # 再取一次 JSON 形态（供字段解析）。仍是一次 config 调用。
  if ! _fields="$(corpse_compose config --format json 2>/dev/null | parse_assert_fields)"; then
    fail "无法解析渲染后的 compose 配置（JSON 解析失败）"
    RENDER_OK=0
  else
    eval "${_fields}"
    ok "overlay 渲染成功（base + prod overlay + .env.prod）"
    RENDER_OK=1
  fi
fi

# ── 4. db 无宿主机端口（AC-01）────────────────────────────────────────────────
# 判据从**渲染后的最终配置**读取，而不是读 overlay 文件本身。
# 因为"overlay 里写了什么"与"实际生效什么"是两件事，只查文件等于没查。
log_step "4/12 db 无宿主机端口（AC-01）"
if [[ "${RENDER_OK}" == "1" ]]; then
  if [[ "${DB_PORTS}" == "[]" ]]; then
    ok "db 无宿主机端口"
  else
    fail "db 暴露了宿主机端口：${DB_PORTS}
       生产数据库不得直接对外。检查 deploy/docker-compose.prod.yml 中 db.ports 是否为 !reset []。
       排障请改用：docker compose ... exec db psql（见 deploy/README.md §6）"
  fi
else
  log_warn "跳过（overlay 渲染失败，无法判定）"
fi

# ── 5. app 无宿主机端口 ──────────────────────────────────────────────────────
log_step "5/12 app 无宿主机端口"
if [[ "${RENDER_OK}" == "1" ]]; then
  if [[ "${APP_PORTS}" == "[]" ]]; then
    ok "app 无宿主机端口（唯一入口为 Caddy）"
  else
    fail "app 暴露了宿主机端口：${APP_PORTS}
       保留宿主机口等于留一条绕过反代的直连路径，限流的'可信对端'模型与 HSTS 均失效"
  fi
fi

# ── 6. app 无 build 段（AC-01）───────────────────────────────────────────────
log_step "6/12 app 无 build 段（AC-01）"
if [[ "${RENDER_OK}" == "1" ]]; then
  if [[ "${APP_HAS_BUILD}" == "0" ]]; then
    ok "app 无 build 段（生产只跑 CI 预构建镜像）"
  else
    fail "app 仍带 build 段，生产会执行现场 next build
       2C4G 机器上 next build 峰值内存超限会触发 OOM Killer，
       表现为构建中途被杀或整机卡死。检查 overlay 中 app.build 是否为 !reset null"
  fi
  # 顺带确认镜像确实指向 GHCR 预构建产物
  if [[ "${APP_IMAGE}" == ghcr.io/*:* ]]; then
    ok "app.image=${APP_IMAGE}（GHCR 带 tag）"
  else
    fail "app.image=${APP_IMAGE:-<空>} 不是 ghcr.io/<repo>:<tag> 形式
       固定 GHCR + 显式 tag 是回滚能力的前提：deploy.sh 依赖 tag 做版本切换与回退"
  fi
  if [[ "${CRON_IMAGE}" == "${APP_IMAGE}" ]]; then
    ok "cron.image 与 app 同 tag（避免跨版本路由不兼容静默 404）"
  else
    fail "cron.image=${CRON_IMAGE} 与 app.image=${APP_IMAGE} 不一致
       cron 调的是 app 的 /api/cron/* 路由，跨版本调用会静默 404 而不报错"
  fi
fi

# ── 6b. 日志上界（AC-05）─────────────────────────────────────────────────────
log_step "6b/12 容器日志有上界（AC-05）"
if [[ "${RENDER_OK}" == "1" ]]; then
  _log_bad=""
  for pair in "db:${LOG_DB}" "app:${LOG_APP}" "redis:${LOG_REDIS}" \
              "cron:${LOG_CRON}" "livekit:${LOG_LIVEKIT}" "caddy:${LOG_CADDY}"; do
    _svc="${pair%%:*}"; _lg="${pair#*:}"
    if [[ "${_lg}" != *'"max-size": "50m"'* || "${_lg}" != *'"max-file": "3"'* \
       || "${_lg}" != *'json-file'* ]]; then
      _log_bad="${_log_bad} ${_svc}"
    fi
  done
  if [[ -z "${_log_bad}" ]]; then
    ok "全部 6 个服务均配置 json-file + max-size=50m + max-file=3"
  else
    fail "以下服务缺日志上界：${_log_bad}
       容器日志无上界时会涨到几十 GB 打满磁盘，表现为'服务莫名重启'。
       检查 deploy/docker-compose.prod.yml 的 x-logging 锚点是否被所有服务引用"
  fi
  # Redis 内存上限：默认吃满可用内存，在 2C4G 上会把 PG 与应用一起挤到 OOM
  if [[ "${REDIS_COMMAND}" == *"--maxmemory"* && "${REDIS_COMMAND}" == *"allkeys-lru"* ]]; then
    ok "redis 已设 --maxmemory + allkeys-lru（2C4G 上防止挤占 PG 内存）"
  else
    fail "redis 未设内存上限：${REDIS_COMMAND}
       Redis 默认吃满可用内存，2C4G 机器上会把 PostgreSQL 与应用一起挤到 OOM。
       计数键自带 PEXPIRE 需持久化，淘汰策略应取 allkeys-lru"
  fi
  # LiveKit：7880 交给 Caddy，RTC 媒体端口必须保留
  if [[ "${LIVEKIT_PORTS}" == *7880* ]]; then
    fail "livekit 仍暴露 7880（应由 Caddy 反代，见 Caddyfile.d/20-livekit.conf）"
  elif [[ "${LIVEKIT_PORTS}" == *7881* ]]; then
    ok "livekit 7880 已交由 Caddy，7881/TCP 与 50000-50100/UDP 保留（Caddy 转不了 RTP）"
  else
    fail "livekit 丢失 7881/TCP 媒体端口：${LIVEKIT_PORTS:0:120}
       Caddy 是 L7 HTTP 代理，转发不了 RTP/UDP。砍掉后视频通话在公网完全不可用，
       但信令正常——看起来配置成功，实际看不到画面"
  fi
  if [[ "${CADDY_PORTS}" == *80* && "${CADDY_PORTS}" == *443* ]]; then
    ok "caddy 持有 80/443（唯一对外入口）"
  else
    fail "caddy 未持有 80/443：${CADDY_PORTS}"
  fi
fi

# ── 7. 必填密钥非空且长度达标 ───────────────────────────────────────────────
# 长度下限的依据：
#   *_SECRET    ≥32 字符——web/lib/env.ts 的 zod min(32)，不满足则 instrumentation
#                直接 process.exit(1)，容器反复重启，表现为"服务起不来但日志无有用信息"
#   *_PASSWORD  ≥16 字符——openssl rand -hex 16 的输出长度，作为"确实用了随机值"的
#                最低证据
log_step "7/12 必填密钥（7 项）非空且长度达标"
declare -a REQUIRED_SECRETS=(
  "POSTGRES_PASSWORD:16:数据库属主密码"
  "CORPS_APP_PASSWORD:16:RLS 运行时最小权限角色密码"
  "BETTER_AUTH_SECRET:32:认证签名密钥（env.ts zod min 32）"
  "JWT_ACCESS_SECRET:32:access token 签名（env.ts zod min 32）"
  "JWT_REFRESH_SECRET:32:refresh token 签名（env.ts zod min 32）"
  "CRON_SECRET:32:定时作业 Bearer 鉴权"
  "CALENDAR_CRYPTO_KEY:32:日历 OAuth token 的 AES-256-GCM 主密钥"
)
for entry in "${REQUIRED_SECRETS[@]}"; do
  IFS=":" read -r key minlen desc <<< "${entry}"
  val="${!key:-}"
  if [[ -z "${val}" ]]; then
    fail "${key} 未设置或为空（${desc}）"
  elif [[ "${#val}" -lt "${minlen}" ]]; then
    fail "${key} 长度 ${#val} < 要求 ${minlen}（${desc}）
       过短密钥不是配置瑕疵：JWT_REFRESH_SECRET/BETTER_AUTH_SECRET 低于 32 会让
       应用在 instrumentation 阶段 process.exit(1)，容器进入无限重启循环"
  else
    ok "${key} 已设置（长度 ${#val} ≥ ${minlen}）"
  fi
done

# ── 8. 密钥不得为泄漏值/占位值 ──────────────────────────────────────────────
# runbook-deploy §5 记录：2026-08-24 有示例密码进过版本库。
# 长度断言挡不住"用了一个看起来够长的占位符"，必须显式拒绝已知坏值。
log_step "8/12 密钥不得为历史泄漏值或示例占位值"
declare -a FORBIDDEN_LITERALS=(
  "cde5c8ed4f42f7bf880d0e46"
  "change-me"
  "CHANGE_ME"
  "replace-with"
  "your-256-bit"
  "please-change"
  "changeme"
  "secret123"
  "password123"
)
for key in POSTGRES_PASSWORD CORPS_APP_PASSWORD BETTER_AUTH_SECRET \
           JWT_ACCESS_SECRET JWT_REFRESH_SECRET CRON_SECRET CALENDAR_CRYPTO_KEY; do
  val="${!key:-}"
  [[ -z "${val}" ]] && continue   # 空值已在断言 7 报过，不重复
  for bad in "${FORBIDDEN_LITERALS[@]}"; do
    if [[ "${val}" == *"${bad}"* ]]; then
      fail "${key} 含已知坏值片段 '${bad}'
             2026-08-24 曾有示例密码进版本库（runbook §5），生产必须全部轮换为新生成值。
             生成：openssl rand -hex 32"
    fi
  done
done
ok "未发现已知坏值"

# ── 9. 磁盘余量 ──────────────────────────────────────────────────────────────
# 阈值 20% 的理由：一次 pg_dump 逻辑备份 + 一次镜像 pull（各数百 MB 至 1GB）
# 需要临时空间。剩余不足时备份会写一半失败，而失败点在写文件、不在逻辑，
# 极易被误判为"备份成功"。
log_step "9/12 磁盘余量 > 20%"
_df_target="${BACKUP_DIR:-${CORPS_DEPLOY_DIR}}"
_used_pct="$(disk_used_percent "${_df_target}" || true)"
if [[ -z "${_used_pct}" ]]; then
  fail "无法读取 ${_df_target} 的磁盘使用率（df 不可用或路径不存在）"
elif (( _used_pct >= 80 )); then
  fail "磁盘余量不足：${_df_target} 已用 ${_used_pct}%，要求已用 < 80%（余量 > 20%）
       一次 pg_dump + 一次镜像 pull 需要数百 MB 临时空间。
       清理：docker system df；检查是否有失控的容器日志（overlay 已配 max-size=50m）"
else
  ok "磁盘余量充足（${_df_target} 已用 ${_used_pct}%，余量 $(( 100 - _used_pct ))%）"
fi

# ── 10. 80/443 未被占用 ──────────────────────────────────────────────────────
# 占用不一定是错：首次部署时端口空闲，但若已有其他服务在跑，Caddy 会绑定失败。
# 必须在部署前发现，而不是等 Caddy 反复重启再回头查是谁占了。
log_step "10/12 80/443 未被占用"
for port in 80 443; do
  set +e
  port_in_use "${port}"
  _rc=$?
  set -e
  case "${_rc}" in
    0)  fail "端口 ${port} 已被占用
         Caddy 需要独占 80/443。占用者请先停止：
           ss -ltnp | grep ':${port}'
         若占用者是本项目上一次的 corps-caddy 容器，属正常（说明服务在跑）" ;;
    2)  fail "无法判定端口 ${port} 是否被占用（ss 与 netstat 均不可用）" ;;
    *)  ok "端口 ${port} 空闲" ;;
  esac
done

# ── 11. 反代地址与 URL 一致性 ────────────────────────────────────────────────
# 两者不一致的典型故障：Caddy 签的是 a.com 的证书，NEXT_PUBLIC_APP_URL 却是 b.com，
# 表现为"OAuth 回调跳回 b.com 后登录态丢失"、"分享链接指向错误域名"。
log_step "11/12 CORPS_SITE_ADDRESS / NEXT_PUBLIC_APP_URL / ACME_EMAIL"
_sa="${CORPS_SITE_ADDRESS:-}"
_url="${NEXT_PUBLIC_APP_URL:-}"
if [[ -z "${_sa}" ]]; then
  fail "CORPS_SITE_ADDRESS 未设置
       备案后填域名（如 corps.example.com）走自动 HTTPS；
       备案期填 http://<公网IP>（未备案域名解析到境内 IP 会被运营商拦截，见 README §5）"
else
  ok "CORPS_SITE_ADDRESS=${_sa}"
fi
if [[ -z "${_url}" ]]; then
  fail "NEXT_PUBLIC_APP_URL 未设置（生产必填，middleware 的 HSTS 与 secure cookie 依赖）"
else
  _sa_host="${_sa#http://}"; _sa_host="${_sa_host#https://}"; _sa_host="${_sa_host%%/*}"
  _url_host="${_url#http://}"; _url_host="${_url_host#https://}"; _url_host="${_url_host%%/*}"
  if [[ "${_sa_host}" == "${_url_host}" ]]; then
    ok "NEXT_PUBLIC_APP_URL 主机名与 CORPS_SITE_ADDRESS 一致（${_url_host}）"
  else
    fail "域名不一致：CORPS_SITE_ADDRESS=${_sa_host} vs NEXT_PUBLIC_APP_URL=${_url_host}
         不一致会导致 OAuth 回调跳错域、分享链接指向错误域名、secure cookie 不下发"
  fi
fi
if [[ -z "${ACME_EMAIL:-}" ]]; then
  fail "ACME_EMAIL 未设置
       留空则收不到 Let's Encrypt 的证书到期与账户通知（提前 30 天），证书过期才发现"
else
  ok "ACME_EMAIL 已设置"
fi

# ── 12. 备份目录 ─────────────────────────────────────────────────────────────
# 部署包的价值有一半在"出事能回退"。备份目录不存在 = 回退链的第一环缺失，
# 而这恰恰是最容易被"先上线再说"跳过的一步。
log_step "12/12 备份目录可写"
_bdir="${BACKUP_DIR:-}"
if [[ -z "${_bdir}" ]]; then
  fail "BACKUP_DIR 未设置（deploy.sh 每次上线前触发一次备份，无处可写）"
elif [[ ! -d "${_bdir}" ]]; then
  fail "备份目录 ${_bdir} 不存在（先 mkdir -p ${_bdir}）
       这是宿主机路径，容器内看不到。deploy.sh 与 restore.sh 都依赖它"
elif [[ ! -w "${_bdir}" ]]; then
  fail "备份目录 ${_bdir} 不可写（当前用户无写权限）"
else
  _n_backups="$(find "${_bdir}" -maxdepth 1 -name 'corps_*.sql.gz' 2>/dev/null | wc -l | tr -d ' ')"
  if (( _n_backups == 0 )); then
    log_warn "备份目录 ${_bdir} 中没有任何 corps_*.sql.gz —— 首次部署属正常，但请确认备份 cron 已落地（README §7）"
  fi
  ok "备份目录 ${_bdir} 可写（现有 ${_n_backups} 份备份）"
fi

# ── 汇总 ─────────────────────────────────────────────────────────────────────
printf '\n%s════════════════════════════════════════════════════════════%s\n' "${_C_BLD}" "${_C_RST}" >&2
if (( ${#FAILURES[@]} == 0 )); then
  printf '%s  preflight 通过：%d 项断言全部满足，可以部署%s\n' \
    "${_C_BLD}${_C_GRN}" "${#CHECKED[@]}" "${_C_RST}" >&2
  printf '%s════════════════════════════════════════════════════════════%s\n' "${_C_BLD}" "${_C_RST}" >&2
  printf '  当前已部署版本：%s\n' "$(read_current_version)" >&2
  printf '  待部署版本：    %s\n' "${CORPS_IMAGE_TAG:-<未设置>}" >&2
  printf '\n  下一步：bash deploy/scripts/deploy.sh\n\n' >&2
  exit 0
else
  printf '%s  preflight 失败：%d 项不通过、%d 项通过%s\n' \
    "${_C_BLD}${_C_RED}" "${#FAILURES[@]}" "${#CHECKED[@]}" "${_C_RST}" >&2
  printf '%s════════════════════════════════════════════════════════════%s\n' "${_C_BLD}" "${_C_RST}" >&2
  local_i=1
  for f in "${FAILURES[@]}"; do
    printf '  %d) %s\n' "${local_i}" "${f}" >&2
    local_i=$(( local_i + 1 ))
  done
  printf '\n  禁止部署。修正上述问题后重跑 preflight。\n\n' >&2
  exit 1
fi
