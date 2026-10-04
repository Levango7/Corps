#!/usr/bin/env bash
# =============================================================================
# deploy/scripts/lib/common.sh — 部署脚本公共库（被 source，不单独执行）
# =============================================================================
# 本文件是 deploy/scripts/ 下所有脚本的共享底座，集中三件事：
#   1. 严格模式（set -euo pipefail）——在库里设一次，所有脚本继承
#   2. 路径解析——从任意 cwd 调用都能定位到仓库根
#   3. 统一日志格式与 compose 调用封装——保证所有脚本对 compose 的参数组合
#      完全一致（base + prod overlay + .env.prod），杜绝手工拼参数导致的漂移
#
# 设计约束（Spec §10）：所有 shell 脚本必须 set -euo pipefail。
# =============================================================================

# ── 严格模式 ─────────────────────────────────────────────────────────────────
# 注意：source 本文件时若已处于 set -u 环境，${BASH_SOURCE} 的间接引用是安全的。
set -euo pipefail

# ── 路径解析 ─────────────────────────────────────────────────────────────────
# deploy/scripts/lib/common.sh → deploy/scripts/lib → deploy/scripts → deploy → 仓库根
# 用 BASH_SOURCE 而非 $0，因为本文件是被 source 的，$0 指向调用方脚本。
_CORPS_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORPS_SCRIPTS_DIR="$(cd "${_CORPS_LIB_DIR}/.." && pwd)"
CORPS_DEPLOY_DIR="$(cd "${CORPS_SCRIPTS_DIR}/.." && pwd)"
CORPS_REPO_ROOT="$(cd "${CORPS_DEPLOY_DIR}/.." && pwd)"

CORPS_COMPOSE_BASE="${CORPS_REPO_ROOT}/docker-compose.yml"
CORPS_COMPOSE_PROD="${CORPS_DEPLOY_DIR}/docker-compose.prod.yml"
CORPS_ENV_PROD="${CORPS_DEPLOY_DIR}/.env.prod"
CORPS_VERSION_FILE="${CORPS_DEPLOY_DIR}/VERSION"

# 镜像仓库（与 .github/workflows/ci.yml 的 docker-publish 一致：
# images: ghcr.io/${{ github.repository }}，即 ghcr.io/<owner>/<repo>）
CORPS_IMAGE_REPO="${CORPS_IMAGE_REPO:-ghcr.io/levango7/corps}"

# 健康检查默认等待上限（秒）。AC-04 规定 120s。
CORPS_HEALTH_TIMEOUT="${CORPS_HEALTH_TIMEOUT:-120}"


# ── 日志 ─────────────────────────────────────────────────────────────────────
# 输出到 stderr，保证 stdout 只承载命令结果（便于调用方管道消费）
if [[ -t 2 ]]; then
  _C_RED=$'\033[31m'; _C_GRN=$'\033[32m'; _C_YEL=$'\033[33m'
  _C_BLU=$'\033[36m'; _C_RST=$'\033[0m'; _C_BLD=$'\033[1m'
else
  # 非 TTY（CI / 重定向到文件）时不用 ANSI 转义，避免日志里出现乱码
  _C_RED=""; _C_GRN=""; _C_YEL=""; _C_BLU=""; _C_RST=""; _C_BLD=""
fi

log_info()  { printf '%s[info]%s %s\n'  "${_C_BLU}" "${_C_RST}" "$*" >&2; }
log_ok()    { printf '%s[ ok ]%s %s\n'  "${_C_GRN}" "${_C_RST}" "$*" >&2; }
log_warn()  { printf '%s[warn]%s %s\n'  "${_C_YEL}" "${_C_RST}" "$*" >&2; }
log_error() { printf '%s[fail]%s %s\n'  "${_C_RED}" "${_C_RST}" "$*" >&2; }
log_step()  { printf '\n%s▸ %s%s\n'       "${_C_BLD}" "$*" "${_C_RST}" >&2; }

# die <退出码> <消息...>
die() {
  local code="$1"; shift
  log_error "$@"
  exit "${code}"
}


# ── .env.prod 加载 ───────────────────────────────────────────────────────────
# 说明：这里只做 export，不调用 `set -a`（部分发行版 bash 与 sh 行为不一致），
# 改为显式解析 KEY=VALUE。刻意不 source .env.prod：
#   1. source 会执行文件内容，等于把 .env.prod 当 shell 脚本跑，一个笔误就是任意命令执行
#   2. .env.prod 里的值可能含 # 与空格，source 语义与 compose 语义不一致
#
# 纯 bash 实现（不 fork sed/grep）：早期版本每行起两个 sed 子进程，在 Git Bash /
# Windows 上解析 80 行文件要几十秒，表现为"脚本卡住"。deploy.sh 每次上线都调它，
# 不能有这个开销。
#
# ⛔ CRLF 处理（Spec §11 已记录的历史坑）：Windows 编辑器保存的 .env.prod 带 \r，
#    不剥掉会让值变成 "0.2.0\r"——长度断言、URL 比对、compose 插值全部偏移一位，
#    且症状极难定位（看起来值是对的）。这里无条件剥 \r。
parse_env_file() {
  local file="$1"
  [[ -f "${file}" ]] || return 0
  local line key value
  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line%$'\r'}"                 # 剥 Windows 行尾
    # 跳过空行与注释行
    [[ "${line}" =~ ^[[:space:]]*$ ]] && continue
    [[ "${line}" =~ ^[[:space:]]*# ]] && continue
    [[ "${line}" == export\ * ]] && line="${line#export }"
    [[ "${line}" != *=* ]] && continue
    key="${line%%=*}"
    value="${line#*=}"
    # 剥掉成对引号
    if [[ "${#value}" -ge 2 && "${value:0:1}" == '"' && "${value: -1}" == '"' ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "${#value}" -ge 2 && "${value:0:1}" == "'" && "${value: -1}" == "'" ]]; then
      value="${value:1:${#value}-2}"
    fi
    # trim key 两侧空白（bash 允许 `KEY = value` 这类写法，虽不常见）
    key="${key#"${key%%[![:space:]]*}"}"
    key="${key%"${key##*[![:space:]]}"}"
    # 非法的 key 名（以数字开头等）直接跳过：export 会报错，
    # 在 set -e 下会让整个脚本静默退出，且报错信息指向 export 而非真正原因
    [[ "${key}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    export "${key}=${value}"
  done < "${file}"
}

# load_prod_env — 加载 deploy/.env.prod，缺失即退出（所有部署脚本的共同前置）
load_prod_env() {
  if [[ ! -f "${CORPS_ENV_PROD}" ]]; then
    die 2 "缺少 ${CORPS_ENV_PROD}
       首次部署：cp deploy/.env.prod.example deploy/.env.prod 后填入真实值
       该文件含真值密钥，已被 .gitignore 覆盖，切勿提交"
  fi
  parse_env_file "${CORPS_ENV_PROD}"
}


# ── compose 封装 ─────────────────────────────────────────────────────────────
# 所有脚本一律通过 corpse_compose 调用，参数组合写死在这里。
# 手工拼 compose 参数是本部署包最容易出错的地方：漏 -f prod overlay 会静默
# 以开发配置启动（db/app 端口暴露、app 现场 build），且不报错。
corpse_compose() {
  docker compose \
    -f "${CORPS_COMPOSE_BASE}" \
    -f "${CORPS_COMPOSE_PROD}" \
    --env-file "${CORPS_ENV_PROD}" \
    "$@"
}

# 渲染后的完整配置（合并结果），用于 preflight 断言
corpse_compose_config() {
  corpse_compose config "$@"
}

# 从渲染配置里读取断言所需字段（读 stdin 的 compose JSON）。
#
# 设计要点：
#   1. **不自己调 config**——由调用方渲染一次并管道过来。早期实现每断言调一次
#      config（每次都重新展开 LiveKit 的 101 个 UDP 端口），5 个断言跑出 35 秒，
#      表现为"preflight 卡住"。
#   2. **不落临时文件**——撞上部分沙箱禁止 rm 临时路径（SAFE_DELETE_INVALID_PATH），
#      整条断言会静默失败。
#   3. 输出经 shlex.quote 引用，可被 eval 安全展开。直接输出裸 JSON 会炸：
#      `LOG_DB={"driver": "json-file", ...}` 里的空格与括号被 shell 拆成多条命令，
#      实测报 "json-file,: command not found"。
#
# 不用 eval 拼 python 字符串：嵌套引号（eval('svc[ '.get(...)' ]')）必然踩到
# shell/python 双层转义地狱，实测直接 SyntaxError。
parse_assert_fields() {
  python3 -c '
import json, shlex, sys

try:
    cfg = json.load(sys.stdin)
except Exception as exc:
    sys.stderr.write("compose config 不是合法 JSON: %s\n" % exc)
    sys.exit(1)

svcs = cfg.get("services", {})
def svc(name):
    return svcs.get(name) or {}

app, db = svc("app"), svc("db")
redis, livekit, caddy = svc("redis"), svc("livekit"), svc("caddy")

out = {
    # AC-01
    "DB_PORTS": json.dumps(db.get("ports") or []),
    "APP_PORTS": json.dumps(app.get("ports") or []),
    "APP_HAS_BUILD": "1" if "build" in app else "0",
    "APP_IMAGE": app.get("image", ""),
    "CRON_IMAGE": svc("cron").get("image", ""),
    # AC-05
    "LOG_DB": json.dumps(db.get("logging") or {}),
    "LOG_APP": json.dumps(app.get("logging") or {}),
    "LOG_REDIS": json.dumps(redis.get("logging") or {}),
    "LOG_CRON": json.dumps(svc("cron").get("logging") or {}),
    "LOG_LIVEKIT": json.dumps(livekit.get("logging") or {}),
    "LOG_CADDY": json.dumps(caddy.get("logging") or {}),
    "REDIS_COMMAND": json.dumps(redis.get("command") or []),
    "LIVEKIT_PORTS": json.dumps([str(p.get("published")) for p in (livekit.get("ports") or [])]),
    "CADDY_PORTS": json.dumps([str(p.get("published")) for p in (caddy.get("ports") or [])]),
    "APP_URL": (app.get("environment") or {}).get("NEXT_PUBLIC_APP_URL", ""),
}
for k, v in out.items():
    # shlex.quote 保证含空格/括号的 JSON 值被 eval 后仍是单个词
    sys.stdout.write(k + "=" + shlex.quote(str(v).replace(chr(10), " ")) + chr(10))
' || return 1
}


# ── 版本文件 ─────────────────────────────────────────────────────────────────
read_current_version() {
  [[ -f "${CORPS_VERSION_FILE}" ]] || { printf 'none'; return 0; }
  tr -d '[:space:]' < "${CORPS_VERSION_FILE}"
}

write_current_version() {
  local tag="$1"
  printf '%s\n' "${tag}" > "${CORPS_VERSION_FILE}"
}


# ── 健康检查（healthcheck.sh 的实现，同时被 deploy.sh / rollback.sh 复用）────
# AC-04：轮询至明确成功或失败，上限 ${CORPS_HEALTH_TIMEOUT}s，**不得用 sleep 等待**。
# 这里用短间隔轮询 + 每次轮询自带 curl 超时，语义上是"轮询"而非"睡眠"。
# shell 层面不用 `sleep N` 一次性等待 ${TIMEOUT} 秒的那种写法。
#
# health_poll <URL> <超时秒数> — 返回 0 健康 / 1 超时或降级
health_poll() {
  local url="$1" timeout="${2:-${CORPS_HEALTH_TIMEOUT}}"
  local elapsed=0 interval=2 body code last_code="000" last_body=""

  while (( elapsed < timeout )); do
    # -m 2：单次请求最多 2s，避免应用挂死时单次探测卡满整个超时预算
    # -w '%{http_code}'：拿到状态码；应用 db 探测失败时返回 503
    #
    # ⛔ 不用 `curl -f`：-f 在 HTTP >= 400 时丢弃 body 并返回非 0，于是最常见的
    #    真实故障（应用返回 503 status=degraded，即数据库挂了）在这里显示为
    #    "最后响应：<无响应>"。排障的人会先查网络与反代，而真正原因是数据库探测
    #    失败——诊断信息把人引向错误方向。改为不带 -f，自己判状态码。
    body="$(curl -sS -m 2 -w '\n%{http_code}' "${url}" 2>/dev/null)" || true
    code="${body##*$'\n'}"
    body="${body%$'\n'*}"

    if [[ -n "${code}" ]]; then
      last_code="${code}"
      [[ -n "${body}" ]] && last_body="${body}"
    fi

    # 三条全满足才算健康。db:"up" 这条不能省：应用自身在 DB 探测失败时返回
    # 503，但反代在应用未启动时会返回自己的错误页（可能带 200 或 HTML），
    # 只看状态码会把这类响应判成健康。
    if [[ "${code}" == "200" ]] && [[ "${body}" == *'"status":"ok"'* ]] \
       && [[ "${body}" == *'"db":"up"'* ]]; then
      log_ok "健康检查通过（${elapsed}s）：${body}"
      return 0
    fi
    log_info "健康检查未通过（第 ${elapsed}s，HTTP ${code:-000}），${interval}s 后重试"
    # 轮询间隔：这是"重试节奏"而非"固定等待"，总时长受 timeout 约束
    sleep "${interval}"
    elapsed=$(( elapsed + interval ))
  done

  # 失败信息必须能区分三种情况，否则排障方向会错：
  #   000        → 连不上（网络/反代/端口）
  #   503/degraded → 应用活着但数据库探测失败 → 查数据库
  #   200 但内容不符 → 跑着的版本与预期不一致 → 查镜像 tag
  if [[ "${last_code}" == "000" ]]; then
    log_error "健康检查在 ${timeout}s 内未通过：无法连接 ${url}（HTTP 000）"
    log_error "  方向：网络/反代/端口。依次查：docker compose ps、docker logs corps-caddy、端口是否被占"
  elif [[ "${last_code}" == "503" ]]; then
    log_error "健康检查在 ${timeout}s 内未通过：应用返回 503（数据库探测失败）"
    log_error "  最后响应：${last_body:-<空>}"
    log_error "  方向：数据库。依次查："
    log_error "    docker compose ... ps db"
    log_error "    docker compose ... exec db pg_isready -U postgres"
    log_error "    docker logs corps-app --tail 50   # 找 'database probe failed'"
  else
    log_error "健康检查在 ${timeout}s 内未通过：最后 HTTP ${last_code}"
    log_error "  最后响应：${last_body:-<空>}"
    log_error "  若 HTTP 200 但内容不符预期，说明跑着的版本与预期不一致，核对 deploy/VERSION 与镜像 tag"
  fi
  return 1
}


# ── 工具函数 ─────────────────────────────────────────────────────────────────
# 端口是否被占用。
#
# ⛔ 这条判据踩过两个坑，都表现为**假绿**（真实占用报"空闲"）——比假红危险得多，
#    因为 preflight 会放行，然后 Caddy 绑定失败进入重启循环：
#   1. 固定列号：ss -ltn 的 Local Address 在第 4 列，netstat -ltn 在第 2 列。
#      写死某一列，换到另一套工具就恒返回"未占用"。
#   2. **netstat 参数不兼容**：Windows 的 netstat 不认 -ltn，会打印帮助文本。
#      awk 收到的是帮助行而非数据行，于是"没有匹配"→ 判定未占用。
#      本机实测：80/443 明明 LISTENING，脚本却报两个都空闲。
#
# 因此采用三层判定，任一命中即"占用"：
#   a. /dev/tcp 主动 connect —— 最可信的"真的有人在听"证据，Git Bash 与 Linux 都支持
#   b. ss（Linux 生产主路径）
#   c. netstat（自动探测参数形式，兼容 Windows -ano）
# 三者全不可用时返回 2（无法判定），由调用方决定是否放行。
port_in_use() {
  local port="$1"

  # a. TCP 连接探测：连得上就说明有人 listening。
  #    必须放**子 shell** 里做：`exec 3<>/dev/tcp/...` 会把当前 shell 的 fd 3
  #    真的替换掉，直接在函数体内做会污染调用方的重定向状态
  #    （实测：preflight 在此静默退出 1，无任何输出）。
  #    用 127.0.0.1：本部署只关心本机回环上的监听（容器端口绑定、遗留进程）。
  if (: >/dev/tcp/127.0.0.1/"${port}") 2>/dev/null; then
    return 0
  fi

  # b. ss（Linux）
  if command -v ss >/dev/null 2>&1; then
    if ss -ltn 2>/dev/null | awk -v p=":${port}\$" \
         '$1 == "LISTEN" { for (i = 1; i <= NF; i++) if ($i ~ p) { found = 1 } }
          END { exit found ? 0 : 1 }'; then
      return 0
    fi
  fi

  # c. netstat：Linux 用 -ltn，Windows 只认 -ano。先探测哪种可用。
  if command -v netstat >/dev/null 2>&1; then
    # Windows 形式：Proto Local Foreign State PID
    if netstat -ano 2>/dev/null | awk -v p=":${port}\$" \
         'tolower($NF) == "listening" || $0 ~ /LISTENING/ {
            for (i = 1; i <= NF; i++) if ($i ~ p) { found = 1 }
          } END { exit found ? 0 : 1 }'; then
      return 0
    fi
    # Linux 形式：Proto Recv-Q Send-Q Local Address Peer Address
    if netstat -ltn 2>/dev/null | awk -v p=":${port}\$" \
         '($1 == "tcp" || $1 == "TCP") { for (i = 1; i <= NF; i++) if ($i ~ p) { found = 1 } }
          END { exit found ? 0 : 1 }'; then
      return 0
    fi
  fi

  # 能执行到这里说明：/dev/tcp 连不上，且没有 ss/netstat 的阳性结果。
  # 若三类工具都不可用（极简容器镜像），交由调用方按"无法判定"处理。
  if ! command -v ss >/dev/null 2>&1 \
     && ! command -v netstat >/dev/null 2>&1 \
     && [[ ! -e /dev/tcp ]]; then
    return 2
  fi
  return 1
}

# 磁盘使用率（百分比数字，无 % 号）
disk_used_percent() {
  local path="$1"
  df -P "${path}" 2>/dev/null | awk 'NR==2 { gsub(/%/,"",$5); print $5 }'
}
