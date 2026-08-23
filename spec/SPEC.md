# Spec - 团队（corps）v0.1.0

> 生成日期：2026-08-19
> 基于：PRD v1（许清楚） + 架构文档 v1（高见远） + UIUX 文档 v1（颜好看）
> 状态：已确认（用户 2026-08-19 拍板 4 项决策）
> 决策日志：
> [15:01] Phase 0 - 用户确认需求：对外多租户 SaaS 协作工具，对标飞书，Web 优先，综合一体化终局
> [15:30] Phase 1 - 三文档回传完成，一致性检查通过
> [16:00] 用户拍板：认可轻量定位 / 按此砍 IM+协同编辑 / 中国大陆为主(CloudBase) / 免费限10人付费$8-12

---

## 1. 产品定义

- **一句话描述**：面向 5–30 人中小团队的轻量协作 SaaS——以"工作区任务看板"为锚点，让讨论结论自动落位成任务与决策记录，15 分钟上手，不为用不上的功能付费。
- **目标用户**：项目推动者（创始人 / 产品·运营·设计负责人 / 外包咨询 PM），团队规模 5–30 人。
- **核心问题**：中小团队在飞书/Notion/ClickUp 等"臃肿 all-in-one"与 Trello/Teambition 等"功能残缺"之间无中间选项；且决策散落在聊天里、结论不落位（约 1/4 决策因上下文缺口超期，仅 1/3 时间手动搬结论）。

## 2. MVP 范围（锁定——不在此列表的功能一律不做）

| 优先级 | 功能 | 验收标准摘要 | RICE |
|--------|------|-------------|------|
| P0 | 注册登录 + 创建工作区（租户初始化） | 邮箱+密码注册，创建即生成独立 workspace + owner 角色 | 15.0 |
| P0 | 任务详情（负责人/截止日/优先级/状态） | 字段完整 CRUD，状态机受控 | 13.3 |
| P0 | 成员邀请 + 三角色 RBAC（Owner/Admin/Member） | 邀请链接/邮箱，角色权限服务端强制 | 10.8 |
| P0 | 空状态引导 + Onboarding | 空工作区 15 分钟内完成"创建首个任务并指派" | 10.7 |
| P0 | 任务看板（看板/列表双视图 + 拖拽 + CRUD） | 列=状态，拖拽改状态乐观更新 | 10.0 |
| P0 | 数据隔离（RLS + workspace_id） | 跨租户请求 404/403，无数据泄漏 | — |
| P1 | 决策记录（挂任务的轻文档 + 双向回链，Markdown 单编辑 + 版本留痕） | 任务可挂 0–N 决策，列表回显 | 6.7 |
| P1 | 任务评论 + @提及 | 评论绑任务上下文，@提及通知 | 6.4 |
| P1 | 席位计费雏形（Stripe Checkout + Portal + webhook） | 成员数变更同步 subscription quantity | 6.0 |
| P1 | 全局搜索（任务 + 决策记录，Cmd+K） | 命令栏检索真实语义 | 3.2 |
| P2 | 数据埋点（注册/激活/留存/转化漏斗） | 核心事件全埋 | 5.0 |

## 3. 明确不做（Out-of-Scope — 锁定）

| 不做的功能 | 原因 | 何时考虑 |
|------------|------|----------|
| IM / 实时聊天流（WebSocket） | 实时通信子系统吞预算，且"抢结论"比"抢沟通"更有差异化 | v2，作为任务上下文的轻沟通延伸 |
| 富文本实时协同编辑（CRDT/OT） | Yjs/Automerge+presence 数月投入，非切片核心 | v2，决策记录升级为协同 |
| 视频 / 语音 | 非核心，重度投入 | 远期 |
| 日历 | Google/Outlook 生态壁垒 + RRULE 深坑 | v2 |
| AI 智能助手 | 无数据、无算力预算、非核心 | 有数据积累后 |
| 自定义域名多租户 | DNS/SSL 自动化复杂度高 | scale-out |
| 企业微信/钉钉/SSO/SAML | 企业版路径 | 企业版 |
| 移动端/桌面端原生 App | Web 仅，否则范围爆炸 | v2 晚期（响应式 Web 先行） |
| 审计日志 / 数据驻留合规 | scale-out 阶段 | 企业版 |

## 4. 技术架构（锁定 — 含版本锚定）

| 层 | 技术 | 实际版本 | 锁定原因 |
|----|------|----------|----------|
| 前端 | Next.js (App Router) + React | next@16.2.6 / react@19.2 | Web 优先 + 多租户 SaaS 部署成熟 + 单语言贯通前后端 |
| 前端 UI | Tailwind CSS + Radix UI | tailwindcss@4 / radix-ui 最新稳定 | 无样式可访问原语 + Token 映射反硬编码 |
| 图标 | Lucide (lucide-react) | 钉确切版本（非 ^/latest） | P0 锁定一套 SVG，禁 emoji/禁混用 |
| 后端 | Next.js Route Handlers（全栈起步） | 同前端 | 最小部署目标、最快跑通 |
| 后端生长 | NestJS (Fastify) | @nestjs/core@11 | 多端/AI 出现时抽独立 API，复用 TS DTO+Prisma |
| ORM | Prisma | @prisma/client@6 (≥6.15.0) | 迁移可逆（契合可回滚）+ 类型共享 |
| 数据库 | PostgreSQL | 18.4 | RLS 行级安全成熟，多租户隔离引擎层强制 |
| 认证 | Better Auth | better-auth 最新稳定 | TS 原生、sessions/MFA/多租户(orgs)插件、Prisma 适配器 |
| 密码 | scrypt（Better Auth 默认） | — | Better Auth 1.3 稳定版未暴露 argon2 钩子；scrypt 强度仍够，argon2id 作为后续升级项见 OPEN-DECISIONS |
| 计费 | Stripe | stripe 最新稳定 | Checkout/Portal/webhook 成熟，中国市场用 Stripe 跨境或替换方案待定 |
| 部署 | 腾讯云 CloudBase + 国内 CDN | — | 目标市场中国大陆，国内直连最优 |
| 认证令牌 | access JWT 15min + refresh 不透明串 7d 轮换 | — | 满足"JWT 15min access + 7d refresh" |

> 多租户隔离：共享 Schema + `workspace_id` + PostgreSQL RLS。RLS 在引擎层强制，即使应用漏写 WHERE 也不跨租户泄漏。

## 5. API 端点清单（锁定——开发时以此为唯一依据，Phase 2 产出 openapi.yaml）

> 路径前缀 `/api/v1/`，统一响应信封 `{code, data, message}`。Phase 2 由架构师补齐完整 openapi.yaml。

| Method | Path | 功能 | 认证 | 说明 |
|--------|------|------|------|------|
| POST | /api/v1/auth/register | 注册 + 创建首个工作区 | 否 | 初始化 owner |
| POST | /api/v1/auth/login | 登录 | 否 | 返回 access+refresh |
| POST | /api/v1/auth/refresh | 刷新令牌 | refresh | 轮换 |
| POST | /api/v1/auth/logout | 登出 | access | 清除 cookie + 删除 session |
| GET | /api/v1/users/me | 当前用户信息 | access | |
| PATCH | /api/v1/users/me | 更新个人资料 | access | |
| GET | /api/v1/workspaces | 我的工作区列表 | access | 多租户切换 |
| POST | /api/v1/workspaces | 创建工作区 | access | |
| GET | /api/v1/workspaces/:wid | 工作区详情 | access+RBAC | |
| PATCH | /api/v1/workspaces/:wid | 更新工作区 | access+Admin | |
| GET | /api/v1/workspaces/:wid/tasks | 任务列表（看板/列表视图） | access+RBAC | RLS 过滤 |
| POST | /api/v1/workspaces/:wid/tasks | 创建任务 | access+RBAC | |
| GET | /api/v1/workspaces/:wid/tasks/:id | 任务详情 | access+RBAC | |
| PATCH | /api/v1/workspaces/:wid/tasks/:id | 更新任务（含拖拽改状态） | access+RBAC | |
| DELETE | /api/v1/workspaces/:wid/tasks/:id | 删除任务 | access+RBAC | |
| GET | /api/v1/workspaces/:wid/tasks/:id/comments | 评论列表 | access+RBAC | |
| POST | /api/v1/workspaces/:wid/tasks/:id/comments | 任务评论 + @提及 | access+RBAC | |
| GET/POST | /api/v1/workspaces/:wid/tasks/:id/decisions | 决策记录（Markdown 单编辑） | access+RBAC | |
| PATCH | /api/v1/workspaces/:wid/tasks/:id/decisions/:did | 编辑决策 | access+RBAC | 乐观锁 |
| GET | /api/v1/workspaces/:wid/tasks/:id/decisions/:did/versions | 决策版本历史 | access+RBAC | |
| GET | /api/v1/workspaces/:wid/decisions | 决策列表（跨任务） | access+RBAC | 分页+搜索 |
| GET | /api/v1/workspaces/:wid/members | 成员列表 | access+RBAC | |
| POST | /api/v1/workspaces/:wid/members/invite | 邀请成员 | access+Admin | |
| PATCH | /api/v1/workspaces/:wid/members/:uid | 修改成员角色 | access+Admin | |
| DELETE | /api/v1/workspaces/:wid/members/:uid | 移除成员 | access+Admin | Member 调返回 403 |
| GET | /api/v1/workspaces/:wid/notifications | 通知列表 | access+RBAC | 支持 unread/count 参数 |
| PATCH | /api/v1/workspaces/:wid/notifications | 标记已读 | access+RBAC | 单条/全部 |
| GET | /api/v1/workspaces/:wid/search | 全局搜索 | access+RBAC | 任务+决策 |
| POST | /api/v1/workspaces/:wid/billing/checkout | 创建 Stripe Checkout Session | access+Owner | 升级 |
| POST | /api/v1/workspaces/:wid/billing/portal | Stripe Customer Portal | access+Owner | |
| GET | /api/v1/workspaces/:wid/billing/status | 计费状态 | access+RBAC | |
| POST | /api/v1/billing/webhook | Stripe webhook（quantity 同步） | stripe 签名 | |

## 6. 数据库表清单（锁定，Phase 2 由架构师产出完整迁移 SQL）

| 表名 | 核心字段 | 索引 | 关联 |
|------|----------|------|------|
| workspaces | id(uuid), name, owner_id, plan, seat_limit | pk | |
| users | id(uuid), email(unique), password_hash(scrypt), name | pk,email | |
| members | user_id, workspace_id, role(owner/admin/member) | (workspace_id) | workspaces,users |
| tasks | id, workspace_id, title, desc, status, priority, assignee_id, due_date, order | (workspace_id,status) | workspaces,members |
| comments | id, task_id, author_id, body, mentions[] | (task_id) | tasks,users |
| decisions | id, task_id, markdown, version, author_id | (task_id) | tasks,users |
| subscriptions | workspace_id, stripe_customer_id, stripe_sub_id, quantity, status | (workspace_id) | workspaces |
| sessions | id, user_id, refresh_hash, expires_at | (user_id) | users |

> 所有业务表含 `workspace_id NOT NULL`，RLS 策略 `USING (workspace_id = current_setting('app.workspace_id')::uuid)`；请求级 `SET LOCAL app.workspace_id = <JWT.wid>`。

## 7. 页面清单（锁定）

| 页面 | 路由 | 核心组件 | 对应 API | 设计 Token 主题 |
|------|------|----------|----------|-----------------|
| 注册/登录 | /auth | 表单（focus-visible/ARIA） | auth/* | 浅色默认 |
| 工作区 Home（登录后首屏） | /w/:wid | 命令栏 Cmd+K + Slim Sidebar + 非对称主区 | workspaces/:wid/* | Calm Precision |
| 任务看板 | /w/:wid/board | 看板列/列表双视图 + 拖拽 | tasks | 同上 |
| 任务详情 | /w/:wid/task/:id | 详情 + 评论 + 决策记录 | tasks/:id, comments, decisions | 同上 |
| 成员管理 | /w/:wid/members | 邀请 + 角色 | members | 同上 |
| 计费 | /w/:wid/billing | 套餐 + Portal 入口 | billing/* | 同上 |

## 8. 设计 Token（锁定）

- **设计语言**：Calm Precision（克制精密）= Notion 留白 + Linear 精度 + Stripe 克制
- **主色**：`--accent #4263EB`（钴蓝 600，纯色，非靛紫/非紫粉渐变）；深色 `--accent #4D74FB`
- **表面**：`--bg #F7F8FA` / `--surface #FFFFFF`；深色 `--bg #0E0F12` / `--surface #16181D`
- **文字**：`--fg #16181D` / `--fg-2 #3A3F4A` / `--muted #6B7280`
- **边框**：`--border #E6E8EC` / `--border-soft #F0F1F4`（发丝级）
- **语义**：`--success #1A9E6B` / `--warn #C9881A` / `--danger #DC3D4A`
- **字体**：Inter（拉丁）+ Noto Sans SC（CJK）；Mono: JetBrains Mono；字重 400/510/590
- **图标库**：Lucide（lucide-react），尺寸 16/20/24/32px，2px stroke，currentColor，禁 emoji
- **主题**：浅色默认，深色首版即给，`[data-theme="dark"]` 切换；`--accent` 支持 `[data-tenant-theme]` 租户覆盖
- **对标品牌**：Stripe Dashboard > Linear > Notion；飞书仅作竞品功能参照不抄其蓝
- 设计师 Phase 2 产出 `DESIGN.md` + `design-tokens.json` + `design-tokens.css`

## 9. 验收标准（锁定——QA 测试时以此为唯一依据，EARS 格式）

| 编号 | 功能 | EARS 格式验收标准 | 优先级 |
|------|------|-------------------|--------|
| AC-01 | 注册 | While 用户填写合法注册信息，系统**必须**创建账户 + 工作区 + owner 角色并返回 JWT | P0 |
| AC-02 | 注册 | If 邮箱已存在，系统**必须**返回 409 + 错误信息 | P0 |
| AC-03 | 多租户隔离 | Given A 工作区成员已登录，When 直接构造请求访问 B 工作区任务 ID，Then 系统**必须**返回 404/403 且不泄漏 B 租户数据 | P0 |
| AC-04 | 多租户隔离 | Given 某查询遗漏 workspace_id 过滤，When 该查询执行，Then PostgreSQL RLS **必须**拦截，跨租户数据不返回 | P0 |
| AC-05 | RBAC | Given 用户角色为 Member，When 调用移除成员或修改计费端点，Then 系统**必须**返回 403（前端隐藏按钮不算通过） | P0 |
| AC-06 | 看板 | While 用户拖拽任务卡到另一列，系统**必须**乐观更新状态并在后台持久化 | P0 |
| AC-07 | 激活 | Given 新用户完成注册，When 进入空工作区，Then 引导流程**必须**可在 15 分钟内完成"创建首个任务并指派" | P0 |
| AC-08 | 计费 | Given 工作区 5 名活跃成员，When 第 6 人接受邀请，Then Stripe subscription quantity **必须**同步为 6 | P1 |
| AC-09 | 计费 | Given 扣款失败，When 收到 invoice.payment_failed，Then 系统**必须**触发催缴且不立即中断服务 | P1 |
| AC-10 | 决策记录 | While 用户在任务下新增决策记录，系统**必须**保存 Markdown 版本留痕并双向回链任务 | P1 |

## 10. 边界与约束

- 不支持 IE；支持 Chrome/Edge ≥115、Firefox ≥115、Safari ≥16
- 响应式：桌面优先；断点 sm640/md768/lg1024/xl1280；MVP 以 lg+ 为主、md 可用、移动 Web 不崩不专属优化
- 性能：首屏 LCP < 2.5s；简单 API p95 < 300ms；看板加载 < 1s（≤200 任务/工作区）
- 多租户红线：workspace_id 仅从 JWT 解析；应用连接角色无 BYPASSRLS；RLS 上线即存在且有隔离测试
- 认证：scrypt（Better Auth 默认）、access 15min/refresh 7d 轮换、HTTPS only、secure+httpOnly cookie、CSRF 防护
- 可回滚：每次部署可一键回滚；DB migration 必须可逆（down migration）
- 图标：锁定 Lucide(SVG)，禁 emoji、禁混用；API 文档禁 emoji
- 计费：中国市场 Stripe 跨境可行性待 Phase 2 复核，必要时替换为国内支付（微信/支付宝）

## 11. 内嵌已知坑（从调研与专家经验拉取）

| 坑 | 技术栈指纹 | 根因 | 修法 |
|----|------------|------|------|
| 图标导出名随版本重命名（AlertCircle→CircleAlert） | lucide-react | 凭记忆猜名导致构建失败 | 钉确切版本，具名 import，缺失即 lint 拦截 |
| RLS 连接池串租户 | PostgreSQL + PgBouncer | 会话级池未重置上下文 | 事务级池化 + 每次 `SET LOCAL app.workspace_id` |
| 多租户数据泄漏 | Next.js + Prisma | 应用层漏写 WHERE | RLS 引擎层强制 + 集成测试覆盖 AC-03/04 |
| Prisma Serverless 冷启动重 | Prisma 6 | 查询引擎开销 | 评估 Drizzle 备选；MVP 影响可控 |

## 12. 端到端验证步骤（Spec 锁定的最后一项）

```bash
# 1. 构建
npm run build

# 2. 启动（本地需 PostgreSQL 18.4 + 环境变量）
npm run dev  # 等待 Ready on http://localhost:3000

# 3. 核心成功流：注册 + 建工作区 + 建任务
curl -X POST http://localhost:3000/api/v1/auth/register -H "Content-Type: application/json" \
  -d '{"email":"lead@acme.test","password":"<scrypt-hash-ready>","workspaceName":"Acme"}'
# 断言：返回 201 + access/refresh + 自动建 workspace(owner)

# 4. 关键错误流：跨租户越权
curl -X GET http://localhost:3000/api/v1/workspaces/:otherWid/tasks \
  -H "Authorization: Bearer <A的access>"
# 断言：返回 404/403，响应体不含 B 租户数据

# 5. 计费同步：邀请第 N+1 成员
curl -X POST http://localhost:3000/api/v1/workspaces/:wid/members/invite ...
# 断言：Stripe subscription quantity 同步 +1
```

## 13. 变更记录

| 日期 | 变更内容 | 原因 | 影响范围 |
|------|----------|------|----------|
| 2026-08-19 | 初版 Spec 锁定 | Phase 1 三文档确认 + 用户拍板 4 决策 | 全局 |
| 2026-08-22 | 认证对齐 Better Auth（ADR-002）：身份/会话由 Better Auth 托管，wid 作用域 JWT（15min）驱动 RLS 保留；密码哈希 scrypt 偏差记入 OPEN-DECISIONS | Spec §4 锁定认证 = Better Auth，原脚手架偏离 | auth 三端点 + lib/auth.ts |
| 2026-08-22 | Stripe 计费接入：checkout/portal/status 三端点置于 `/workspaces/:wid/billing/`，webhook 独立于 `/billing/webhook`；席位 quantity 同步 | 用户需求「接入 Better Auth / Stripe 计费」 | billing 路由 + 计费页 |
| 2026-08-22 | 前端 UI 对齐原型（Task #13）：新建任务详情页/计费页/设置页，重写概览页/外壳/命令面板/登录注册页，零依赖 Markdown 渲染器，新建任务弹窗接入看板与概览 | 用户需求「补齐前端 UI 与原型对齐」 | web/app + web/components |
| 2026-08-22 | 修复阻断缺陷：登录未存 access token、计费路由缺 [wid] 段、members/layout 自引用循环、schema `@db.JsonArray` 非法注解、`React.use` 未导入、6 处硬编码 text-white、缺失 --shell-*/--accent-ring/--overlay token | 端到端可运行性审查 | 前后端多文件 |
| 2026-08-22 | 新增依赖 jsonwebtoken@9.0.2（lib/jwt.ts 引用但 package.json 缺失，运行时阻断） | tsc 全量核查发现 | package.json |
| 2026-08-22 | 品牌与路径统一为 corps：`collab-saas-mvp` → `corps`（文档路径引用），`Corps` → `corps`（全部 UI/文档，含小写统一） | 用户指令「全部统一成 corps」 | 全部 .md/.tsx/.ts/.html |
| 2026-08-24 | 文档对齐实际实现：密码哈希 argon2id → scrypt（与 Better Auth 默认一致）；移动端 App "何时考虑" P1 → v2 晚期（与 ROADMAP 一致）；定价 Pro 层 31+人 → 11–30人高级功能档（与产品定位 5–30人一致）；DESIGN.md 日历标注为 v2 占位（与 SPEC §3 一致） | Task #72 文档一致性修复 | SPEC.md + pricing-strategy.md + DESIGN.md + 审计/安全/竞品文档 |

---

## 附：OPEN-DECISIONS（悬而未决登记册）

| Date | Source | Open Item | Related Constraints | Current Leaning | Blocked By | Resolves When | Status |
|------|--------|-----------|---------------------|-----------------|------------|---------------|--------|
| 2026-08-19 | Phase 1 | 国内支付选型（Stripe 跨境 vs 微信/支付宝） | 目标市场中国大陆 | 优先 Stripe 跨境验证，不行则微信/支付宝 | 待 Phase 2 复核合规 | Phase 2 结论 | OPEN |
| 2026-08-19 | Phase 1 | 付费档具体定价（¥50-80/人/月 锚定 $8-12） | 免费限 10 人已定 | ¥59/人/月 起步档 | 待用户最终确认价目表 | 用户确认 | OPEN |
| 2026-08-22 | Phase 3 (ADR-002) | 密码哈希 scrypt vs Spec 锁定 argon2id | Better Auth 1.3 稳定版未暴露 argon2 哈希钩子 | MVP 用 scrypt（强度仍够），后续评估自定义 hasher 插件或回退原生 argon2 | Better Auth 上游能力 | 用户拍板或上游支持 | RESOLVED（2026-08-24 Spec 已对齐 scrypt） |
