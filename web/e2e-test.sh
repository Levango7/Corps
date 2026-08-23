#!/bin/bash
# E2E API + 页面渲染测试脚本
# 在 ~/corps-web/web 目录执行

set +e  # 不因错误退出，继续运行所有测试

cd ~/corps-web/web || { echo "ERROR: cannot cd to ~/corps-web/web"; exit 1; }

# 手动执行 predev：复制 design-tokens.css
cp ~/corps-web/design/design-tokens.css ~/corps-web/web/app/design-tokens.css 2>&1 && echo "design-tokens.css copied" || echo "WARN: design-tokens.css copy failed"

echo "=== Starting dev server (npx next dev) ==="
# 用 npx next dev 绕过 pnpm 的 install 检查（ignored builds 导致 pnpm dev 失败）
npx next dev --turbopack > /tmp/dev-server.log 2>&1 &
DEV_PID=$!
echo "Dev server PID: $DEV_PID"

# 等待 server 就绪
SERVER_READY=0
for i in $(seq 1 60); do
  if curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 2>/dev/null | grep -qE "200|307|302"; then
    echo "Server ready (after ${i} attempts, ~$((i*2))s)"
    SERVER_READY=1
    break
  fi
  sleep 2
done

if [ "$SERVER_READY" = "0" ]; then
  echo "ERROR: Server not ready after 120s"
  echo "=== dev-server.log (last 30) ==="
  tail -30 /tmp/dev-server.log
  kill $DEV_PID 2>/dev/null
  wait $DEV_PID 2>/dev/null
  exit 1
fi

BASE=http://localhost:3000

echo ""
echo "=== Register test user ==="
REG=$(curl -s -X POST $BASE/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"ui@corps.test","password":"Test1234!","name":"UI测试员","workspaceName":"UI测试工作区"}')
echo "Register response: $(echo "$REG" | head -c 500)"

# 提取 accessToken 和 workspace ID（字段名是 accessToken 不是 token）
TOKEN=$(echo "$REG" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('data',{}).get('accessToken',''))" 2>/dev/null)
WID=$(echo "$REG" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('data',{}).get('workspace',{}).get('id',''))" 2>/dev/null)

echo "Token: ${TOKEN:0:30}..."
echo "Workspace ID: $WID"

# 如果注册失败（用户已存在），尝试登录
if [ -z "$TOKEN" ] || [ "$TOKEN" = "None" ] || [ "$TOKEN" = "" ]; then
  echo ""
  echo "=== Register failed, trying login ==="
  LOGIN=$(curl -s -X POST $BASE/api/v1/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"ui@corps.test","password":"Test1234!"}')
  echo "Login response: $(echo "$LOGIN" | head -c 500)"
  TOKEN=$(echo "$LOGIN" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('data',{}).get('accessToken',''))" 2>/dev/null)
  # 获取 workspace list
  WS=$(curl -s $BASE/api/v1/workspaces -H "Cookie: access_token=$TOKEN")
  echo "Workspaces: $WS"
  WID=$(echo "$WS" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('data',[{}])[0].get('id',''))" 2>/dev/null)
  echo "Login token: ${TOKEN:0:30}..."
  echo "Workspace ID from list: $WID"
fi

if [ -z "$TOKEN" ] || [ "$TOKEN" = "None" ] || [ "$TOKEN" = "" ]; then
  echo "FATAL: No token obtained, cannot continue API tests"
  kill $DEV_PID 2>/dev/null
  wait $DEV_PID 2>/dev/null
  exit 1
fi

echo ""
echo "===== E2E API Tests ====="
PASS=0
FAIL=0
FAIL_DETAILS=""

# 测试 1: 获取工作区列表
R=$(curl -s -o /dev/null -w "%{http_code}" $BASE/api/v1/workspaces -H "Cookie: access_token=$TOKEN")
if [ "$R" = "200" ]; then PASS=$((PASS+1)); echo "PASS 1: workspaces API ($R)"; else FAIL=$((FAIL+1)); echo "FAIL 1: workspaces API ($R)"; FAIL_DETAILS="$FAIL_DETAILS\n- workspaces API: $R"; fi

# 测试 2: 获取任务列表
R=$(curl -s -o /dev/null -w "%{http_code}" $BASE/api/v1/workspaces/$WID/tasks -H "Cookie: access_token=$TOKEN")
if [ "$R" = "200" ]; then PASS=$((PASS+1)); echo "PASS 2: tasks list ($R)"; else FAIL=$((FAIL+1)); echo "FAIL 2: tasks list ($R)"; FAIL_DETAILS="$FAIL_DETAILS\n- tasks list: $R"; fi

# 测试 3: 创建任务
TASK=$(curl -s -X POST $BASE/api/v1/workspaces/$WID/tasks \
  -H "Content-Type: application/json" \
  -H "Cookie: access_token=$TOKEN" \
  -d '{"title":"UI测试任务","status":"todo","priority":"medium"}')
echo "Create task response: $(echo "$TASK" | head -c 300)"
TID=$(echo "$TASK" | python3 -c "import json,sys; print(json.load(sys.stdin).get('data',{}).get('id',''))" 2>/dev/null)
if [ -n "$TID" ] && [ "$TID" != "" ] && [ "$TID" != "None" ]; then PASS=$((PASS+1)); echo "PASS 3: create task ($TID)"; else FAIL=$((FAIL+1)); echo "FAIL 3: create task"; FAIL_DETAILS="$FAIL_DETAILS\n- create task: $TASK"; fi

# 测试 4: 获取任务详情
R=$(curl -s -o /dev/null -w "%{http_code}" $BASE/api/v1/workspaces/$WID/tasks/$TID -H "Cookie: access_token=$TOKEN")
if [ "$R" = "200" ]; then PASS=$((PASS+1)); echo "PASS 4: task detail ($R)"; else FAIL=$((FAIL+1)); echo "FAIL 4: task detail ($R)"; FAIL_DETAILS="$FAIL_DETAILS\n- task detail: $R"; fi

# 测试 5: 获取成员
R=$(curl -s -o /dev/null -w "%{http_code}" $BASE/api/v1/workspaces/$WID/members -H "Cookie: access_token=$TOKEN")
if [ "$R" = "200" ]; then PASS=$((PASS+1)); echo "PASS 5: members ($R)"; else FAIL=$((FAIL+1)); echo "FAIL 5: members ($R)"; FAIL_DETAILS="$FAIL_DETAILS\n- members: $R"; fi

# 测试 6: 搜索
R=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/v1/workspaces/$WID/search?q=UI" -H "Cookie: access_token=$TOKEN")
if [ "$R" = "200" ]; then PASS=$((PASS+1)); echo "PASS 6: search ($R)"; else FAIL=$((FAIL+1)); echo "FAIL 6: search ($R)"; FAIL_DETAILS="$FAIL_DETAILS\n- search: $R"; fi

# 测试 7: logout
R=$(curl -s -o /dev/null -w "%{http_code}" -X POST $BASE/api/v1/auth/logout -H "Cookie: access_token=$TOKEN")
if [ "$R" = "200" ] || [ "$R" = "204" ]; then PASS=$((PASS+1)); echo "PASS 7: logout ($R)"; else FAIL=$((FAIL+1)); echo "FAIL 7: logout ($R)"; FAIL_DETAILS="$FAIL_DETAILS\n- logout: $R"; fi

# 测试 8: users/me
R=$(curl -s -o /dev/null -w "%{http_code}" $BASE/api/v1/users/me -H "Cookie: access_token=$TOKEN")
if [ "$R" = "200" ]; then PASS=$((PASS+1)); echo "PASS 8: users/me ($R)"; else FAIL=$((FAIL+1)); echo "FAIL 8: users/me ($R)"; FAIL_DETAILS="$FAIL_DETAILS\n- users/me: $R"; fi

echo ""
echo "===== Page Render Tests ====="

# 测试 9: 登录页
R=$(curl -s -o /dev/null -w "%{http_code}" $BASE/auth/login)
if [ "$R" = "200" ]; then PASS=$((PASS+1)); echo "PASS 9: login page ($R)"; else FAIL=$((FAIL+1)); echo "FAIL 9: login page ($R)"; FAIL_DETAILS="$FAIL_DETAILS\n- login page: $R"; fi

# 测试 10: 注册页
R=$(curl -s -o /dev/null -w "%{http_code}" $BASE/auth/signup)
if [ "$R" = "200" ]; then PASS=$((PASS+1)); echo "PASS 10: signup page ($R)"; else FAIL=$((FAIL+1)); echo "FAIL 10: signup page ($R)"; FAIL_DETAILS="$FAIL_DETAILS\n- signup page: $R"; fi

# 测试 11: 工作区页面
R=$(curl -s -o /dev/null -w "%{http_code}" $BASE/w/$WID -H "Cookie: access_token=$TOKEN")
if [ "$R" = "200" ]; then PASS=$((PASS+1)); echo "PASS 11: workspace page ($R)"; else FAIL=$((FAIL+1)); echo "FAIL 11: workspace page ($R)"; FAIL_DETAILS="$FAIL_DETAILS\n- workspace page: $R"; fi

# 测试 12: 看板页面
R=$(curl -s -o /dev/null -w "%{http_code}" $BASE/w/$WID/board -H "Cookie: access_token=$TOKEN")
if [ "$R" = "200" ]; then PASS=$((PASS+1)); echo "PASS 12: board page ($R)"; else FAIL=$((FAIL+1)); echo "FAIL 12: board page ($R)"; FAIL_DETAILS="$FAIL_DETAILS\n- board page: $R"; fi

# 测试 13: 成员页面
R=$(curl -s -o /dev/null -w "%{http_code}" $BASE/w/$WID/members -H "Cookie: access_token=$TOKEN")
if [ "$R" = "200" ]; then PASS=$((PASS+1)); echo "PASS 13: members page ($R)"; else FAIL=$((FAIL+1)); echo "FAIL 13: members page ($R)"; FAIL_DETAILS="$FAIL_DETAILS\n- members page: $R"; fi

# 测试 14: 设置页面
R=$(curl -s -o /dev/null -w "%{http_code}" $BASE/w/$WID/settings -H "Cookie: access_token=$TOKEN")
if [ "$R" = "200" ]; then PASS=$((PASS+1)); echo "PASS 14: settings page ($R)"; else FAIL=$((FAIL+1)); echo "FAIL 14: settings page ($R)"; FAIL_DETAILS="$FAIL_DETAILS\n- settings page: $R"; fi

# 测试 15: 计费页面
R=$(curl -s -o /dev/null -w "%{http_code}" $BASE/w/$WID/billing -H "Cookie: access_token=$TOKEN")
if [ "$R" = "200" ]; then PASS=$((PASS+1)); echo "PASS 15: billing page ($R)"; else FAIL=$((FAIL+1)); echo "FAIL 15: billing page ($R)"; FAIL_DETAILS="$FAIL_DETAILS\n- billing page: $R"; fi

echo ""
echo "===== E2E Test Summary ====="
echo "PASS: $PASS"
echo "FAIL: $FAIL"
echo "TOTAL: $((PASS+FAIL))"
if [ -n "$FAIL_DETAILS" ]; then
  echo ""
  echo "===== Failure Details ====="
  echo -e "$FAIL_DETAILS"
fi

# 关闭 dev server
echo ""
echo "=== Stopping dev server ==="
kill $DEV_PID 2>/dev/null
# 杀掉所有子进程
pkill -P $DEV_PID 2>/dev/null
wait $DEV_PID 2>/dev/null
echo "Server stopped"

# 输出结果到文件供后续读取
echo "$PASS" > /tmp/e2e_pass.txt
echo "$FAIL" > /tmp/e2e_fail.txt
echo "DONE"