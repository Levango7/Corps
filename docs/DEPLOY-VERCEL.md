# Vercel 部署指南

本文档介绍如何将 corps 部署到 Vercel。面向国内用户，默认部署到新加坡区域（`sin1`，ap-southeast-1）。

> Vercel 的 19 个可用 Function 区域中**不存在** `hng1` 这个 slug；香港的正确写法是 `hkg1`，但 OpenAI 自 2025-07-09 起拒绝来自 `hkg1` 的 Function 请求，会让 `web/lib/ai/deepseek.ts` 的 OpenAI 备用通道失效，因此本项目不选它。

> **Root Directory 必须设为 `web`**（不是默认的仓库根）。本仓库的应用本体在 `web/`，而 Vercel 的 Next.js 构建器按「项目根」做两件事：读 `package.json` 里的 `next` 依赖来识别框架版本、读锁文件来推断包管理器版本。项目根留在仓库根时这两项都落空，日志里的实测报错是：
> `Error: No Next.js version detected. Make sure your package.json has "next" in either "dependencies" or "devDependencies". Also check your Root Directory setting matches the directory of your package.json file.`
> 把 Root Directory 设成 `web` 后两项同时成立——`web/package.json` 有 `next`，`web/pnpm-lock.yaml` 存在。配置文件也随之外移：**`web/vercel.json`**（仓库根不再放 `vercel.json`，避免双源）。
>
> **为什么 `installCommand`/`buildCommand` 里仍要把 pnpm 版本写死为 `pnpm@11.22.0`**（2026-10-02 由真实构建日志定位）：Vercel 对 `lockfileVersion: '9.0'` 只会选 pnpm 9 或 10（官方 docs/package-managers 的版本推断表），而本仓库的锁文件与 `pnpm-workspace.yaml` 由 pnpm 11 维护；更早在项目根为仓库根时，Vercel 走覆盖式 `installCommand` 直接取容器里**最旧的 pnpm（6.x）**，pnpm 6 认不出 9.0 锁文件，会先 `WARN Ignoring not compatible lockfile` 丢弃锁文件、再在 `--frozen-lockfile` 上以 `ERROR Headless installation requires a pnpm-lock.yaml file` 秒退。命令里钉版本 = 不依赖 Vercel 的推断。
> 两个走不通的替代方案，别再试：① 在仓库根加 `package.json` 写 `packageManager`——该字段只在项目启用 Corepack 时才被 Vercel 读取，对本项目无效；而且 `pnpm/action-setup` 的 `version` 输入与仓库根 `packageManager` 同时存在时 action 直接失败并报 `Multiple versions of pnpm specified`（实测打红 6 个 job）。② 只加仓库根 `package.json` 而不带 `next` 依赖——Vercel 依旧识别不到 Next 版本。
> 这里钉的版本串需与 `web/package.json` 的 `packageManager` 保持一致。

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
6. **Root Directory 必须改为 `web`**（默认是仓库根，保持默认会构建失败，原因见开头那条注记）。这一步不能省：Vercel 只在项目根读 `package.json`/锁文件来识别 Next.js 版本与包管理器版本，而它们都在 `web/` 下。
7. **Build Command / Install Command / Output Directory** 由 `web/vercel.json` 提供，无需在 Dashboard 手填（不要退回默认值，默认会挑到 Vercel 自己的 pnpm 版本推断）。
8. 暂不点击 **Deploy**，先完成环境变量配置（步骤 2）。

---

## 步骤 2：配置环境变量

在 Vercel 项目的 **Settings → Environment Variables** 中逐条添加。建议同时配置 **Production**、**Preview**、**Development** 三个环境（或至少 Production）。

### 必填项

| 变量名 | 说明 | 示例值 |
|--------|------|--------|
| `DATABASE_URL` | PostgreSQL 连接字符串（含 schema 参数） | `postgresql://user:pass@host:5432/corps?schema=public` |
| `BETTER_AUTH_SECRET` | 认证密钥，32 字节十六进制 | `openssl rand -hex 32` 生成 |
| `JWT_ACCESS_SECRET` | 业务 JWT 签名密钥，≥32 字符 | `openssl rand -hex 32` 生成 |
| `JWT_REFRESH_SECRET` | refresh token 密钥，≥32 字符（启动校验项，缺一即退出） | `openssl rand -hex 32` 生成 |
| `NEXT_PUBLIC_APP_URL` | 应用正式域名（生产环境必填） | `https://corps.vercel.app` |
| `CORPS_APP_PASSWORD` | RLS 运行时角色密码（与 `rls-activate.sql` 一致） | `openssl rand -hex 16` 生成 |
| `RLS_ACTIVATE` | RLS 加固开关 | `true` |

> **Build 成功 ≠ 部署可用。** 上表前五项（`DATABASE_URL` / `BETTER_AUTH_SECRET` / `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` / `NEXT_PUBLIC_APP_URL`）缺任何一项，`vercel build` 都不会报错——345 条路由里除 `/_not-found` 外全是 `ƒ` 动态渲染，构建期不执行它们的代码，只会在 "Collecting page data" 阶段留几行日志。真正的后果在运行时：
>
> **1. 启动即退出。** `web/instrumentation.ts:14` 调 `getEnv()`（`lib/env.ts` 的 zod schema 正是这五项），`:21-23` 是
> ```ts
> if (process.env.NODE_ENV === "production") { process.exit(1); }
> ```
> Vercel 运行时 `NODE_ENV=production`，所以少任一项 ⇒ 进程打印 `[instrumentation] 环境变量校验失败` 后 `exit(1)`，所有请求都拿不到响应。开发环境只警告不退出，因此本地能跑≠线上能跑。
>
> **2. 即便绕过 1，还有两处会抛：**
> - `BETTER_AUTH_SECRET` 缺失 → better-auth 的 `validateSecret`（`better-auth/dist/context/create-context.mjs:42`）`if (isDefaultSecret && isProduction) throw`，凡 import `lib/auth.ts` 的页面/接口 500。构建日志里对应 `[Error [BetterAuthError]: You are using the default secret...]`。
> - `JWT_ACCESS_SECRET` 缺失 → `lib/jwt.ts:14-20` 的 `requireSecret()` 抛 `Missing required env var: JWT_ACCESS_SECRET`（刻意不回退默认值）。
> - `NEXT_PUBLIC_APP_URL` 缺失/与实际域名不一致 → 构建里先打 `Base URL is not set`（`lib/auth.ts:19` 用它作 `baseURL`），`lib/jwt.ts:3` 的 `issuer` 也会退化成 `http://localhost:3000`。
>
> **3. 一次实测反证**（2026-10-02，commit 9b94821 的 Vercel 构建日志）：三项都未配置时构建仍然 `✓ Compiled successfully in 47s` / `Build Completed in /vercel/output [2m]` / `Deployment completed` —— 部署显示成功，应用其实起不来。所以配完环境变量后不能只看部署状态，要真的打开一次页面。
>
> 启用 Vercel Cron（`vercel.json` 的 `crons`）时再加 `CRON_SECRET`：`/api/cron/*` 以 `Authorization: Bearer ${CRON_SECRET}` 鉴权，未配置则所有 cron 路由拒绝请求（它是 `lib/env.ts` 之外的读取项，不会触发启动退出）。

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

### 部署直接失败：`Deployment failed — Invalid region`

**原因**：`vercel.json` 的 `regions` 写了 Vercel 不存在的 slug。非法区域在**构建开始之前**就让部署失败，报错文本不含 slug 名，容易被误读成权限或套餐问题。

**解决**：`regions` 只能取以下 19 个 slug 之一：
`arn1 bom1 cdg1 cle1 cpt1 dub1 fra1 gru1 hkg1 hnd1 iad1 icn1 kix1 lhr1 pdx1 sfo1 sin1 syd1 yul1`
（清单见 [Vercel regions](https://vercel.com/docs/regions#region-list)）。另注意套餐限制：Hobby 仅单区域，Pro 最多 5 个；配超了同样会在构建前失败。

### 延迟高

**原因**：`vercel.json` 中 `regions` 与数据库区域不匹配。

**解决**：Function 应与数据库同区域或就近。本项目取 `sin1`（新加坡，ap-southeast-1）；若使用 Neon，创建项目时同样选 `ap-southeast-1`。

### 自定义域名 HTTPS 证书未签发

**原因**：DNS 解析未生效或 CNAME 指向错误。

**解决**：在 Vercel **Settings → Domains** 查看期望的 CNAME 值，确认 DNS 已正确配置，等待 5-30 分钟自动签发 Let's Encrypt 证书。

---

## 参考

- 仓库根目录 `.env.example`：完整环境变量清单与生成命令。
- `docs/runbook-deploy.md`：生产部署运维手册（含 RLS 激活、密钥轮换等）。
- `web/README.md`：本地开发与 Stripe 联调指南。
- [Vercel 官方文档](https://vercel.com/docs)：框架、区域、环境变量、自定义域名等。