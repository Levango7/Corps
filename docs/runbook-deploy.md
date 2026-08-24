# corps 部署手册（Runbook）

> 基于仓库现状整理：`docker-compose.yml`（根目录，生产部署编排）、`web/Dockerfile`、
> `.github/workflows/ci.yml`、`db/schema.sql` 头部注释、`.env.example`。
> 更新日期：2026-08-24。标注 **[占位]** 的命令需运维按实际 CloudBase 产品形态补齐。

---

## 1. 前置条件

### 1.1 CloudBase 环境

- 需要一个 CloudBase 环境（环境 ID 即 CI 变量 `CLOUDBASE_ENV_ID`）。
- GitHub Actions 的 `deploy-staging` / `deploy-production` job 在 `vars.CLOUDBASE_ENV_ID`
  未配置时**自动跳过**（避免"假通过"的占位部署）；配置后才会执行。
- 注意：当前两个 deploy job 的部署步骤**刻意失败**（`exit 1`），提示按本手册补齐部署
  命令后移除该退出码——在补齐前流水线不会产生真实发布。

### 1.2 密钥与环境变量清单（源自 `.env.example` 与 `docker-compose.yml`）

| 变量 | 必填 | 用途 |
|---|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | 是 | 数据库初始化（compose 默认值仅为示例，生产必须覆盖） |
| `DATABASE_URL` | 是 | 应用连接串；compose 内 host 为 service 名 `db`，端口 5432 |
| `JWT_ACCESS_SECRET` | 是 | wid 作用域 access JWT（15min）签名密钥，`openssl rand -hex 32` |
| `JWT_REFRESH_SECRET` | 是 | refresh JWT（7d）签名密钥，同上生成 |
| `BETTER_AUTH_SECRET` | 是 | Better Auth 会话托管密钥，同上生成 |
| `NEXT_PUBLIC_APP_URL` | 是 | 应用对外 URL（生产改为实际域名） |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_ID` | 否 | 未配置时计费页隐藏升级入口，不阻断其他功能 |
| `RESEND_API_KEY` / `EMAIL_FROM` | 否 | 邮件服务（Resend） |
| `CORPS_APP_PASSWORD` | 否 | RLS 加固模式的运行时角色 `corps_app` 密码（见 `db/schema.sql` ACTIVATION 节） |

### 1.3 所需 GitHub secrets / vars

| 类型 | 名称 | 说明 |
|---|---|---|
| vars | `CLOUDBASE_ENV_ID` | CloudBase 环境 ID（staging 与 production 环境各自配置） |
| secrets | `CLOUDBASE_SECRET_ID` / `CLOUDBASE_SECRET_KEY` | `tcb login` 用的云 API 密钥 |

CI 流水线（`.github/workflows/ci.yml`）：push/PR 到 main 触发 lint + audit + test
（PostgreSQL 18 service 容器 + `prisma migrate deploy` + vitest 集成测试）+ build；
build 通过后进入 deploy-staging（main 分支）/ deploy-production（`v*` tag）。

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

CI 中 deploy job 同样以 `docker build -t corps-web:${{ github.sha }} .` 产出镜像
（tag = commit SHA）。镜像推送/托管方式 **[占位]**：需按实际 CloudBase 产品形态补齐
（镜像仓库地址、登录凭证与 push 命令）。

---

## 3. 部署步骤

> 以下框架中的 **[占位]** 均需运维按实际使用的 CloudBase 产品形态补齐。

```bash
# 1. 准备 .env（cp .env.example .env），填入真实密钥（见 §1.2；勿用示例密码）
# 2. 构建镜像
docker build -t corps-web:<tag> ./web

# 3. 推送镜像 **[占位]**：登录并 push 到实际镜像仓库
#    docker login <registry> && docker push <registry>/corps-web:<tag>

# 4. 部署到 CloudBase **[占位]**：按产品形态补齐，例如
#    - 云托管（CloudBase Run）：tcb run deploy ... 或控制台更新镜像版本
#    - 或其他容器/主机形态的发布命令
#    补齐后同步修改 .github/workflows/ci.yml 中两个 deploy job 的 TODO 段落
#    并移除刻意失败的 exit 1。

# 5. 数据库迁移
#    容器 entrypoint 已自动执行 prisma migrate deploy；如需手动执行：
#    docker exec -it corps-app prisma migrate deploy --schema=/app/prisma/schema.prisma

# 6. （可选）RLS 生产加固：创建非表主角色 corps_app 并将 DATABASE_URL 指向它，
#    步骤见 db/schema.sql 头部 ACTIVATION 注释。

# 7. 健康验证
curl -sf http://<host>:3000/api/health
```

---

## 4. 回滚流程

依据 SPEC §10 可回滚要求："每次部署可一键回滚；DB migration 必须可逆（down migration）"。

### 4.1 应用回滚（镜像 tag 回退）

```bash
# 回退到上一个已验证的镜像 tag（CI 以 commit SHA 作为 tag）
docker tag <registry>/corps-web:<prev-sha> corps-web:latest
# **[占位]**：按实际 CloudBase 产品形态将运行实例指回旧 tag 并重启
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
