# corps 团队 SaaS - 项目落地

**项目路径**: `F:\Agent\workbuddy\workspace\corps\`

---

## 资产总览（51个文件，33个源码文件）

### 设计阶段（4轮迭代定稿）
```
design/
├── prototype/index.html          # 高保真原型（15页，全交互）
├── design-tokens.css             # Token系统（双主题+三层背景）
└── DESIGN.md                     # 设计系统文档
```

### 规格阶段（Phase 0-2）
```
spec/SPEC.md                      # MVP规格契约（锁定版）
api/openapi.yaml                  # 18端点API契约
db/schema.sql                     # 9表+RLS策略
docs/decisions/ADR-{001,002,003}.md  # 架构决策记录
```

### 后端工程（本次落地，28个文件）
```
web/
├── package.json                  # Next.js 16 + Prisma 6 + Better Auth + lucide-react
├── prisma/schema.prisma          # 9表模型（Workspace/User/Member/Task/Comment/Decision/Session/Subscription）
├── docker-compose.yml            # PostgreSQL 18.4 + RLS初始化
├── docker/init-rls.sql           # SET LOCAL app.workspace_id 注入
├── lib/
│   ├── prisma.ts                 # 单例Prisma客户端
│   ├── jwt.ts                    # access(15min) + refresh(7d)

│   └── auth.ts                   # 认证中间件 + RBAC守卫
├── app/
│   ├── globals.css               # CSS变量（对齐design-tokens.css）
│   ├── auth/login/signup/        # 登录注册页
│   ├── w/[wid]/board/members/settings/  # 工作区页面
│   └── api/v1/                   # 18个Route Handler
└── README.md
```

---

## 立即开始（用户本机执行）

```powershell
# 1. 安装依赖
cd F:\Agent\workbuddy\workspace\corps\web
npm install --legacy-peer-deps

# 2. 启动PostgreSQL
docker-compose up -d

# 3. 等待PG就绪
docker exec -it corps-postgres pg_isready

# 4. 配置环境变量
copy .env.local.example .env.local
# 修改 .env.local 中的密码

# 5. 生成 Prisma Client（必须，否则 tsc/运行时报 PrismaClient 未生成）
npx prisma generate

# 6. 运行迁移
npx prisma migrate dev --name init

# 7. 启动开发服务器
npm run dev
```

访问 http://localhost:3000/auth/signup 完成注册。
完整步骤（含 Stripe 本地联调）见 `web/README.md`。

---

## 核心流程（端到端）

```
注册 → 自动创建Workspace(owner) → 进入看板 → 拖拽任务改状态
     ↓
POST /api/v1/auth/register        返回 access+refresh JWT
POST /api/v1/workspaces           创建新工作区
GET  /api/v1/workspaces/:wid/tasks  查询任务列表
PATCH /api/v1/workspaces/:wid/tasks/:id  更新状态（拖拽）
```

---

## 多租户隔离（RLS）

```sql
-- 请求级注入 workspace context
SET LOCAL app.workspace_id = <JWT.wid>;

-- 所有业务表强制过滤
USING (workspace_id = current_setting('app.workspace_id')::uuid)
```

---

## 待办（后续迭代）

- [x] 前端 UI 对齐设计原型（Calm Precision 设计系统）—— 2026-08-22 完成
- [x] Better Auth 集成（身份/会话托管，wid JWT 驱动 RLS）—— 2026-08-22 完成
- [x] Stripe 计费（Checkout/Portal/Webhook 席位同步）—— 2026-08-22 完成
- [x] 任务详情 + 评论 + 决策记录完整实现 —— 2026-08-22 完成
- [ ] 端到端测试（本机 `npm run dev` 后手测，见 web/README.md 验证步骤）
- [ ] CloudBase 部署配置

---

## 技术栈锁定

| 层 | 技术 | 版本 |
|----|------|------|
| 前端 | Next.js + React | 16.2.6 / 19.2.0 |
| CSS | Tailwind CSS | 4.1.8 |
| ORM | Prisma | 6.15.0 |
| DB | PostgreSQL | 18.4（RLS） |
| 认证 | Better Auth（scrypt，偏差见 ADR-002/OPEN-DECISIONS） | 1.3.28 |
| 计费 | Stripe（Checkout/Portal/Webhook） | 18.3.0 |
| wid 令牌 | jsonwebtoken（15min access / 7d refresh） | 9.0.2 |
| 图标 | lucide-react | 0.513.0 |
| 校验 | zod | 3.24.4 |
