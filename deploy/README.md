# corps 生产部署包

> 目标：拿到一台干净 VPS 后 30 分钟内跑起来，且**出事能一键回退**。
> 首次部署日期：待填。部署人：待填。目标环境：2C4G / Ubuntu 22.04+。
>
> 与 `docs/runbook-deploy.md` 的关系：runbook 是**知识**（为什么这么配、有什么坑），
> 本目录是**执行**（可运行的脚本与配置）。两者必须一致；改本目录的部署行为时
> 同步改 runbook，反之亦然。

---

## 0. 三十秒版本

```bash
git clone --depth 1 git@github.com:Levango7/Corps.git /opt/corps && cd /opt/corps
cp deploy/.env.prod.example deploy/.env.prod
$EDITOR deploy/.env.prod          # 填密钥、域名、镜像 tag —— 见 §2
bash deploy/scripts/preflight.sh  # 不通过就别往下走
bash deploy/scripts/deploy.sh
```

`preflight.sh` 会拦下所有"一定会炸"的配置。**它失败是正常的**，逐条修完再跑。

---

## 1. 30 分钟分解

| 步骤 | 动作 | 预算 |
|---|---|---|
| §2 | 装 Docker + Compose v2.24+ | 5 min |
| §3 | 配 `.env.prod`（密钥 + 域名 + tag） | 10 min |
| §4 | 放通安全组 80/443 | 2 min |
| §5 | `preflight.sh` 跑到绿 | 3 min |
| §6 | `deploy.sh` 起服务 | 5 min |
| §7 | 确认定时备份已落地 | 5 min |

超出预算的常见原因：域名 ICP 备案没完成（见 §5.1）。

---

## 2. 前置：Docker 与 Compose

```bash
# Ubuntu 22.04+ 官方脚本
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

# 必须 >= v2.24：prod overlay 用 !reset 删除 db/app 的 ports 与 app 的 build 段。
# 更低版本会静默忽略这两个标签——overlay 看着生效了，db 端口其实还开着。
docker compose version
```

GHCR 在国内访问不稳定，先配镜像加速（否则 `deploy.sh` 第 4 步会卡住）：

```bash
# /etc/docker/daemon.json
{
  "registry-mirrors": ["https://docker.m.daocloud.io"]
}
sudo systemctl restart docker

# GHCR 单独配代理（registry-mirrors 对 ghcr.io 无效）：
# 在 /etc/docker/daemon.json 加 insecure-registries 或用 CI 下发的镜像 tar 包导入
docker pull ghcr.io/levango7/corps:0.2.0   # 验证能拉通再往下
```

---

## 3. 配置 `.env.prod`

```bash
cp deploy/.env.prod.example deploy/.env.prod
```

三类必填，缺一不可：

**① 密钥（7 项，`preflight.sh` 逐项校验长度）**

```bash
openssl rand -hex 32   # BETTER_AUTH_SECRET / JWT_ACCESS_SECRET / JWT_REFRESH_SECRET
openssl rand -hex 32   # CRON_SECRET / CALENDAR_CRYPTO_KEY
openssl rand -hex 16   # POSTGRES_PASSWORD / CORPS_APP_PASSWORD
```

⚠️ 2026-08-24 有示例密码进过版本库（runbook §5）。**每个环境都必须用新生成的值**，
不能沿用任何在文档或历史提交里出现过的字符串。preflight 会拒绝已知坏值。

**② 对外地址**

```bash
# 备案完成后
CORPS_SITE_ADDRESS=corps.example.com
NEXT_PUBLIC_APP_URL=https://corps.example.com

# 备案期内（见 §5.1）
CORPS_SITE_ADDRESS=http://203.0.113.10
NEXT_PUBLIC_APP_URL=http://203.0.113.10
```

两者域名必须一致，否则 OAuth 回调跳错域、secure cookie 不下发。preflight 会断言。

**③ 镜像 tag**

```bash
CORPS_IMAGE_TAG=0.2.0        # 或 sha-<hash>，禁止 latest
```

为什么禁 `latest`：它是可变引用。回滚时"上一个版本"无法确定，回滚能力直接失效。
可用的 tag 由 CI `docker-publish` 产出（`.github/workflows/ci.yml:556-566`）：
分支名、语义化版本（`0.2.0` / `0.2`）、commit SHA（`sha-<hash>`）、`latest`。

---

## 4. 安全组与防火墙

| 端口 | 放通 | 用途 |
|---|---|---|
| 22 | 是 | SSH（建议限源 IP） |
| 80 / 443 | 是 | Caddy。**443/UDP 也要开**，否则 HTTP/3 静默降级 |
| 5432 / 5433 | **否** | 生产 db 无宿主机端口（preflight 断言） |
| 3000 | **否** | 生产 app 无宿主机端口，唯一入口是 Caddy |
| 7881 + 50000-50100/UDP | 用 LiveKit 才开 | RTC 媒体，**不经 Caddy** |

---

## 5. 备案期的访问方式

ICP 备案完成前，域名解析到境内 IP 会被运营商拦截。这不是配置问题，
**唯一的合法访问方式是 `http://<服务器公网IP>` 明文访问**。

对应做法（不维护两份 Caddyfile，靠一个环境变量切换）：

```bash
# 备案期
CORPS_SITE_ADDRESS=http://203.0.113.10     # 显式 http:// 前缀 → Caddy 不申请证书
```

Caddy 的既定行为：site address 带显式 `http://` 时不申请证书、不做 HTTPS 跳转。
备案完成后改成域名并 `docker compose ... up -d caddy`，证书自动签发、**自动续期**
（这是选 Caddy 而非 Nginx 的唯一理由——Nginx 的 certbot 续期是一条会静默腐烂的链）。

备案期内这三项是**有意关闭**的，不是 bug：

- `/api/health` 对公网返回 403：它会泄露数据库是否在线（DB 探测失败返回 503），
  是免费的数据库状态探测口。健康验证走 `healthcheck.sh` 在服务器本地执行。
- `/api/metrics` 对公网返回 403：Prometheus 指标含节点内存与运行时信息。
- 无 HTTPS、无 HSTS、无 secure cookie。

---

## 6. 上线与日常运维

### 上线

```bash
CORPS_IMAGE_TAG=0.2.1 bash deploy/scripts/deploy.sh
```

固定序列，每步失败即中止并自动回滚：

```
preflight → 记录 VERSION.previous → 触发备份 → pull app
  → up -d --no-deps app → 轮询健康检查(120s) → 写 VERSION
```

`--no-deps` 是刻意的：避免连带重建 db 容器。数据在卷里不会丢，但会中断所有
连接并拉长重启窗口。

### 健康检查

```bash
bash deploy/scripts/healthcheck.sh                      # 用 .env.prod 的本地地址
bash deploy/scripts/healthcheck.sh http://127.0.0.1:3000/api/health   # 自定义
```

判定标准是 HTTP 200 **且** `status:"ok"` **且** `db:"up"`。只看状态码不够——
反代返回自己的错误页时也是 200。

失败时脚本会自动附上容器状态、健康检查历史、重启次数、日志尾部 30 行。
"健康检查失败"本身不告诉你原因，那些信息才有。

### 连数据库排查

生产 db **没有**宿主机端口，只能进容器：

```bash
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml \
  --env-file deploy/.env.prod exec db psql -U postgres -d corps
```

### 常用命令

```bash
# 看状态
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml \
  --env-file deploy/.env.prod ps

# 看日志
docker logs corps-app --tail 100 -f
docker logs corps-caddy --tail 100 -f

# 改完 Caddyfile 后热加载（不重启容器，连接不断）
docker compose ... exec caddy caddy reload --config /etc/caddy/Caddyfile

# 校验 Caddyfile 语法（改完先验再 reload，语法错误会让容器起不来）
docker compose ... exec caddy caddy validate --config /etc/caddy/Caddyfile
```

---

## 7. 备份与恢复

### 现状：本部署包落地前，备份从未真正执行过

`scripts/backup-db.sh` 早就在仓库里，但**没有任何编排引用它**——根 compose 无
backup 服务，宿主机无 crontab。等于"有脚本但从来没备份过"。本部署包通过
`deploy.sh` 的第 3 步（每次上线前强制备份）让链路先跑起来，再按下面配 cron。

### 每日备份

```bash
crontab -e
# 每天 03:17（避开整点：整点是各系统备份任务的高峰，磁盘 IO 竞争）
17 3 * * * cd /opt/corps && docker compose -f docker-compose.yml \
  -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod \
  exec -T db sh -c 'pg_dumpall -U "${POSTGRES_USER:-postgres}"' \
  | gzip > /opt/corps/backups/corps_$(date +\%Y\%m\%d_\%H\%M\%S).sql.gz \
  && find /opt/corps/backups -name 'corps_*.sql.gz' -mtime +7 -delete
```

**RPO 声明**：逻辑备份（pg_dump），非 WAL 连续归档。RPO ≈ 备份间隔（默认 24h），
不保证零数据丢失。要更小的 RPO 需要 WAL 归档，那是另一套设施，不在本包范围。

### 每月验证一次备份

**没验证过的备份等于没有备份。** 备份文件存在不等于可恢复——它可能截断、可能
缺表、可能躺在磁盘上却恢复不进去。`restore.sh --dry-run` 就是为此存在：

```bash
bash deploy/scripts/restore.sh --list                 # 列出并逐个验 gzip 完整性
bash deploy/scripts/restore.sh --dry-run <文件>       # 恢复到临时库 + 输出核心表行数
```

`--dry-run` **只碰临时库**（`corps_restore_check`），生产库一个字节都不动。
这是刻意的：pg_dump 输出是一串顺序语句，中途失败会留下半恢复的库——
比恢复前更糟。历史多数恢复事故不是"恢复失败"，而是"恢复一半发现备份不对，
而生产库已经改了一半"。

真恢复必须显式 `--force`，且会强制：输入 `RESTORE` 二次确认 + 先自动备份
当前生产库（能退回去才允许往下走）。

---

## 8. 回滚

### 应用回滚

```bash
bash deploy/scripts/rollback.sh              # 回到 VERSION.previous
bash deploy/scripts/rollback.sh 0.2.0        # 回到指定 tag
```

回滚后健康检查仍失败，**不要盲目继续回滚**——那通常说明问题不在镜像版本。
最常见的组合故障是"旧代码 + 新 schema"（见下）。

### 回滚盲点：镜像能退，数据库不能

```
        deploy v0.3.0                rollback
时间轴  ─────────────────►  ───────────────►
        schema 迁移已应用     镜像回到 v0.2.0
        prisma migrate       prisma migrate deploy
        deploy 前滚完成       不会反向执行
                             ↓
        结果：v0.2.0 的代码 + v0.3.0 的 schema
```

**`prisma migrate deploy` 是单向的。** 容器入口每次启动只前滚，回退镜像 tag
**不会**还原数据库 schema。这不是 bug，是 Prisma 的设计（它不生成 down 迁移）。

| 迁移类型 | 回滚方式 | 风险 |
|---|---|---|
| 只加表 / 加可空列 | 直接退镜像 | 低 |
| 加非空列（有默认） | 直接退镜像，旧代码忽略新列 | 低 |
| 删列 / 改列类型 / 改约束 | **必须**从备份恢复 | 高 |
| 重命名列（删+加） | 需手写兼容或走恢复 | 高 |

**硬约束：每次上线前确认迁移是否可逆。** 不可逆的迁移必须**拆分发布**——
先上线兼容新旧两种 schema 的代码（双写/双读），确认稳定后再清理旧字段。
一次发布里同时改 schema 和依赖它的代码，等于放弃回滚能力。

`deploy.sh` 成功后会打印这条提醒，因为它是最容易被忘记的事。

---

## 9. 反代配置要点

配置分片在 `deploy/Caddyfile.d/`，主 `Caddyfile` 只做全局块与 import。

### X-Forwarded-For 必须 append —— 这里最容易踩坑

限流器（`web/lib/rate-limit.ts`）用"可信对端"模型还原客户端 IP：socket 对端是
公网就采信 socket 地址，私网/网桥就采信 `X-Forwarded-For`。Caddy 到 app 的连接
来自 compose 内网，所以限流器**一定会去读 XFF**。

于是两条都致命的错法：

1. **覆写整串** → 链路信息丢失，多级代理下取到倒数第二跳
2. **原样透传** → 攻击者每次请求换一个伪造头，限流键每次都不同，限流形同虚设

Caddy 的 `reverse_proxy` 默认行为**恰好就是 append**，所以正确做法是什么都不写：

```caddyfile
reverse_proxy {$APP_UPSTREAM} {
    header_up X-Real-Ip {remote_host}    # 覆写：剥离客户端伪造值
    # ⛔ 故意不设置 X-Forwarded-For —— 保持默认 append 语义
}
```

一旦写了 `header_up X-Forwarded-For ...` 就变成覆写，直接踩坑 1。

### LiveKit 的媒体流不经 Caddy

`Caddyfile.d/20-livekit.conf` 只反代 7880（L7 信令）。RTC 媒体（7881/TCP +
50000-50100/UDP 的 RTP）**必须**保留宿主机端口映射——Caddy 是 L7 HTTP 代理，
转发不了 UDP。

误判提示：只配 Caddy 不开媒体端口时，浏览器能连上信令、能"加入房间成功"，
但**对方看不到画面**。看起来配置成功，实际通话不可用。排查通话问题先查这两个
端口与安全组，再查 Caddyfile。

### 不要在反代层加 CSP

应用用 per-request nonce（`web/lib/csp.ts`）。反代层加固定 CSP 会覆盖 nonce，
导致页面脚本全部被浏览器拦截。加之前先确认 `csp.ts` 的 nonce 传递链。

---

## 10. 排障

| 症状 | 先查 |
|---|---|
| 应用起不来，日志无有用信息 | `docker logs corps-app --tail 50`。多半是 `prisma migrate deploy` 失败（属主连接 `DATABASE_OWNER_URL` 权限不足） |
| 容器反复重启 | `docker inspect --format '{{.RestartCount}}' corps-app`。≥3 次查内存：`docker stats --no-stream corps-app` |
| DB 探测失败（503） | 进容器 `psql` 确认连接串；`CORPS_APP_PASSWORD` 与 `rls-activate.sql` 传入值必须一致 |
| 证书签不出来 | Let's Encrypt 有速率限制（同域每周 5 次）。先确认 `ACME_EMAIL` 有效、DNS 已指向本机 |
| 登录后立刻掉 | `NEXT_PUBLIC_APP_URL` 与 `CORPS_SITE_ADDRESS` 域名不一致（preflight 会拦，但改过之后要重跑） |
| 视频通话只有信令无画面 | 7881/TCP + 50000-50100/UDP 没放通。见 §9 |
| 限流不生效 | 反代是否覆写了 `X-Forwarded-For`。见 §9 |
| 磁盘写满 | 旧容器日志。overlay 已配 `max-size=50m`，但**首次部署前**的容器不受约束，用 `docker system df` 清理 |

---

## 11. 目录结构

```
deploy/
├── Caddyfile                    # 全局块 + import
├── Caddyfile.d/
│   ├── 00-global.env            # 公共 snippet：响应头、proxy_to_app
│   ├── 10-app.conf              # 主应用站点
│   └── 20-livekit.conf          # LiveKit 信令站点
├── docker-compose.prod.yml      # 生产 overlay（叠加在根 compose 上，不复制）
├── .env.prod.example            # 生产变量模板（无真值密钥）
├── VERSION                      # 当前已部署版本（deploy.sh 自动写）
├── VERSION.previous             # 上一个版本（deploy.sh 自动写，rollback.sh 消费）
└── scripts/
    ├── lib/common.sh            # 公共库：严格模式、路径、compose 封装、健康轮询
    ├── preflight.sh             # 部署前置校验（12 组断言）
    ├── deploy.sh                # 一键升级（失败自动回滚）
    ├── rollback.sh              # 一键回滚到上一个已验证 tag
    ├── restore.sh               # 数据库恢复（默认只恢复临时库）
    └── healthcheck.sh           # 深度健康检查（轮询，不 sleep）
```

**为什么用 overlay 而不是复制一份生产 compose**：根 `docker-compose.yml` 是开发/
自部署的单一事实源。复制一份会立刻产生双份漂移——改一处忘另一处，现场表现是
"开发好好的，生产起不来"。overlay 只声明**生产差异**，其余自动继承。

---

## 12. 本包未覆盖的

诚实列出，避免误以为覆盖了：

- **无监控告警接入**。`/api/metrics` 已从公网关闭（403），Prometheus 抓取需从
  服务器本机配。错误率/延迟告警未接 Sentry 或 webhook（`.env.prod` 里有位，
  但需自行接）。
- **无 WAF / DDoS 防护**。Cloudflare 免费版或云厂商高防包不在本包范围。
- **无日志集中采集**。日志走 `docker logs` + json-file 轮转（50m × 3），
  未接 ELK/Loki。
- **无异地备份**。备份在**同一台机器的同一个磁盘**上——机器坏或磁盘坏，两者
  一起没。异地备份（同城可用同厂商对象存储）需要另配。
- **无 WAL 归档**，RPO ≈ 24h（见 §7）。
- **多实例水平扩容**未覆盖。`REDIS_URL` 已共享计数，compose 也支持多副本，
  但 Caddy 的 upstream 需从服务名改为负载均衡，未验证。
- **本机未验证的部分**见提交说明与 ADR-012 的"未验证项"一节——
  本包在开发机上做过语法与逻辑自检，但 TLS 签发、真实 GHCR 拉取、
  RTC 媒体连通性均未在真实 VPS 上跑过。
