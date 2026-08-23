# corps · 团队 SaaS

面向中小团队的轻量协作工具，对标飞书/Notion，MVP 聚焦任务看板 + 多租户隔离。

## 技术栈

- **前端**: Next.js 16 (App Router) + React 19 + Tailwind CSS 4
- **后端**: Next.js Route Handlers (TypeScript)
- **数据库**: PostgreSQL 18.4 + Prisma 6 (RLS 行级安全)
- **认证**: Better Auth 1.3（身份/会话托管，scrypt 哈希）+ wid 作用域 JWT（15min access / 7d refresh，驱动 RLS）
- **计费**: Stripe 18（Checkout 订阅 + Customer Portal + Webhook 席位同步）
- **部署**: 腾讯云 CloudBase (后续)

## 本地验证步骤（用户本机执行）

> 沙箱环境限制说明：AI 开发沙箱内 `npm install` / `prisma generate` / `next build` 被安全策略拦截，以上步骤需在本机执行。代码已通过 `tsc --noEmit` 全量类型检查（本次改动文件 0 错误；剩余 20 个错误均为 Prisma Client 未生成 + 环境缺依赖所致，本机 `prisma generate` + `npm install` 后消除）。

### 1. 安装依赖

```bash
cd web
npm install --legacy-peer-deps
```

关键依赖（package.json 已锁定版本）：`better-auth@1.3.28`、`stripe@18.3.0`、`jsonwebtoken@9.0.2`、`@prisma/client@6.15.0`。

### 2. 启动数据库（Docker）

```bash
docker-compose up -d
# 等待就绪（约 10 秒）
docker exec -it corps-postgres pg_isready
```

### 3. 配置环境变量

```bash
cp .env.local.example .env.local
```

必填项：`DATABASE_URL`、`JWT_SECRET`、`NEXT_PUBLIC_APP_URL`。
计费相关（可选，不配则计费页显示"未配置"提示，不阻断其他功能）：`STRIPE_SECRET_KEY`、`STRIPE_PRICE_ID`、`STRIPE_WEBHOOK_SECRET`。

### 4. 生成 Prisma Client 并迁移

```bash
npx prisma generate
npx prisma migrate dev --name init
```

### 5. 启动开发服务器

```bash
npm run dev
```

访问 http://localhost:3000/auth/signup 注册账号。

### 6.（可选）Stripe 本地联调

```bash
# 安装 stripe-cli 后转发 webhook 到本地
stripe listen --forward-to localhost:3000/api/v1/billing/webhook
# 触发测试事件
stripe trigger checkout.session.completed
```

未配置 Stripe 时应用完全可用，仅升级/管理订阅按钮不可见。

## API 端点（MVP）

| Method | Path | 功能 |
|--------|------|------|
| POST | /api/v1/auth/register | 注册（Better Auth 建户）+ 创建首个工作区 + wid 令牌 |
| POST | /api/v1/auth/login | 登录 + wid 令牌 |
| POST | /api/v1/auth/refresh | 令牌轮换（可携带 workspaceId 换区） |
| GET | /api/health | 健康检查 |
| GET/POST | /api/v1/workspaces | 工作区列表/创建 |
| GET/PATCH | /api/v1/workspaces/:wid | 工作区详情（含 role）/ 改名改 slug（owner/admin） |
| GET/POST | /api/v1/workspaces/:wid/tasks | 任务列表/创建 |
| GET/PATCH/DELETE | /api/v1/workspaces/:wid/tasks/:id | 任务详情/更新/删除 |
| GET/POST | /api/v1/workspaces/:wid/tasks/:id/comments | 评论列表/新增 |
| GET/POST | /api/v1/workspaces/:wid/tasks/:id/decisions | 决策记录（版本自增、只追加） |
| GET | /api/v1/workspaces/:wid/members | 成员列表（含 isSelf） |
| POST | /api/v1/workspaces/:wid/members/invite | 邀请成员（需对方已注册） |
| GET | /api/v1/workspaces/:wid/billing/status | 订阅状态/席位占用 |
| POST | /api/v1/workspaces/:wid/billing/checkout | 创建 Stripe Checkout 会话 |
| POST | /api/v1/workspaces/:wid/billing/portal | 创建 Customer Portal 会话 |
| POST | /api/v1/billing/webhook | Stripe Webhook（席位同步，独立路径） |

## 项目结构

```
web/
├── app/
│   ├── api/v1/                # API 路由
│   │   ├── auth/              # 认证接口（Better Auth 托管身份）
│   │   ├── workspaces/[wid]/  # 工作区/任务/成员/计费接口
│   │   └── billing/webhook/   # Stripe Webhook
│   ├── auth/                  # 登录/注册页
│   └── w/[wid]/               # 工作区页面（概览/看板/任务详情/成员/计费/设置）
├── components/
│   ├── NewTaskDialog.tsx      # 新建任务弹窗（看板/概览共用）
│   ├── CommandPalette.tsx     # Cmd+K 命令面板
│   └── Markdown.tsx           # 零依赖 Markdown 渲染（决策记录用）
├── lib/
│   ├── prisma.ts              # Prisma 客户端
│   ├── auth.ts                # Better Auth 实例 + wid 上下文中间件 + runWithWorkspace(RLS)
│   ├── jwt.ts                 # wid 作用域 JWT 签发/验证
│   ├── api.ts                 # 前端 token-aware 客户端（401 自动轮换）
│   └── stripe.ts              # Stripe 客户端
├── prisma/
│   └── schema.prisma          # 数据库模型（含 Better Auth 会话表）
├── docker/
│   └── init-rls.sql           # RLS 初始化脚本
└── docker-compose.yml         # PostgreSQL 18.4
```

## MVP 范围

**P0 核心功能**：
- ✅ 注册登录 + 创建首个工作区（Better Auth）
- ✅ 任务看板（看板视图 + 拖拽改状态 + 新建任务弹窗）
- ✅ 任务详情页（属性编辑/评论/决策记录 Markdown）
- ✅ 成员邀请 + 三角色 RBAC
- ✅ 多租户数据隔离（PostgreSQL RLS）
- ✅ Stripe 计费（Checkout/Portal/Webhook 席位同步）
- ✅ 前端 UI 对齐设计原型（Calm Precision 设计系统）

**P1 后续迭代**：
- 端到端测试（AC-01 ~ AC-06 自动化）
- 全局搜索（Cmd+K 当前仅导航）
- Docker Compose 加入 Redis（缓存）

## 验收标准（EARS 格式）

| 编号 | 功能 | 标准 |
|------|------|------|
| AC-01 | 注册 | 创建账户 + 工作区 + owner 角色，返回 wid 令牌 |
| AC-02 | 注册 | 邮箱已存在返回 409 |
| AC-03 | 隔离 | 跨租户请求返回 404/403 |
| AC-05 | RBAC | Member 调用管理接口返回 403 |
| AC-06 | 看板 | 拖拽任务卡更新状态并持久化；决策记录只追加、版本自增 |

## 待办

- [ ] 端到端测试（用户本机 `npm run dev` 后按上方步骤手测核心流程）
- [ ] Docker Compose 加入 Redis（后续缓存）
