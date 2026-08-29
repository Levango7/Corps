# corps 部署手册（Runbook）

> 基于仓库现状整理：`docker-compose.yml`（根目录，生产部署编排）、`web/Dockerfile`、
> `.github/workflows/ci.yml`、`db/schema.sql` 头部注释、`.env.example`。
> 更新日期：2026-08-28（部署产物化：CI 发布镜像到 GHCR，取代 CloudBase 占位部署）。

---

## 1. 前置条件

### 1.1 CI 产物（GHCR 镜像，2026-08-28 更新）

- CI 的 `docker-publish` job 在 push 到 `main` 或打 `v*` tag 时，通过 lint + audit +
  test + test-hardened + build 全部关卡后，把镜像发布到 GitHub Container Registry：
  `ghcr.io/<owner>/<repo>`，tag 含分支名（`main`）、语义化版本（`v*` tag）与 commit SHA。
- 首次发布后镜像默认为 private；如需生产服务器匿名拉取，在
  GitHub → Packages → corps-web → Package settings 中把可见性改为 public，
  或为服务器配置 GHCR 的 read 权限 token。
- 生产环境不再需要 CloudBase 专属 secrets；服务器侧唯一前置是安装 Docker/
  Docker Compose 并配置 `.env`（§1.2）。

### 1.2 密钥与环境变量清单（源自 `.env.example` 与 `docker-compose.yml`）

| 变量 | 必填 | 用途 |
|---|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | 是 | 数据库初始化（compose 默认值仅为示例，生产必须覆盖） |
| `DATABASE_URL` | 是 | 应用连接串（加固模式为 `corps_app` 角色）；compose 内 host 为 service 名 `db` |
| `DATABASE_OWNER_URL` | 是 | 属主连接串，仅供容器启动时 migrate deploy + rls-activate.sql |
| `CORPS_APP_PASSWORD` | 是 | RLS 加固模式运行时角色 `corps_app` 密码（`openssl rand -hex 16`） |
| `JWT_ACCESS_SECRET` / `BETTER_AUTH_SECRET` | 是 | 认证签名密钥，`openssl rand -hex 32` |
| `NEXT_PUBLIC_APP_URL` | 是 | 应用对外 URL（生产改为实际域名） |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_ID` / `STRIPE_PRICE_ID_YEARLY` | 否 | Stripe（年付需 `STRIPE_PRICE_ID_YEARLY`） |
| `PAYMENT_PROVIDER` / `ALIPAY_*` / `WECHAT_*` | 否 | 国内支付通道（未配置时前端隐藏入口） |
| `CRON_SECRET` | 否 | 截止日提醒定时作业的 Bearer 鉴权（需外部调度器每日调用） |
| `RESEND_API_KEY` / `EMAIL_FROM` | 否 | 邮件服务（Resend），`EMAIL_FROM` 为已验证发件域 |
| `CORS_ORIGINS` | 否 | 跨源白名单（逗号分隔精确 Origin） |

### 1.3 CI 流水线总览

push/PR 到 main 触发 lint + audit + test（PostgreSQL 18 service + migrate deploy +
vitest 集成）+ **test-hardened**（应用以 corps_app 最小权限角色连接 + FORCE RLS
激活后的端到端回归，与生产加固模式同构）+ build；`docker-publish` 仅在 push
（main / v* tag）且上述全部通过后发布镜像到 GHCR。

---

## 2. 构建与镜像产出

构建上下文为 `./web`（根目录 compose 的 `app.build` 配置），多阶段 Dockerfile：

1. **deps 阶段**：`node:22-alpine`，corepack 启用 pnpm，仅复制
   `package.json` + `pnpm-lock.yaml` + `prisma/`，
   `pnpm install --frozen-lockfile --ignore-scripts`（跳过 pnpm 11 默认拦截的构建脚本），
   再 `npx prisma generate` 生成客户端。
2. **builder 阶段**：复制源码后直接调用 `npx next build`（绕过依赖仓库根
   `design/design-tokens.css` 的 prebuild 钩子——**部署脚本需先把
   `../design/design-tokens.css` 同步进构建上下文的 `app/design-tokens.css`**）；
   随后手动复制 Prisma 引擎与 client 产物到 `.next/standalone`。
3. **runner 阶段**：全局安装 `prisma@6.15.0`（供启动时迁移），非 root 用户 `nextjs`
   运行 standalone 产物；入口为 `docker/entrypoint.sh`：
   先 `prisma migrate deploy`（幂等，失败即退出），再 `node server.js`。
   内置 HEALTHCHECK 访问 `/api/health`。

本地等价构建：

```bash
docker build -t corps-web:<tag> ./web
```

CI 的 `docker-publish` job 使用同样的 `./web` 构建上下文产出镜像并推送到
GHCR（tag = 分支名 / 语义化版本 / commit SHA，见 §1.1）。

---

## 3. 部署步骤

```bash
# 1. 准备 .env（cp .env.example .env），填入真实密钥（见 §1.2；勿用示例密码）
# 2. 拉取 CI 发布的镜像（或在服务器上本地构建 docker build -t corps-web:<tag> ./web）
docker pull ghcr.io/<owner>/<repo>:main   # 或 :<version> / :sha-<hash>

# 3. 启动/更新编排（根目录 docker-compose.yml 会以镜像运行；如需固定 CI 镜像，
#    把 compose 中 app.build 替换为 image: ghcr.io/<owner>/<repo>:<tag>）
docker compose up -d --build

# 4. 数据库迁移
#    容器 entrypoint 已自动执行 prisma migrate deploy；如需手动执行：
#    docker exec -it corps-app prisma migrate deploy --schema=/app/prisma/schema.prisma

# 5. RLS 生产加固：compose 默认 RLS_ACTIVATE=true，entrypoint 自动执行
#    db/rls-activate.sql（角色/FORCE/策略，含 v2 扩面表）；手动激活见 §7.2

# 6. 健康验证
curl -sf http://<host>:3000/api/health
```

---

## 4. 回滚流程

依据 SPEC §10 可回滚要求："每次部署可一键回滚；DB migration 必须可逆（down migration）"。

### 4.1 应用回滚（镜像 tag 回退）

```bash
# 回退到上一个已验证的镜像 tag（CI 同时以 commit SHA 打 tag）
# 在 docker-compose.yml 中把 app 的 image 指回旧 tag（或修改 .env 中的镜像变量）：
#   image: ghcr.io/<owner>/<repo>:sha-<prev-commit>
docker compose up -d
```

### 4.2 数据库回滚（注意：Prisma migrate 不自动回滚）

- 容器入口每次启动只做**前滚**（`prisma migrate deploy`），回退旧镜像**不会**自动
  还原数据库 schema。
- 因此每个上线迁移必须预先准备可逆方案，二选一：
  1. 提前编写并在演练环境验证过的 down 迁移 SQL，回滚时手动执行
     （可用 `npx prisma migrate resolve --rolled-back <migration>` 校正迁移账本）；
  2. 迁移执行前完成数据库备份（如 `pg_dump`），回滚时从备份恢复。
- 回滚后务必再次 `curl /api/health` 并抽查核心接口（注册/看板/计费状态）。

---

## 4.5 备份与恢复

### 备份脚本

`scripts/backup-db.sh`：pg_dump + gzip + 保留 N 天轮转。

```bash
DATABASE_URL="postgresql://postgres:xxx@localhost:5432/corps" \
BACKUP_DIR="/data/backups" \
RETENTION_DAYS=7 \
bash scripts/backup-db.sh
```

### cron 示例（每天凌晨 3 点）

```bash
0 3 * * * DATABASE_URL="postgresql://..." BACKUP_DIR="/data/backups" RETENTION_DAYS=7 bash /app/scripts/backup-db.sh >> /var/log/backup.log 2>&1
```

### 恢复步骤

```bash
gunzip -c /data/backups/corps_YYYYMMDD_HHMMSS.sql.gz | psql "$DATABASE_URL"
```

### RPO 声明

逻辑备份（pg_dump），非 WAL 连续归档。RPO ≈ 备份间隔（默认 24 小时），不保证零数据丢失。

---

## 5. 安全事项（2026-08-24 泄密轮换要求）

2026-08-24 发现示例密码 `cde5c8ed4f42f7bf880d0e46` 曾随 `.env.example` 与
`docker-compose.yml` 的默认值提交进版本库。处理要求：

- **所有环境必须轮换以下全部密钥**，任何环境不得继续使用版本库中出现过的值或
  示例占位值：
  - `POSTGRES_PASSWORD`
  - `JWT_ACCESS_SECRET`
  - `JWT_REFRESH_SECRET`
  - `BETTER_AUTH_SECRET`
  - 如使用 RLS 加固模式，一并轮换 `CORPS_APP_PASSWORD`
- 生成方式：`openssl rand -hex 32`；密钥仅经 GitHub secrets / 部署平台环境变量注入，
  禁止写入任何入库文件。
- `db/schema.sql` 中 `app_migrator` / `corps_app` 角色的 `CHANGE_ME_*` 占位密码同理，
  创建角色时必须替换。

---

## 6. PostgreSQL 16 → 18 升级注意事项

根目录 `docker-compose.yml` 的 `db` 服务已于 2026-08-24 升级为 `postgres:18-alpine`
（与 CI service 容器、SPEC 宣称版本对齐）。既有数据卷 `corps-postgres-data` 为
PG16 数据目录格式，PostgreSQL 主版本的数据目录不兼容，**不能原地升级**：

- 升级 compose 镜像到 `postgres:18-alpine` 前，必须先删除旧 PG16 数据卷重建：
  ```bash
  docker compose down -v   # 删除 corps-postgres-data 卷（连同其中 PG16 数据）
  docker compose up -d db
  ```
- ⚠️ **PG18 镜像挂载点变更**：官方 `postgres:18` 镜像要求数据卷挂载到
  `/var/lib/postgresql`（数据存放于其下的主版本子目录），不能再沿用 PG16 的
  `/var/lib/postgresql/data` 挂载方式——两个 compose 文件均已按新约定修改；
  若从旧卷迁移，需先 `pg_dump` 导出、以新挂载点重建后再导入。
- ⚠️ 仅限开发环境数据：`down -v` 会**永久删除**卷内全部数据。若需保留数据，
  应先 `pg_dump` 导出、升级后再导入，或使用 `pg_upgrade` 流程（生产环境不适用
  本节简化做法）。
- 参考：CI 的 test job 已经运行在 PostgreSQL 18 服务容器上，应用侧兼容性已有回归覆盖。

---

## 7. 生产加固必选步骤

部署到生产环境前，以下步骤**必须全部完成**（非可选）：

### 7.1 密钥轮换

所有密钥必须在首次部署前生成全新值（见 §5 泄密轮换要求）。

### 7.2 RLS 激活

```bash
# entrypoint.sh 在 RLS_ACTIVATE=true 时自动执行，手动激活：
docker exec -i corps-postgres psql -U postgres -d corps \
  -v app_password="$CORPS_APP_PASSWORD" \
  -f /path/to/db/rls-activate.sql
```

验证：
```bash
# 确认 RLS 已启用
docker exec corps-postgres psql -U postgres -d corps -c \
  "SELECT tablename, relrowsecurity FROM pg_class c
   JOIN pg_tables t ON c.relname = t.tablename
   WHERE t.schemaname='public' AND relrowsecurity=true;"
```

### 7.3 HSTS 边缘确认

middleware.ts 已在非 localhost 环境自动注入 `Strict-Transport-Security` 头。确认反向代理（Nginx/Cloudflare）未覆盖此头。

### 7.4 CSP nonce 验证

```bash
curl -sI https://your-domain.com/ | grep -i content-security-policy
# 应包含 nonce-xxxxx
```

### 7.5 备份 cron 落地

```bash
# 每日 02:00 备份，保留 7 天
0 2 * * * /opt/corps/scripts/backup-db.sh "$DATABASE_URL" /opt/corps/backups 7 >> /var/log/corps-backup.log 2>&1
```

### 7.6 反向代理与 HTTPS 前置要求（审计 2026-08-29）

限流器（`web/lib/rate-limit.ts`）采用"可信对端"模型还原客户端 IP：
- socket 对端为公网地址 → 直接采信 socket 地址，忽略一切代理头；
- socket 对端为私网/容器网桥 → 采信 `X-Forwarded-For` **尾段** 与 `X-Real-Ip`。

**生产必须满足（否则限流键可被伪造头绕过）：**
1. 所有流量经可信反向代理入口（客户端不可绕过代理直连应用）；
2. 反代将客户端真实 IP **append 到 X-Forwarded-For 尾部**（而非覆写整串）；
3. 强制覆写 `X-Real-Ip`（剥离客户端传入值）。

Nginx 参考：

```nginx
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

同时：`NEXT_PUBLIC_APP_URL` 生产必须为 `https://` 地址（middleware 的 HSTS 与 secure cookie 均依赖 HTTPS 前置）。compose 默认 `3000:3000` 为全网卡暴露，上线前应收敛为 `127.0.0.1:3000:3000` 仅由反代访问。

### 7.7 IM 附件存储（uploads 持久卷）

- `docker-compose.yml` 的 app 服务挂载命名卷 `uploads_data`（`corps-uploads-data`）到 `/app/uploads`。
- **不要移除该挂载**：重建容器若不挂卷，`uploads/` 落到容器可写层，重启即清空，而 DB 中的 `message_attachments` 记录仍指向这些文件 → 下载 404。
- 备份：`docker run --rm -v corps-uploads-data:/data -v /opt/corps/backups:/backup alpine tar czf /backup/uploads-$(date +%Y%m%d).tgz -C /data .`
- 升级路径：对象存储（S3/OSS）签名 URL 重定向，见 `app/api/uploads/[...path]/route.ts` 头注释。

### 7.8 附件孤儿文件清理

未发送消息的附件（上传后未 send）不会被下载端点服务（无 `message_attachments` 记录 → 404），但仍占用磁盘。运维侧定期清理（示例：清理 90 天前的文件，执行前先人工比对 DB 记录）：

```bash
find /opt/corps/uploads -type f -mtime +90 -delete
```

> 注意：`/opt/corps/uploads` 为卷挂载点示例，实际路径以 `docker volume inspect corps-uploads-data` 为准。
