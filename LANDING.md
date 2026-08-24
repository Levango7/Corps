# corps 团队 SaaS - MVP 落地报告

> 落地日期：2026-08-22
> 项目路径：`F:\Nexus\corps\`

---

## 一、项目总览

**corps** 是面向 5-30 人中小团队的轻量协作 SaaS，对标飞书/Notion，MVP 聚焦"工作区任务看板"。

### 技术栈（Spec 锁定）

| 层 | 技术 | 版本 |
|----|------|------|
| 前端框架 | Next.js (App Router) | 16.2.6 |
| 运行时 | React | 19.2.0 |
| CSS | Tailwind CSS | 4.1.8 |
| ORM | Prisma | 6.15.0 |
| 数据库 | PostgreSQL | 18 (RLS) |
| 密码哈希 | scrypt（Better Auth 默认） | 随 better-auth 1.3.28 |
| 图标 | lucide-react | 0.513.0 |
| 校验 | zod | 3.24.4 |

---

## 二、资产清单（60+文件）

### 设计阶段（已完成）
| 文件 | 说明 |
|------|------|
| `design/prototype/index.html` | 高保真原型（15页全交互） |
| `design/design-tokens.css` | Token系统（双主题+三层背景+边界特效） |
| `design/DESIGN.md` | 设计系统文档 |

### 规格阶段（已完成）
| 文件 | 说明 |
|------|------|
| `spec/SPEC.md` | MVP规格契约（P0/P1功能、API端点、验收标准） |
| `api/openapi.yaml` | 27个端点OpenAPI定义 |
| `db/schema.sql` | 15表DDL+RLS策略（含迁移排序修正） |
| `docs/decisions/ADR-*.md` | 架构决策记录（6份，含 ADR-006 RLS 信任模型） |

### 后端工程（本次落地，28个文件）
```
web/
├── package.json                 # 依赖声明（版本钉死）
├── tsconfig.json               # TypeScript严格模式
├── next.config.ts              # 安全头+standalone输出
├── tailwind.config.ts          # Tailwind v4配置
├── prisma/schema.prisma        # 15表模型+索引
├── docker-compose.yml          # PostgreSQL 18容器
├── docker/init-rls.sql         # RLS上下文函数
├── lib/
│   ├── prisma.ts               # 单例Prisma客户端
│   ├── jwt.ts                  # JWT生成/验证

│   └── auth.ts                 # 认证中间件+RBAC
├── app/
│   ├── globals.css             # CSS变量（对齐design-tokens）
│   ├── auth/login/signup/      # 登录注册页
│   ├── w/[wid]/board/members/settings/  # 工作区页面
│   └── api/v1/                 # 31个Route Handler（27 API路径）
└── README.md
```

---

## 三、核心功能实现

### 认证系统
- `POST /api/v1/auth/register` - 注册+自动创建首个工作区+owner角色
- `POST /api/v1/auth/login` - 登录+返回access+refresh JWT
- `POST /api/v1/auth/refresh` - 令牌轮换（7天有效期）

### 工作区与任务
- `GET/POST /api/v1/workspaces` - 工作区列表/创建
- `GET/POST /api/v1/workspaces/:wid/tasks` - 任务列表/创建
- `PATCH/DELETE /api/v1/workspaces/:wid/tasks/:id` - 任务更新/删除
- `GET /api/v1/workspaces/:wid/members` - 成员列表

### 协作功能
- `POST /api/v1/workspaces/:wid/tasks/:id/comments` - 任务评论
- `GET/POST /api/v1/workspaces/:wid/tasks/:id/decisions` - 决策记录

---

## 四、多租户隔离机制

### 应用层
```typescript
// 每次请求解析JWT，提取workspace_id
const member = await prisma.member.findUnique({
  where: { userId_workspaceId: { userId: auth.sub, workspaceId: wid } },
});
```

### 数据库层（RLS）
```sql
-- 请求级注入workspace上下文
SET LOCAL app.workspace_id = '<uuid>';

-- 所有查询强制过滤
USING (workspace_id = current_setting('app.workspace_id')::uuid)
```

### 验收标准（EARS格式）
- **AC-03**: 跨租户请求必须返回404/403，不泄漏数据
- **AC-04**: 查询遗漏workspace_id时，RLS必须拦截

---

## 五、快速开始（用户本机执行）

### 步骤1：安装依赖
```powershell
cd F:\Nexus\corps\web
pnpm install --frozen-lockfile
```

### 步骤2：启动数据库
```powershell
docker-compose up -d
# 等待PG就绪（约10秒）
docker exec -it corps-db pg_isready
```

### 步骤3：配置环境变量
```powershell
copy .env.local.example .env.local
notepad .env.local
# 修改POSTGRES_PASSWORD和NEXTAUTH_SECRET
```

### 步骤4：运行迁移
```powershell
npx prisma migrate dev --name init
```

### 步骤5：启动开发服务器
```powershell
npm run dev
```

访问 http://localhost:3000/auth/signup 完成注册。

---

## 六、已知限制

### 沙箱环境限制（历史记录，2026-08-22 状态）
- ❌ npm install 被安全策略拦截（trash操作超时）
- ❌ prisma migrate dev 无法执行（需真实PG连接）
- ✅ 所有源码文件已完整落盘

### 未实现功能（后续迭代）
> 注：以下为 2026-08-22 落地时的状态；Better Auth / Stripe / 前端 UI 对齐已于 2026-08-22 后续完成（见 README.md 待办清单）。

1. 端到端测试（本机 `npm run dev` 后手测，见 web/README.md 验证步骤）
2. CloudBase 部署配置
3. AC-04/05/06 测试为占位，需真实 PG 连接补齐
4. Token 存储迁移至 httpOnly cookie（安全审计已记录）

---

## 七、下一步建议

1. **本机启动验证**：按上方步骤1-5执行，验证核心流程
2. **UI对齐**：参考 `design/prototype/index.html` 迭代 React 组件
3. **测试**：编写 API 测试覆盖 AC-01 ~ AC-06
4. **部署**：配置 CloudBase 一键部署

---

**落地完成时间**：2026-08-22 18:46
**下一阶段**：用户本机启动验证 → UI对齐 → 端到端测试
