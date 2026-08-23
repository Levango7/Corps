#!/bin/bash
cd ~/corps-web
export DATABASE_URL="postgresql://corps:corps_dev_2026@localhost:5432/corps_dev?schema=public"

# 同步最新文件
cp /mnt/f/Nexus/corps/design/design-tokens.css ~/corps-web/app/design-tokens.css
cp /mnt/f/Nexus/corps/web/app/design-tokens.css ~/corps-web/app/design-tokens.css
cp /mnt/f/Nexus/corps/web/app/globals.css ~/corps-web/app/globals.css
cp /mnt/f/Nexus/corps/web/app/w/\[wid\]/layout.tsx ~/corps-web/app/w/\[wid\]/layout.tsx
cp /mnt/f/Nexus/corps/web/app/w/\[wid\]/settings/page.tsx ~/corps-web/app/w/\[wid\]/settings/page.tsx
cp /mnt/f/Nexus/corps/web/app/api/v1/auth/logout/route.ts ~/corps-web/app/api/v1/auth/logout/route.ts
cp /mnt/f/Nexus/corps/web/app/api/v1/users/me/route.ts ~/corps-web/app/api/v1/users/me/route.ts

npx prisma db push --force-reset --accept-data-loss 2>&1 | tail -1

# 注册测试用户
npx next dev > /tmp/next-ui-review.log 2>&1 &
DEV_PID=$!
for i in $(seq 1 30); do
  if grep -q "Ready" /tmp/next-ui-review.log 2>/dev/null; then break; fi
  sleep 2
done

# 注册并获取 cookie + workspace URL
RESP=$(curl -s -c /tmp/ui-cookies.txt -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"ui@corps.test","password":"Test1234!","name":"UI Reviewer","workspaceName":"UI Team"}')
WID=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['workspace']['id'])")
echo "WORKSPACE_ID=$WID"
echo "DEV_PID=$DEV_PID"

# 输出各页面 URL
echo "PAGES:"
echo "  login:    http://localhost:3000/auth/login"
echo "  signup:   http://localhost:3000/auth/signup"
echo "  overview: http://localhost:3000/w/$WID"
echo "  board:    http://localhost:3000/w/$WID/board"
echo "  members:  http://localhost:3000/w/$WID/members"
echo "  billing:  http://localhost:3000/w/$WID/billing"
echo "  settings: http://localhost:3000/w/$WID/settings"

# 保持 server 运行（不 kill）
echo "Server running. PID=$DEV_PID"