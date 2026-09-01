# Vercel 部署指南

本文档介绍如何将 corps 部署到 Vercel。面向国内用户，默认部署到香港区域（`hng1`）。

> 仓库根目录的 `vercel.json` 已指定 `web/` 为项目根目录、Next.js 框架与香港区域，无需在 Vercel Dashboard 重复配置 Root Directory。

---

## 前置条件

- **Vercel 账户**：注册 [vercel.com](https://vercel.com)，免费额度足够个人项目起步。
- **GitHub 仓库**：代码已推送至 `https://github.com/Levango7/Corps`。
- **PostgreSQL 数据库**：推荐 [Neon](https://neon.tech)（Serverless Postgres，免费档足够）或 [Vercel Postgres](https://vercel.com/docs/storage/vercel-postgres)。
- **Node.js 20+ 与 pnpm**：本地需可运行 `pnpm` 以便执行 Prisma 迁移。
- **域名（可选）**：如需自定义域名，提前准备好并完成 DNS 解析。

---

## 步骤 1：在 Vercel 导入 GitHub 仓库

1. 登录 [Vercel Dashboard](https://vercel.com/dashboard)。
2. 点击 **Add New → Project**。
3. 在 **Import Git Repository** 列表中找到 `Levango7/Corps`。
   - 若未授权，点击 **Adjust GitHub App Permissions**，授权对应仓库访问权限。
4. 点击 **Import**，进入项目配置页。
5. **Framework Preset** 应自动识别为 **Next.js**；若未识别，手动选择 `Next.js`。
6. **Root Directory** 保持默认（仓库根），`vercel.json` 中的 `buildCommand` 已通过 `cd web` 切换到 `web/` 目录。
7. **Build Command** 与 **Output Directory** 由 `vercel.json` 覆盖，无需手动填写。
8. 暂不点击 **Deploy**，先完成环境变量配置（步骤 2）。

---

## 步骤 2：配置环境变量

在 Vercel 项目的 **Settings → Environment Variables** 中逐条添加。建议同时配置 **Production**、**Preview**、**Development** 三个环境（或至少 Production）。

### 必填项

| 变量名 | 说明 | 示例值 |
|--------|------|--------|
| `DATABASE_URL` | PostgreSQL 连接字符串（含 schema 参数） | `postgresql://user:pass@host:5432/corps?schema=public` |
| `BETTER_AUTH_SECRET` | 认证密钥，32 字节十六进制 | `openssl rand -hex 32` 生成 |
| `NEXT_PUBLIC_APP_URL` | 应用正式域名（生产环境必填） | `https://corps.vercel.app` |
| `CORPS_APP_PASSWORD` | RLS 运行时角色密码（与 `rls-activate.sql` 一致） | `openssl rand -hex 16` 生成 |
| `RLS_ACTIVATE` | RLS 加固开关 | `true` |

### 计费相关（可选，未配置则计费页隐藏升级入口）

| 变量名 | 说明 |
|--------|------|
| `STRIPE_SECRET_KEY` | Stripe API 密钥 |
| `STRIPE_WEBHOOK_SECRET` | Stripe Webhook 签名密钥 |
| `STRIPE_PRICE_ID` | 月付价格 ID |
| `STRIPE_PRICE_ID_YEARLY` | 年付价格 ID（可选） |
| `PAYMENT_PROVIDER` | 支付通道，默认 `stripe` |

### 国内支付（Phase 2，可选）

| 变量名 | 说明 |
|--------|------|
| `WECHAT_APP_ID` / `WECHAT_MCH_ID` / `WECHAT_API_KEY` / `WECHAT_CERT_SERIAL_NO` | 微信支付 Native 直连凭据 |
| `ALIPAY_APP_ID` / `ALIPAY_PRIVATE_KEY` / `ALIPAY_PUBLIC_KEY` | 支付宝电脑网站支付凭据 |

### 日历集成（可选）

| 变量名 | 说明 |
|--------|------|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | Google Calendar OAuth2 |
| `OUTLOOK_CLIENT_ID` / `OUTLOOK_CLIENT_SECRET` / `OUTLOOK_REDIRECT_URI` | Outlook Calendar OAuth2 |
| `CALENDAR_CRYPTO_KEY` | 日历 OAuth token 加密主密钥（AES-256-GCM，32 字节） |
| `CALENDAR_STATE_SECRET` | 日历 OAuth state 签名密钥（HMAC-SHA256） |

### 其他可选

| 变量名 | 说明 |
|--------|------|
| `REDIS_URL` | Redis 连接（多实例限流共享计数，单实例可不配） |
| `RESEND_API_KEY` / `EMAIL_FROM` | 邮件服务（Resend） |
| `CRON_SECRET` / `CRON_TZ` | 定时作业鉴权与时区 |

> 完整变量清单见仓库根目录 `.env.example`。

---

## 步骤 3：配置数据库

推荐使用 **Neon**（Serverless Postgres，免费档支持分支与即时恢复）：

1. 注册 [neon.tech](https://neon.tech) 并创建项目。
2. 获取 **Connection String**，形如：
   ```
   postgresql://neondb_owner:password@ep-xxx-pooler.region.aws.neon.tech/corps?schema=public&sslmode=require
   ```
3. 将该字符串填入 Vercel 环境变量 `DATABASE_URL`。
4. （可选）为 Preview 环境创建独立数据库分支，隔离测试数据。

> 也可使用 Vercel Postgres、Supabase、Tembo 等支持 PostgreSQL 18 的托管服务。务必确认连接串带 `?schema=public` 参数。

---

## 步骤 4：运行 Prisma 迁移

首次部署前需将数据库 schema 初始化到目标数据库。

### 方式 A：本地执行（推荐，可控性强）

```bash
# 1. 克隆仓库并安装依赖
git clone https://github.com/Levango7/Corps.git
cd Corps/web
pnpm install --frozen-lockfile

# 2. 设置目标数据库连接串（临时，仅用于本次迁移）
#    Windows PowerShell:
$env:DATABASE_URL = "postgresql://user:pass@host:5432/corps?schema=public"
#    macOS / Linux:
export DATABASE_URL="postgresql://user:pass@host:5432/corps?schema=public"

# 3. 生成 Prisma Client
npx prisma generate

# 4. 部署迁移（生产环境用 deploy，不会交互式提问）
npx prisma migrate deploy

# 5. （可选）激活 RLS
#    需设置 CORPS_APP_PASSWORD 并执行 db/rls-activate.sql
```

### 方式 B：Vercel Build 时自动执行

在 Vercel 项目 **Settings → Build & Development Settings** 中，将 Build Command 修改为：

```
cd web && npx prisma generate && npx prisma migrate deploy && pnpm build
```

> 注意：此方式要求 `prisma/migrations` 目录已提交至仓库，且 `DATABASE_URL` 在构建时可用。生产环境推荐方式 A，避免构建期数据库依赖。

---

## 步骤 5：部署并验证

1. 回到 Vercel 项目配置页，点击 **Deploy**。
2. 等待首次构建完成（通常 2-4 分钟）。Vercel 会自动分配 `*.vercel.app` 域名。
3. 将分配的域名填回环境变量 `NEXT_PUBLIC_APP_URL`（如 `https://corps.vercel.app`），触发一次 Redeploy。
4. 验证清单：
   - [ ] 访问 `https://<your-app>.vercel.app` 能正常加载首页。
   - [ ] 访问 `/auth/signup` 能完成注册并登录。
   - [ ] 创建工作区、任务看板、发送消息等核心流程正常。
   - [ ] 检查 Vercel **Functions** 日志无 500 错误。
   - [ ] （如启用 RLS）确认数据库连接使用 `corps_app` 角色而非超管。
5. （可选）在 **Settings → Domains** 绑定自定义域名，按提示完成 CNAME 解析。

---

## 常见问题排查

### 构建失败：`PrismaClient 未生成`

**原因**：构建前未执行 `prisma generate`。

**解决**：将 Build Command 改为 `cd web && npx prisma generate && pnpm build`，或在 `web/package.json` 的 `postinstall` 脚本中加入 `prisma generate`。

### 构建失败：`Environment Variable "DATABASE_URL" not found`

**原因**：环境变量未配置或未勾选对应环境。

**解决**：在 Vercel **Settings → Environment Variables** 中确认 `DATABASE_URL` 已添加，且勾选了 **Production**（部署主环境）。

### 运行时 500：`relation "Workspace" does not exist`

**原因**：数据库迁移未执行，表不存在。

**解决**：按步骤 4 执行 `npx prisma migrate deploy`，确认 `prisma/migrations` 目录已提交。

### 运行时 401：`Unauthorized` / 认证失败

**原因**：`BETTER_AUTH_SECRET` 在不同环境间不一致，或 `NEXT_PUBLIC_APP_URL` 与实际域名不匹配。

**解决**：确认 `BETTER_AUTH_SECRET` 在 Production 环境为固定值（不要每次部署都变）；`NEXT_PUBLIC_APP_URL` 与 Vercel 分配的域名完全一致（含 `https://` 协议头）。

### Stripe Webhook 验签失败

**原因**：`STRIPE_WEBHOOK_SECRET` 与 Stripe Dashboard 中 Webhook endpoint 的 Signing Secret 不一致，或 endpoint URL 未指向 `{NEXT_PUBLIC_APP_URL}/api/v1/billing/webhook/stripe`。

**解决**：在 Stripe Dashboard → Developers → Webhooks 中核对 endpoint URL 与 Signing Secret，更新 Vercel 环境变量后 Redeploy。

### 区域不支持 / 延迟高

**原因**：`vercel.json` 中 `regions` 与数据库区域不匹配。

**解决**：确认数据库区域与 `hng1`（香港）就近；若使用 Neon，创建项目时选择 `ap-southeast-1`（新加坡）或邻近区域。

### 自定义域名 HTTPS 证书未签发

**原因**：DNS 解析未生效或 CNAME 指向错误。

**解决**：在 Vercel **Settings → Domains** 查看期望的 CNAME 值，确认 DNS 已正确配置，等待 5-30 分钟自动签发 Let's Encrypt 证书。

---

## 参考

- 仓库根目录 `.env.example`：完整环境变量清单与生成命令。
- `docs/runbook-deploy.md`：生产部署运维手册（含 RLS 激活、密钥轮换等）。
- `web/README.md`：本地开发与 Stripe 联调指南。
- [Vercel 官方文档](https://vercel.com/docs)：框架、区域、环境变量、自定义域名等。