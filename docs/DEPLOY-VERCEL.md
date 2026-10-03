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

> **Build 成功 ≠ 部署可用；但构建日志也不是判据。** 上表五项（`DATABASE_URL` / `BETTER_AUTH_SECRET` / `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` / `NEXT_PUBLIC_APP_URL`）**缺任何一项、或某一项的值不合 schema**，`vercel build` 都不会报错——345 条路由里除 `/_not-found` 外全是 `ƒ` 动态渲染，构建期不执行它们的代码。"值不合 schema"这条是本项目实测出来的：2026-10-03 查线上时发现三项变量早在 31 天前就已配好且 target 含 Production+Preview，但值是占位串（`Invalid url`）或短密钥（`< 32 字符`），运行时照样起不来。真正的后果在运行时：
>
> **1. 启动即退出。** `web/instrumentation.ts:14` 调 `getEnv()`（`lib/env.ts` 的 zod schema 正是这五项），`:21-23` 是
> ```ts
> if (process.env.NODE_ENV === "production") { process.exit(1); }
> ```
> Vercel 运行时 `NODE_ENV=production`，所以缺项**或值校验不过** ⇒ 进程打印 `[instrumentation] 环境变量校验失败` 后 `exit(1)`，所有请求都拿不到响应。校验不过时的原文（线上实测，逐项对应 `lib/env.ts:10-20`）：`DATABASE_URL: Invalid url`、`NEXT_PUBLIC_APP_URL: Invalid url`（都是 `z.string().url()`，值是占位串/空串/无协议头时命中），`BETTER_AUTH_SECRET: String must contain at least 32 character(s)`。注意报错文案里那句"必需变量：…"是硬编码列表，**不代表这些都没配** —— 只看它下面逐条列出的字段名。开发环境只警告不退出，因此本地能跑≠线上能跑。
>
> **2. 运行时还会各抛一次：**
> - `BETTER_AUTH_SECRET` 缺失 → better-auth 的 `validateSecret`（`better-auth/dist/context/create-context.mjs:42`）`if (isDefaultSecret && isProduction) throw`，凡 import `lib/auth.ts` 的页面/接口 500。
> - `JWT_ACCESS_SECRET` 缺失 → `lib/jwt.ts:14-20` 的 `requireSecret()` 抛 `Missing required env var: JWT_ACCESS_SECRET`（刻意不回退默认值）。
> - `NEXT_PUBLIC_APP_URL` 缺失/与实际域名不一致 → `lib/auth.ts:19` 的 `baseURL` 与 `lib/jwt.ts:3` 的 `issuer` 会退化成 `http://localhost:3000`。
>
> **3. 别拿构建日志里那两行 better-auth 提示当故障信号。** 本项目实测（2026-10-03，`corps` 项目）：`BETTER_AUTH_SECRET` / `NEXT_PUBLIC_APP_URL` 早在 31 天前就配好且 target 含 Production+Preview，但 `vercel build` 的 "Collecting page data" 阶段仍然打印
> ```
> WARN [Better Auth]: Base URL is not set. ...
> [Error [BetterAuthError]: You are using the default secret. ...]
> ```
> 原因是这些变量的 `type=sensitive`（`vercel env ls --project corps --json` 可见），而 **sensitive 变量不注入构建沙箱**，只在函数运行时可见。用本地构建产物可以复核"运行时才查表"这一点：`grep -rl <构建期哨兵值> .next/server` = 0 命中，而 `.next/server` 里 `process.env.BETTER_AUTH_SECRET` 字面量有 2 处 —— 值没有被烤进产物，运行时读的是真实环境。
>
> 推论与例外：`NEXT_PUBLIC_*` 走的是**构建期内联**，若某段 `"use client"` 代码读 `process.env.NEXT_PUBLIC_APP_URL`，用 sensitive 存就会把它烤成 `undefined`。当前全仓客户端读取点为 0（按 `"use client"` 文件筛 `NEXT_PUBLIC_APP_URL` 无命中），所以没踩到；一旦需要客户端读它，就把该变量改成 **Config** 类型。
>
> **4. 正确的验收方式**：看运行时，不看构建日志。
> ```bash
> npx vercel logs <deployment-url>          # 或 vercel logs --follow，配合浏览器打一次
> ```
> 判据换两件事来验，别去找"校验通过"那行 —— 实测（2026-10-03，`corps` 项目）它**在 Vercel 的日志流里看不到**：函数冷启动发生在第一个请求之前，而 `vercel logs` 返回的是请求级记录（`λ` 服务器函数 / `ε` 边缘中间件），`instrumentation.ts:17` 那句 `console.log` 不在其中（`--follow -x` 连打多次探针均未捕获）。
>
> - **`--level error` 返空**：
>   ```bash
>   npx vercel logs <deployment-url> --level error    # 期望 No logs found
>   ```
>   这条判据是**双侧验证过**的：配坏的那条部署（`corps-hckspba94`）用同一条命令能打出成片的 `[instrumentation] 环境变量校验失败 …` + `Node.js process exited with exit status: 1`，配好后同一条命令返回 `No logs found`。先证明判据能命中，再拿它的空值下结论。
> - **真请求拿到应用自己的 HTML**：首页 `302 → /en/auth/login`，页面 `<title>` 是 `corps · Team`；配坏时取回的是 Vercel 的 `500: This page couldn't load`。
>
> 本机访问不通 `*.vercel.app`（是 SNI/TCP 级阻断：`curl --resolve <domain>:443:<真边缘IP>` 仍 0.08s 被 RST，`vercel curl` 也是在本机跑 curl，绕不过）。两条替代路：换网络（手机流量）打开一次；或用墙外取回器代发 —— `curl "https://api.microlink.io/?url=<urlencoded>"` 的 `data.title` / `data.statusCode` / `data.url` 就是真结果，**而且这一发会在目标服务端留下运行时日志**，正好配合 `vercel logs`。注意没有流量就没有日志，且 `--follow` 单次上限 5 分钟（到点 `WARNING! Exceeded query duration limit`）。
>
> 还有一个有用的分层现象：`DATABASE_URL` **形状合法但库不可达**时，进程照常启动、页面照常渲染，只有真打库的接口报错（实测 `/api/health` → `prisma:error Invalid prisma.$queryRaw() invocation: Can't reach database server at db.invalid:5432`）。所以"页面能出"证明的是部署链路通，不证明数据库通 —— 两件事要分开验收。
>
> 启用 Vercel Cron（`vercel.json` 的 `crons`）时再加 `CRON_SECRET`：`/api/cron/*` 以 `Authorization: Bearer ${CRON_SECRET}` 鉴权，未配置则所有 cron 路由拒绝请求（它是 `lib/env.ts` 之外的读取项，不会触发启动退出）。

### Docker/K8s 专用项（在 Vercel 上设了也没用）

`RLS_ACTIVATE` 与 `CORPS_APP_PASSWORD` **不是 Vercel 的必填项**。全仓读取它们的只有三处，都在容器/脚本侧：

| 读取点 | 作用 |
|---|---|
| `web/docker/entrypoint.sh:28,44` | `RLS_ACTIVATE=true` 且有 `DATABASE_OWNER_URL` + `CORPS_APP_PASSWORD` 时，用 `psql` 执行 `db/rls-activate.sql`；缺任一项则报错退出 |
| `docker-compose.yml:111,115,165` | 把两者传进容器，并让 app 的连接串走 `corps_app` 角色 |
| `db/rls-smoke.sh:24,37` | 手工冒烟脚本：`CORPS_APP_PASSWORD` 未设即中止，并用它执行激活脚本 |

Vercel 侧不存在 entrypoint（`web/vercel.json` 的 `buildCommand` 只有 `prisma generate && next build`，运行的是 Serverless 函数，没有容器启动脚本），应用代码里对这两个名字的引用全是注释文本 —— 所以在 Vercel 设 `RLS_ACTIVATE=true` 不会产生任何效果，白白多配一项。

要在 Vercel 部署上获得引擎层隔离，得手工做 Docker 路径由 entrypoint 自动完成的那一步：

```bash
# 1. 用 owner 连接串激活（幂等，可重复执行）
psql "$DATABASE_OWNER_URL" -v ON_ERROR_STOP=1 \
     -v app_password="$CORPS_APP_PASSWORD" -f db/rls-activate.sql

# 2. 把 Vercel 的 DATABASE_URL 换成最小权限角色 corps_app（对齐 docker-compose.yml:111）
#    postgresql://corps_app:<CORPS_APP_PASSWORD>@ep-xxx.neon.tech/corps?schema=public&sslmode=require
```

两点注意：

- `rls-activate.sql` 建的 `corps_app` 是 `NOBYPASSRLS` 角色，脚本同时给全部租户表加 `ENABLE + FORCE ROW LEVEL SECURITY`（FORCE 的意义正是堵表 owner 的旁路）。激活后若继续用 owner 连接串，未设置 `app.*` GUC 的查询会**静默返回空集**而不是全集 —— `lib/payments/types.ts:69`、`stripe-provider.ts:144`、`billing/portal/route.ts:22` 记录的三类历史缺陷就是这个形态（订阅查不到 → 恒 400）。
- **未跑激活脚本时线上是什么状态**：整个迁移目录里只有一张表把 RLS 写进了迁移 —— `web/prisma/migrations/20260912000002_add_temporary_grants/migration.sql:31-52`，对 `temporary_grants` 做 `ENABLE + FORCE ROW LEVEL SECURITY` 并建 4 条策略（策略读 `app.workspace_id`，另给 `app.auth_op='cron'` 开了口子）。其余租户表的 ENABLE/FORCE 与策略**只存在于 `db/rls-activate.sql`**（该脚本按清单动态下发，不是在迁移里逐表写死），`prisma migrate deploy` 不会带来它们。所以只用 Neon owner 连接串部署时，租户隔离实际依赖应用层的 `workspaceId` 过滤；别因为 ADR/巡检报告里记着"81 张受保护表 / 272 条策略"就认为线上已经通电 —— 那组数字是 `scripts/check_rls_exemptions.py:144-151` **静态解析 `db/rls-activate.sql` 文本**得出的，证明的是"脚本会建这些策略"，不证明"目标库执行过这个脚本"。要在具体库上确认，得直接查数据库状态（`pg_class.relrowsecurity` / `relforcerowsecurity` 与 `pg_policies`）。

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

# 5. （可选）激活 RLS —— Vercel 没有 entrypoint，必须手工执行
#    见上文「Docker/K8s 专用项」：先跑 db/rls-activate.sql，再把 DATABASE_URL 换成 corps_app
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

### 注册/登录恒 403：`Cross-origin request blocked (CSRF protection)`

**原因**：`NEXT_PUBLIC_APP_URL` 是**构建期静态替换**进产物的（Next 对 `NEXT_PUBLIC_*` 在客户端与服务端 bundle 里都烤值），运行时再设同名环境变量**完全无效**。部署到 `https://xxx.vercel.app` 但构建时烤的是 `http://localhost:3000`，则 `web/middleware.ts:116` 的同源检查与 better-auth 的 baseURL 都会拒掉写操作。

**实测**：同一份产物里能同时数出烤进去的旧值（`grep -rhoE "http://localhost:[0-9]{3}" .next/server` 命中 33 处），改成正确域名后必须**重新构建**才生效。

**解决**：先定最终对外域名 → 填 `NEXT_PUBLIC_APP_URL`（用 **Config** 类型，见上文第 3 条例外）→ 再触发构建/Redeploy。顺序反了就会出现"部署 Ready 但注册 403"。

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