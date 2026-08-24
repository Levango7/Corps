# corps 监控手册（Runbook）

> 基于仓库现状整理：`docker-compose.yml`（HEALTHCHECK）、`.github/workflows/ci.yml`
> （e2e job）、`.github/workflows/smoke.yml`（定时探测）、`web/app/api/health/route.ts`
> （真实 DB 探测 + uptimeSec）、`docs/runbook-deploy.md` §4（回滚）。
> 更新日期：2026-08-24。

---

## 1. 分层监控现状

| 层 | 载体 | 探测内容 | 周期/时机 | 失败后果 |
|---|---|---|---|---|
| 容器 HEALTHCHECK | `docker-compose.yml` app 服务：`wget --spider http://127.0.0.1:3000/api/health`，interval 15s / timeout 5s / retries 5 / start_period 40s | `/api/health` HTTP 状态（内部真实执行 `SELECT 1`，2s 超时） | 每 15 秒连续 5 次失败判 unhealthy | 容器状态标记 unhealthy（编排平台可据此重启；compose 本身不自动重启） |
| CI e2e | `.github/workflows/ci.yml` 的 `e2e` job：`next build` → `next start -p 3000` → 轮询 `/api/health`（最多 ~60s）→ vitest 集成测试打生产构建产物 | 生产构建可启动、健康检查可达、18 条集成用例全过 | 每次 push/PR 到 main | PR 不能合入、main 变红 |
| 定时 smoke | `.github/workflows/smoke.yml`：GET `$SMOKE_TARGET_URL/api/health`，校验 HTTP 200 且 `data.status=="ok"` && `data.db=="up"` | 线上应用存活 + 数据库可达 | 每 15 分钟（cron `*/15 * * * *`）；未配置 `vars.SMOKE_TARGET_URL` 时整 job 跳过 | job 失败 → GitHub 默认邮件告警 |
| GitHub 告警邮件 | Actions 默认通知机制（Settings → Notifications） | smoke / CI 任一 workflow 失败即触发 | 失败即时 | 邮件通知 watch 用户与触发者 |

健康检查端点说明（`web/app/api/health/route.ts`）：成功返回
`{ code:200, data:{ status:"ok", db:"up", uptimeSec } }`；
DB 探测失败返回 503 `{ data:{ status:"degraded", db:"down" } }`。
`uptimeSec` 为进程运行秒数——若告警时观察到它反复归零，说明进程在频繁重启
（OOM / 崩溃循环），而非单纯接口抖动。

## 2. CloudBase 控制台告警策略建议

在 CloudBase 控制台（云托管实例监控）按以下阈值配置告警，作为 smoke（15 分钟粒度）
之外的低延迟补充：

| 指标 | 建议阈值 | 说明 |
|---|---|---|
| CPU 使用率 | 持续 > 80%（5 分钟窗口）告警；> 95% 升级为严重 | Next.js 正常水位较低，80% 已属异常 |
| 内存使用率 | 持续 > 85% 告警 | 容器 OOM 会直接杀进程，uptimeSec 归零是佐证 |
| 5xx 错误率 | > 2%（5 分钟窗口）告警；> 10% 严重 | 对应 `/api/v1/*` 的 code≥500 与网关 502/503 |
| 实例存活数 | < 期望副本数持续 3 分钟告警 | 多实例部署时防单点静默掉线 |

## 3. 日志排查入口

| 入口 | 用途 |
|---|---|
| `docker logs corps-app --tail 200`（或 CloudBase 控制台实例日志） | 应用运行日志：`[rate-limit] Redis … 降级`、`[GET /api/health] database probe failed`、Prisma 报错等关键行可直接定位故障层 |
| `docker logs corps-db --tail 100` | 数据库侧：连接数耗尽、慢查询、重启记录 |
| GitHub Actions（仓库 Actions 页 → Smoke / E2E (production build)） | smoke 失败的具体校验点（HTTP 非 200 还是 db=down）；e2e 失败的构建/测试日志 |
| CloudBase 日志服务 | 托管部署后的集中式检索入口（容器 stdout/stderr 自动采集），支持按时间与关键词过滤 |

## 4. 升级路径（当前不引入，按需选型）

- **Sentry**：出现线上 JS/服务端异常难复现、需要堆栈与 source map 定位时接入（错误追踪首选）。
- **UptimeRobot**：需要分钟级外部拨测、比 GitHub cron 更细粒度且不想维护 workflow 时接入（最轻量拨测）。
- **Prometheus**：多实例部署、需要 RED 指标（速率/错误/耗时）与长期趋势图时接入（自建指标栈，运维成本最高）。
一句话建议：先 Sentry（补异常可见性）→ 再 UptimeRobot（加密拨测频率）→ 实例数 ≥ 3 或有 SLA 时才上 Prometheus。

## 5. Smoke 告警处置流程

1. **确认告警**：GitHub 邮件/Actions 页查看失败 step 输出，区分两种失败：
   - `HTTP 非 200`：应用层问题（app down / 5xx）；
   - `data.db=down`（HTTP 可能仍为 503）：数据库不可达。
2. **本机复核**：
   ```bash
   curl -s http://<host>:3000/api/health   # 观察 status/db/uptimeSec
   ```
   - `db: down` → 按数据库路径处理：查 `docker logs corps-db`；若是刚发布后出现，
     多半是迁移失败，按 `docs/runbook-deploy.md` §4.2 执行 down 迁移 SQL 或从备份恢复 DB。
   - `status: ok` 但 uptimeSec 很小且反复归零 → 进程崩溃循环，查应用日志找 OOM/未捕获异常。
   - 连接超时/非 200 → app down：按 `docs/runbook-deploy.md` §4.1 将镜像 tag 回退到上一个已验证版本并重启实例。
3. **恢复验证**：处置完成后再次 `curl /api/health`，并等待下一个 smoke 周期
   （≤15 分钟）转绿；也可在 Actions 页对 smoke 工作流手动 Run workflow（workflow_dispatch）即时复核。
