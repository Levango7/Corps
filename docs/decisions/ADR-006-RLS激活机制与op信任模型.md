# ADR-006: RLS 激活机制与 op 信任模型

> 状态：已采纳  
> 日期：2026-08-24  
> 关联：db/rls-activate.sql, web/lib/auth.ts, docs/runbook-deploy.md

## 背景

Phase 1 审计要求启用 PostgreSQL Row Level Security（RLS）作为多租户隔离的数据库层防线。应用层 `SET LOCAL app.workspace_id` 已在代码中就绪，但 RLS 策略从未在数据库中激活。

核心挑战：
1. `corps_app` 角色需要以 owner 身份执行 `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`，但运行时以最小权限角色连接
2. Better Auth 内部表（users/sessions/accounts/verifications）不带 `workspace_id`，RLS 会阻断其访问
3. 服务端操作（webhook、provision、invite）需要绕过 RLS 的正常 `app.user_id` 校验

## 决策

### D1 双连接架构

- `DATABASE_OWNER_URL`：以 `postgres`（owner）身份执行 migrate deploy + rls-activate.sql
- `DATABASE_URL`：以 `corps_app`（最小权限）运行应用，受 RLS 约束
- entrypoint.sh 在 `RLS_ACTIVATE=true` 时先执行 activate 脚本，再启动 Next.js

### D2 op 逃生口枚举

策略中通过 `current_setting('app.auth_op', true)` 鉴别服务端操作类型：

| op 值 | 用途 | 策略影响 |
|--------|------|----------|
| `provision` | 注册时自动创建 workspace | workspaces_select 放行 |
| `webhook` | 支付通道回调跨租户写入（Stripe/支付宝/微信） | workspaces_select 放行 |
| `invite` | 邀请/接受席位 | workspaces_select + members 放行 |
| `login` | 正常登录 | members SELECT 分支放行 |
| `seat` | 邀请/接受的席位行锁保护段 | workspaces_select/update + members 放行 |
| `cron` | 定时作业跨工作区只读扫描（截止日提醒） | tasks SELECT + workspaces_select 放行（2026-08-28 新增；只读，无写路径） |

`op` 由 `lib/auth.ts` 的 `runWithAuthOp()` 设定，值域硬编码白名单，不可由客户端控制。

### D3 身份域豁免

以下表有意不启用 RLS（Better Auth 托管、无租户键）：
- users, sessions, accounts, verifications

### D4 策略分裂

| 表 | SELECT 策略 | WRITE 策略 |
|----|-------------|------------|
| members | login 分支按 user_id；provision/invite 分支按 workspace_id | 仅 workspace_id（owner/admin 由应用层校验） |
| workspaces | 正常按 workspace_id；provision/webhook/invite 逃生口 | EXISTS 子查询放行 owner/admin |
| notifications | 仅 workspace_id（user 过滤交回 WHERE） | 仅 workspace_id |
| 其余业务表 | workspace_id | workspace_id |

### D5 FORCE ROW LEVEL SECURITY

全部 14 张业务表执行 `FORCE ROW LEVEL SECURITY`（原 10 张 + v2 扩面的
labels/milestones/messages/task_labels，2026-08-28 审计 P2-3 修复），
确保表属主（postgres）同样受策略约束，杜绝 `SET ROLE` 绕过。
仍未覆盖：message_reads/message_attachments/chat_presences（暂无 API 路由）、
calendar_connections/task_calendar_events（user 作用域，无 workspace 键）。

## 后果

- ✅ 数据库层强制隔离，即使应用层代码有漏洞也无法跨租户读写
- ✅ Better Auth 内部表不受影响（豁免）
- ✅ 服务端操作通过 op 枚举安全绕过
- ⚠️ 需维护 rls-activate.sql 与 schema.prisma 的表清单同步
- ⚠️ 新增业务表需手动加入 activate 脚本的表列表
