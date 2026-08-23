#!/bin/bash
# Corps 生产环境验证脚本
set -e

BASE_URL="http://localhost:3000"
echo "=========================================================="
echo "  Corps 生产环境验证"
echo "=========================================================="

# 1. 健康检查
echo ""
echo "─── 1. 健康检查端点 ───"
HEALTH=$(curl -s "$BASE_URL/api/health")
echo "响应: $HEALTH"

# 2. 页面访问
echo ""
echo "─── 2. 页面访问 ───"
echo "首页: $(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/")"
echo "登录页: $(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/auth/login")"
echo "注册页: $(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/auth/signup")"

# 3. Better Auth
echo ""
echo "─── 3. Better Auth 端点 ───"
AUTH_OK=$(curl -s "$BASE_URL/api/auth/ok")
echo "Auth OK: $AUTH_OK"

# 4. Workspaces API（未认证应返回 401）
echo ""
echo "─── 4. Workspaces API（未认证）───"
WS_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/v1/workspaces")
echo "HTTP Status: $WS_CODE (预期: 401)"

# 5. 注册 API
echo ""
echo "─── 5. 注册 API ───"
SIGNUP_RESP=$(curl -s -w "\nHTTP:%{http_code}" -X POST "$BASE_URL/api/auth/sign-up/email" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@corps.dev","password":"Test123456!","name":"Test User"}')
echo "响应: $SIGNUP_RESP"

# 6. 登录 API
echo ""
echo "─── 6. 登录 API ───"
LOGIN_RESP=$(curl -s -w "\nHTTP:%{http_code}" -c /tmp/corps-cookies.txt -X POST "$BASE_URL/api/auth/sign-in/email" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@corps.dev","password":"Test123456!"}')
echo "响应: $LOGIN_RESP"

# 7. 使用登录后的 cookie 访问 workspaces API
echo ""
echo "─── 7. 认证后访问 Workspaces API ───"
WS_AUTH_RESP=$(curl -s -w "\nHTTP:%{http_code}" -b /tmp/corps-cookies.txt "$BASE_URL/api/v1/workspaces")
echo "响应: $WS_AUTH_RESP"

# 8. 数据库表验证
echo ""
echo "─── 8. 数据库表验证 ───"
DB_TABLES=$(docker exec corps-db psql -U postgres -d corps -c "\dt" 2>&1)
echo "$DB_TABLES"

# 9. 用户数据验证
echo ""
echo "─── 9. 用户数据验证 ───"
DB_USERS=$(docker exec corps-db psql -U postgres -d corps -c "SELECT id, email, name FROM users;" 2>&1)
echo "$DB_USERS"

echo ""
echo "=========================================================="
echo "  验证完成"
echo "=========================================================="