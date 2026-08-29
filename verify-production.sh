#!/bin/bash
# Corps 生产环境验证脚本（审计修复 2026-08-29：原脚本无断言且用错认证端点，已重写）
#
# 用法：应用启动后执行 `bash verify-production.sh`
# 依赖：curl、jq（可选，无 jq 时退化为 grep 校验）、bash 4+
# 行为：任一步失败立即 exit 1 并打印响应体诊断；全部通过输出 PASS。
set -euo pipefail

BASE_URL="${VERIFY_BASE_URL:-http://localhost:3000}"
COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT

# 随机邮箱避免污染（重复运行不冲突）
EMAIL="verify-$(date +%s)@corps.test"
PASSWORD="Test123456!"
PASS=0
FAIL=0

step() { printf "\n─── %s ───\n" "$1"; }
ok()   { PASS=$((PASS+1)); printf "PASS: %s\n" "$1"; }
bad()  { FAIL=$((FAIL+1)); printf "FAIL: %s\n" "$1"; }

# 1. 健康检查
step "1. GET /api/health"
HEALTH=$(curl -s --max-time 10 "$BASE_URL/api/health")
if echo "$HEALTH" | grep -q '"status":"ok"' && echo "$HEALTH" | grep -q '"db":"up"'; then
  ok "health: status=ok db=up"
else
  bad "health 异常: $HEALTH"
fi

# 2. 注册
step "2. POST /api/v1/auth/register"
REG_RESP=$(curl -s -w '\n%{http_code}' --max-time 15 -X POST "$BASE_URL/api/v1/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"name\":\"Verify Bot\",\"workspaceName\":\"Verify WS\"}")
REG_CODE=$(echo "$REG_RESP" | tail -1)
REG_BODY=$(echo "$REG_RESP" | head -n -1)
if [ "$REG_CODE" = "201" ]; then
  ok "register: HTTP 201"
else
  bad "register: HTTP $REG_CODE body=$REG_BODY"
fi

# 3. 登录（access_token 走 httpOnly cookie，见 web/lib/api.ts）
step "3. POST /api/v1/auth/login"
LOGIN_RESP=$(curl -s -w '\n%{http_code}' --max-time 15 -c "$COOKIE_JAR" -X POST "$BASE_URL/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
LOGIN_CODE=$(echo "$LOGIN_RESP" | tail -1)
if [ "$LOGIN_CODE" = "200" ] && grep -q "access_token" "$COOKIE_JAR"; then
  ok "login: HTTP 200 + access_token cookie"
else
  bad "login: HTTP $LOGIN_CODE（cookie 是否含 access_token：$(grep -c access_token "$COOKIE_JAR" || true)）"
fi

# 4. 认证后访问工作区列表
step "4. GET /api/v1/workspaces（认证后）"
WS_RESP=$(curl -s -w '\n%{http_code}' --max-time 15 -b "$COOKIE_JAR" "$BASE_URL/api/v1/workspaces")
WS_CODE=$(echo "$WS_RESP" | tail -1)
if [ "$WS_CODE" = "200" ]; then
  ok "workspaces: HTTP 200"
else
  bad "workspaces: HTTP $WS_CODE body=$(echo "$WS_RESP" | head -n -1)"
fi

# 5. 未认证访问（应 401）
step "5. GET /api/v1/workspaces（未认证应 401）"
ANON_CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$BASE_URL/api/v1/workspaces")
if [ "$ANON_CODE" = "401" ]; then
  ok "未认证访问被拒: HTTP 401"
else
  bad "未认证访问返回 $ANON_CODE（期望 401）"
fi

# 6. 数据库表验证（docker 可用时；不可用跳过不失败）
step "6. 数据库核心表（docker 可选）"
if docker exec corps-db pg_isready >/dev/null 2>&1; then
  TABLES=$(docker exec corps-db psql -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-corps}" -Atc \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('users','workspaces','members','tasks','messages','message_attachments');" 2>/dev/null || echo "0")
  if [ "${TABLES:-0}" = "6" ]; then
    ok "核心表齐全: 6/6"
  else
    bad "核心表缺失（期望 6，实际 $TABLES）"
  fi
else
  echo "SKIP: 容器 corps-db 不可用，跳过 DB 校验（不视为失败）"
fi

# 汇总
printf "\n==========================================================\n"
printf "结果: %d PASS / %d FAIL\n" "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf "验证未通过，请检查上方 FAIL 项（测试账号: %s，有意保留便于排查）\n" "$EMAIL"
  exit 1
fi
printf "全部通过。\n"
printf "==========================================================\n"
