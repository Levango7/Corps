# corps Spec ↔ 实现 全局核对报告

> 日期：2026-08-23 ｜ 核对范围：SPEC.md × 设计原型 × 代码实现 三方一致性

---

## 1. SPEC.md 需求 ↔ 代码实现映射

### 1.1 P0 功能核对

| SPEC 需求 | 实现文件 | 状态 | 备注 |
|-----------|----------|------|------|
| 注册登录 + 创建工作区 | `app/api/v1/auth/register/route.ts` + `app/auth/signup/page.tsx` | ✅ | Better Auth + argon2id |
| 任务详情（字段完整 CRUD） | `app/api/v1/workspaces/[wid]/tasks/[id]/route.ts` + `app/w/[wid]/task/[id]/page.tsx` | ✅ | 字段完整 |
| 成员邀请 + 三角色 RBAC | `app/api/v1/workspaces/[wid]/members/invite/route.ts` + `app/w/[wid]/members/page.tsx` | ✅ | 服务端强制 |
| 空状态引导 + Onboarding | `components/Onboarding.tsx` | ✅ | 本次新增 |
| 任务看板（双视图 + 拖拽） | `app/w/[wid]/board/page.tsx` | ✅ | 看板视图+拖拽 |
| 数据隔离（RLS） | `db/schema.sql` + `lib/auth.ts` runWithWorkspace | ✅ | 引擎层强制 |

### 1.2 P1 功能核对

| SPEC 需求 | 实现文件 | 状态 |
|-----------|----------|------|
| 决策记录（Markdown + 版本留痕） | `app/api/v1/workspaces/[wid]/tasks/[id]/decisions/route.ts` + `prisma/schema.prisma` DecisionVersion | ✅ |
| 任务评论 + @提及 | `app/api/v1/workspaces/[wid]/tasks/[id]/comments/route.ts` | ✅ |
| 席位计费（Stripe） | `app/api/v1/workspaces/[wid]/billing/*/route.ts` + `app/api/v1/billing/webhook/route.ts` | ✅ |
| 全局搜索（Cmd+K） | `components/CommandPalette.tsx` + `app/w/[wid]/layout.tsx` | ✅ |

### 1.3 验收标准 AC-01 ~ AC-10 核对

| AC | 标准 | 测试文件 | 状态 |
|----|------|----------|------|
| AC-01 | 注册创建账户+工作区+owner+JWT | `tests/integration/auth.test.ts` | ✅ 已写 |
| AC-02 | 邮箱重复返回 409 | `tests/integration/auth.test.ts` | ✅ 已写 |
| AC-03 | 跨租户隔离 404/403 | `tests/integration/workspace.test.ts` | ✅ 已写 |
| AC-04 | RLS 拦截漏写 WHERE | `tests/integration/workspace.test.ts` | ⚠️ 占位 |
| AC-05 | RBAC Member 403 | `tests/integration/workspace.test.ts` | ⚠️ 占位 |
| AC-06 | 拖拽乐观更新持久化 | `tests/integration/workspace.test.ts` | ⚠️ 占位 |
| AC-07 | 15分钟内 Onboarding | `components/Onboarding.tsx` | ✅ 已实现 |
| AC-08 | Stripe quantity 同步 | webhook route | ✅ 已实现 |
| AC-09 | 扣款失败催缴 | webhook route | ✅ 已实现 |
| AC-10 | 决策版本留痕+回链 | decisions route + DecisionVersion 模型 | ✅ 已实现 |

---

## 2. 设计 Token ↔ globals.css ↔ 组件引用 三层一致性

### 2.1 Token 源对齐

| Token 类别 | design-tokens.css | globals.css | 状态 |
|------------|-------------------|-------------|------|
| 圆角 | sm:6 md:8 lg:12 xl:16 | sm:6 md:8 lg:12 xl:16 | ✅ 已对齐 |
| 字号 | xs:12 sm:13 base:14 md:16 lg:18 xl:20 2xl:24 3xl:30 4xl:36 | 同左 | ✅ 已对齐 |
| Shell 三层 | shell-blue + color-mix 派生 | 同左 | ✅ 已对齐 |
| 语义色 | success/warn/danger + soft 变体 | 同左 | ✅ 已对齐 |
| 深色主题 | [data-theme="dark"] 完整覆盖 | 同左 | ✅ 已对齐 |
| 补充 Token | font-display/leading/tracking/elev-hover/hover-soft/eyebrow/icon-* | 已补齐 | ✅ |
| reduced-motion | 媒体查询 | 已添加 | ✅ |

### 2.2 组件引用规范

| 规范 | 检查结果 |
|------|----------|
| 颜色引用 var(--token) | ✅ 全部组件遵守 |
| 裸 hex | ✅ 未发现（board/page.tsx 原 `#DC3D4A` 已改为 var(--danger)） |
| 图标仅 lucide-react | ✅ 全部使用具名 import |
| emoji 作功能图标 | ✅ 未发现 |
| 每屏强调色 ≤2 处 | ✅ 主 CTA + 选中导航项 |

---

## 3. API openapi.yaml ↔ Route Handler 一致性

| openapi 端点 | Route Handler | 状态 |
|--------------|---------------|------|
| POST /auth/register | ✅ | 一致 |
| POST /auth/login | ✅ | 一致 |
| POST /auth/refresh | ✅ | 一致 |
| GET/POST /workspaces | ✅ | 一致 |
| GET/POST /workspaces/:wid/tasks | ✅ | 一致 |
| PATCH/DELETE /workspaces/:wid/tasks/:id | ✅ | 一致 |
| GET /workspaces/:wid/members | ✅ | 一致 |
| POST /workspaces/:wid/members/invite | ✅ | 一致 |
| DELETE /workspaces/:wid/members/:uid | ✅ | 一致 |
| POST /workspaces/:wid/tasks/:id/comments | ✅ | 一致 |
| GET/POST /workspaces/:wid/tasks/:id/decisions | ✅ | 一致 |
| PATCH /workspaces/:wid/tasks/:id/decisions/:did | ✅ | 一致 |
| POST /billing/checkout | ✅ | 一致 |
| POST /billing/webhook | ✅ | 一致 |

---

## 4. 数据库 schema.sql ↔ prisma/schema.prisma 一致性

| 表 | schema.sql | prisma | 状态 |
|----|-----------|--------|------|
| users | ✅ | ✅ | 一致 |
| workspaces | ✅ | ✅ | 一致 |
| members | 复合主键 (workspace_id, user_id) | @@id([userId, workspaceId]) | ✅ 已对齐 |
| tasks | status: todo/in_progress/review/done | 同左 | ✅ 已对齐 |
| tasks.sort_order | double precision | Float @map("sort_order") | ✅ 已对齐 |
| comments | workspace_id 反范式化 | 已补齐 | ✅ 已对齐 |
| decisions | workspace_id 反范式化 | 已补齐 | ✅ 已对齐 |
| decision_versions | 独立表 | DecisionVersion 模型 | ✅ 已对齐 |
| subscriptions | ✅ | ✅ | 一致 |
| sessions | ✅ | ✅ | 一致 |

---

## 5. 不一致项清单及优先级

| 项 | 描述 | 优先级 | 整改状态 |
|----|------|--------|----------|
| 1 | AC-04/05/06 测试为占位 | P1 | 需真实 PG 连接补齐 |
| 2 | Token 存储用 localStorage | P0 | 安全审计已记录，待迁移 httpOnly cookie |
| 3 | ADR-003 国内支付 OPEN 项 | P1 | 待用户确认定价后关闭 |

---

## 6. 本次工程化补齐产物清单

### 6.1 文档产物（10 份）

| 文件 | 用途 |
|------|------|
| `docs/market/competitive-analysis.md` | 竞品市场分析 |
| `docs/market/product-roadmap.md` | 产品路线图 |
| `docs/market/pricing-strategy.md` | 定价策略 |
| `docs/standards/CODING-STANDARDS.md` | 编码规范 |
| `docs/standards/API-DESIGN-GUIDE.md` | API 设计规范 |
| `docs/standards/DB-MIGRATION-GUIDE.md` | 数据库迁移规范 |
| `docs/security/SECURITY-AUDIT.md` | 安全审计报告 |
| `docs/audit/SPEC-vs-IMPL-AUDIT.md` | 本核对报告 |
| `web/eslint.config.mjs` | ESLint 配置 |
| `web/.prettierrc` | Prettier 配置 |

### 6.2 代码产物（8 份）

| 文件 | 用途 |
|------|------|
| `web/vitest.config.ts` | 测试框架配置 |
| `web/tests/setup.ts` | 测试 setup |
| `web/tests/integration/auth.test.ts` | AC-01/02 测试 |
| `web/tests/integration/workspace.test.ts` | AC-03~06 测试 |
| `web/prisma/seed.ts` | Seed 数据脚本 |
| `web/components/Onboarding.tsx` | Onboarding 引导组件 |
| `.github/workflows/ci.yml` | CI/CD 流水线 |
| `web/package.json` | 更新（test 脚本 + vitest 依赖） |

### 6.3 修复项（2 份）

| 文件 | 修复内容 |
|------|----------|
| `web/app/globals.css` | 6 处对齐 design-tokens.css |
| `web/prisma/schema.prisma` | 6 处对齐 db/schema.sql |

---

## 7. 综合评分

| 维度 | 评分 | 说明 |
|------|------|------|
| SPEC ↔ 实现一致性 | 9/10 | P0/P1 全部实现，测试占位待补 |
| 设计 Token 三层一致 | 10/10 | globals.css 已全面对齐 |
| API 契约一致 | 10/10 | openapi.yaml ↔ Route Handler 全覆盖 |
| 数据库一致 | 10/10 | Prisma ↔ SQL 已对齐 |
| 工程化基础 | 8/10 | 规范+测试+CI 已就位，待实际运行验证 |
| 安全 | 8/10 | RLS+RBAC 强，Token 存储待迁移 |
| **综合** | **9.2/10** | 为后续开发打下扎实基础 |