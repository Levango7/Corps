# Corps 零付费分钟级监控设计（已作废）

> **2026-11-27 校正**：用户复核后裁定回到 2026-11-12 已关闭裁决——#50 走外部 uptime（UptimeRobot 类，免费档 3–5 分钟级）。本规格归档作废，不进入实现。留档价值仅限方案比较与 Cloudflare 免费额度事实；落地口径以 `docs/runbook-monitoring.md` §4.2 为准。

- 日期：2026-11-27
- 范围：独立 Cloudflare Worker 拨测、D1 历史留存、公开状态页与可选 webhook 告警
- 方案状态：作废
- 不包含：修改 Corps 业务数据库、修改应用健康端点、购买域名、部署到 Cloudflare

## 1. 目标与判据

实现一个不依赖自有域名、不依赖付费服务的分钟级外部拨测层。

验收判据：

1. Cloudflare Worker 使用 `* * * * *` Cron Trigger，每分钟调用一次。
2. 目标地址只来自显式配置 `CORPS_WEB_URL`；缺失、非法或含凭据时明确失败，不写死任何生产别名。
3. 每次探测只发送无凭据的 `GET <CORPS_WEB_URL>/api/health`，并校验 HTTP 200、`data.status == "ok"`、`data.db == "up"`。
4. 探测结果写入独立 D1 数据库；不连接、不写入 Corps 的业务 PostgreSQL。
5. 最新一次成功探测超过 180 秒后，状态页必须显示 `stale`，不能继续显示绿色。
6. 展示“已观测成功率”和“采样覆盖率”，不把二者称为历史可用率或 SLO。
7. 告警按状态转换去重：故障开始一次、持续故障每 15 分钟一次、恢复一次。
8. 默认保留 90 天；超过保留期的数据由 Worker 定期删除。
9. 本地测试覆盖正常、目标故障、配置缺失、陈旧数据、存储失败、告警去重与恢复；部署后再做真实 Cron 验收。

## 2. 非目标

- 不替代现有容器 `HEALTHCHECK`、部署脚本本地健康检查或 GitHub Smoke。
- 不承诺 GitHub Actions schedule 的分钟级能力；它继续作为小时级兜底与邮件告警通道。
- 不修改 Caddy 对公网 `/api/health` 的 403 规则。Worker 的目标必须是已经允许公网访问健康端点的部署实例。
- 不采集业务数据、用户身份、请求头、cookie、Authorization 或原始健康响应正文。
- 不在本批创建 Cloudflare 账号、D1、Worker 或 webhook；云上写操作在代码合并后单独授权执行。

## 3. 已核实的现状

- `web/app/api/health/route.ts` 会执行真实 `SELECT 1`，成功返回 `data.status="ok"`、`data.db="up"`，失败返回 503 与降级状态。
- `web/Dockerfile` 的容器健康检查间隔为 15 秒；部署与回滚脚本会做本地健康轮询。
- `.github/workflows/smoke.yml` 字面为 `*/15`，但仓库文档记录的实测相邻间隔为 1–5.5 小时，因此不能作为分钟级承诺。
- `deploy/Caddyfile.d/10-app.conf` 对公网 `/api/health` 与 `/api/metrics` 返回 403，外部拨测不能直接指向该入口。
- Cloudflare Workers Free 支持每分钟 Cron；D1 Free 额度足以承载每分钟一条记录和 90 天留存。
- Cloudflare Worker 默认提供 `workers.dev` 地址，不要求自有域名。

## 4. 方案比较与选择

| 方案                   |                    时间粒度 | 新增账户         | 主要限制                                      | 结论                             |
| ---------------------- | --------------------------: | ---------------- | --------------------------------------------- | -------------------------------- |
| Cloudflare Worker + D1 |                      1 分钟 | Cloudflare 账号  | 需要一次部署授权；状态历史需自行实现          | 采用                             |
| UptimeRobot 免费档     |                    3–5 分钟 | UptimeRobot 账号 | 开户与目标配置由 owner 完成；历史查询能力较弱 | 作为人工备选，不纳入本批         |
| GitHub Actions 5 分钟  | 请求 5 分钟，实测可能小时级 | 无               | 不能诚实承诺分钟级                            | 保留现有 Smoke，不作为本方案时钟 |

选择 Cloudflare 的依据是：唯一能在零付费、无自有域名条件下提供真实分钟级 Cron 的候选，同时免费额度覆盖单目标监控。

## 5. 架构

### 5.1 组件边界

新增 `monitoring/worker/`：

- `src/probe.ts`：校验目标 URL、执行单次探测、分类结果。
- `src/store.ts`：封装 D1 读取、写入、告警状态和保留期清理。
- `src/alerts.ts`：发送可选 webhook，生成脱敏告警正文。
- `src/status.ts`：生成 `/status.json` 与 `/` HTML。
- `src/index.ts`：Worker 入口，只负责路由和 Cron 编排。
- `schema.sql`：D1 表与索引。
- `wrangler.toml.example`：不含账号、数据库 ID 或真实目标的部署模板。
- `package.json`、`tsconfig.json`、Vitest 测试与本地校验脚本。

更新：

- `docs/runbook-monitoring.md`：增加 Cloudflare 分钟级层的启用、验证、故障分型和回滚说明。
- `.gitignore`：忽略本机 `wrangler.toml`、`.dev.vars`、`.wrangler/` 等含环境信息的产物。

现有 `.github/workflows/smoke.yml` 不在本批改变行为。

### 5.2 Worker 接口

`Env` 只包含：

- `MONITOR_DB: D1Database`：独立监控数据库绑定。
- `CORPS_WEB_URL?: string`：必填目标根地址；缺失即失败。
- `CORPS_ALERT_WEBHOOK_URL?: string`：可选告警地址；缺失时状态页明确显示 `alerting=disabled`。

固定行为不增加环境旋钮：超时 8 秒、响应上限 64 KiB、陈旧阈值 180 秒、故障提醒间隔 900 秒、保留期 90 天。

### 5.3 HTTP 路由

- `GET /`：返回无 JavaScript 依赖的 HTML 状态页。
- `GET /status.json`：返回同一份状态的 JSON，供自动化读取。
- 其他路径返回 404。

状态响应设置 `Cache-Control: no-store`、`Content-Type` 与基础安全头。页面只显示目标 hostname，不显示 URL 路径、查询参数或任何密钥。

## 6. 数据模型

### 6.1 `health_checks`

| 字段            | 类型                              | 含义                       |
| --------------- | --------------------------------- | -------------------------- |
| `id`            | INTEGER PRIMARY KEY AUTOINCREMENT | 记录 ID                    |
| `checked_at`    | INTEGER NOT NULL                  | Cron 计划时间，Unix 秒     |
| `ok`            | INTEGER NOT NULL，取值 0/1        | 目标健康判定               |
| `http_status`   | INTEGER NULL                      | 目标 HTTP 状态             |
| `latency_ms`    | INTEGER NULL                      | 探测耗时                   |
| `app_status`    | TEXT NULL                         | 健康响应中的 `data.status` |
| `db_status`     | TEXT NULL                         | 健康响应中的 `data.db`     |
| `error_kind`    | TEXT NULL                         | 失败分类                   |
| `error_message` | TEXT NULL                         | 最长 512 字符的脱敏说明    |

`checked_at` 建索引。数据库不保存原始响应正文、请求头或完整目标 URL。

### 6.2 `monitor_state`

单行状态表，保存：

- `incident_open`：是否处于未恢复故障。
- `pending_alert_event`：待投递事件；仅取 `incident_open`、`incident_reminder`、`incident_resolved` 或空值。
- `pending_alert_at`：待投递事件对应的原始 `checked_at`，重试时保持不变。
- `last_alert_at`：最近一次告警尝试时间。
- `last_alert_error`：最近一次告警投递错误。
- `last_change_at`：最近一次故障/恢复转换时间。
- `last_cleanup_at`：最近一次保留期清理时间。

## 7. 探测与数据流

1. Cron 触发时读取 `event.scheduledTime` 作为本次 `checked_at`。
2. 校验 `MONITOR_DB` 与 `CORPS_WEB_URL`；配置缺失时抛出错误并记录结构化日志。
3. 使用 `redirect: "error"` 发起 GET，禁止重定向，不转发 cookie 或认证头。
4. 使用 8 秒超时；响应正文最多读取 64 KiB。
5. 成功必须同时满足：HTTP 200、JSON 可解析、`data.status == "ok"`、`data.db == "up"`。
6. 将结果写入 `health_checks`，并原子更新 `monitor_state`；发生故障/恢复转换或到提醒时间时，同时写入 `pending_alert_event` 与本次 `pending_alert_at`。
7. 若配置了 webhook 且存在待投递事件，则发送该事件；成功后清空 `pending_alert_event` 与 `pending_alert_at` 并记录投递时间，失败则保留待投递事件、原始时间与错误说明。
8. 距上次清理至少 1 小时时，删除 `checked_at` 早于 90 天前的记录。

目标探测失败与监控自身失败必须分开：

- 目标失败仍写入 `health_checks(ok=0)`。
- D1 不可用、配置非法等监控自身失败不伪造目标结果；本次 Cron 失败并在 Cloudflare Logs 中可见。

## 8. 失败分类

| 分类               | 触发条件             | 展示                           |
| ------------------ | -------------------- | ------------------------------ |
| `config_error`     | URL 缺失或非法       | Cron 失败；状态接口 503        |
| `dns_error`        | DNS 解析失败         | `down`，展示分类               |
| `connect_error`    | 连接失败或被拒绝     | `down`，展示分类               |
| `timeout`          | 超过 8 秒            | `down`，展示分类               |
| `tls_error`        | TLS 失败             | `down`，展示分类               |
| `redirect_blocked` | 目标返回重定向       | `down`，展示分类               |
| `http_error`       | HTTP 非 200          | `down`，展示状态码             |
| `invalid_json`     | 响应不是合法 JSON    | `down`，展示分类               |
| `invalid_payload`  | 缺少或错误的关键字段 | `down`，展示分类               |
| `storage_error`    | D1 读写失败          | 状态接口 503；Cron 失败        |
| `alert_error`      | webhook 投递失败     | 目标结果不变；展示最近投递错误 |

错误说明只保存有限长度的通用文本，不保存完整响应、堆栈或密钥。

## 9. 告警语义

未配置 webhook 时：

- 探测与历史记录继续工作。
- `/` 与 `/status.json` 明确显示 `alerting.enabled=false`。
- 状态转换仍可留下待投递事件；配置 webhook 后按原始 `pending_alert_at` 补投。
- 不使用“全部正常”掩盖告警缺位。

配置 webhook 后：

- 首次失败：写入待投递事件 `incident_open`。
- 持续失败：距上次告警尝试至少 900 秒时写入待投递事件 `incident_reminder`。
- 恢复：写入待投递事件 `incident_resolved`。
- 待投递事件在发送成功后才清除；失败时保留到下一次 Cron 重试，同时记录 `last_alert_error`。
- 告警投递失败不回滚目标探测结果；语义为至少一次投递，webhook 消费方应按 `event + checkedAt` 去重。

webhook 使用 JSON POST，字段为 `event`、`state`、`targetHost`、`checkedAt`、`httpStatus`、`latencyMs`、`errorKind`、`statusUrl`。`statusUrl` 使用当前请求 origin，不硬编码 Worker 别名。

## 10. 状态页与指标口径

当前状态按以下优先级计算：

1. 配置或存储不可用：`monitor_error`。
2. 没有任何记录：`unknown`。
3. 最新记录时间早于当前时间 180 秒：`stale`。
4. 最新记录 `ok=1`：`up`。
5. 最新记录 `ok=0`：`down`。

最近 24 小时展示：

- `observedCount`：实际写入的探测记录数。
- `successCount`：其中成功的记录数。
- `observedSuccessRate = successCount / observedCount`：仅描述已观测样本。
- `coverageRate = min(1, observedCount / 1440)`：描述分钟级采样覆盖，不用于计算业务可用率。
- 最近 20 条探测的 UTC 时间、状态、延迟与错误分类。

`observedCount=0` 时成功率为 `null`，不显示 100%。

## 11. 安全边界

- `CORPS_WEB_URL` 只允许 HTTPS，禁止用户名、密码、查询参数和 fragment；仅允许默认 443 端口。
- 拒绝 localhost、私网/链路本地 IP 字面量、`.local` 主机名和云元数据主机名。
- 禁止重定向，避免通过重定向绕过目标校验。
- 不向目标发送 cookie、Authorization 或任何业务凭据。
- 响应大小与错误文本设上限；状态页不输出环境变量、D1 ID、webhook 地址或原始响应。
- D1 是新的监控数据库，与 Corps 业务数据库无连接、无共享写入路径。
- Cloudflare 凭据、D1 ID 和真实目标只保存在本机未跟踪配置或 Cloudflare Secret 中。

## 12. 测试设计

### 12.1 单元测试

- URL 校验：HTTPS、默认端口、无凭据、无查询/fragment、私网与元数据地址拒绝。
- 探测：200 健康、HTTP 非 200、超时、DNS/连接/TLS、重定向、非法 JSON、字段缺失、响应超限。
- D1：写入结构、状态转换、提醒间隔、恢复、90 天清理。
- 告警：首次/重复/恢复、webhook 缺失、投递失败后的重试复用原始时间、正文不含目标凭据。
- 状态：`up/down/stale/unknown/monitor_error`、零样本成功率、覆盖率上限、无缓存头。

### 12.2 本地集成

- 使用本地模拟 HTTP 目标与 D1 测试接口驱动真实 Worker 处理函数。
- 验证连续两次失败只发送一次首报，跨过 900 秒才发送提醒，恢复只发送一次。
- 验证旧成功记录在 180 秒后显示 `stale`。
- 使用 `wrangler deploy --dry-run` 校验最终配置和绑定形状。

### 12.3 射程证明

对以下判据做窄变异并确认测试先红后绿：

- 删除 180 秒陈旧判定，`stale` 用例必须失败。
- 删除持续故障 900 秒间隔，提醒去重用例必须失败。
- 允许非 HTTPS，安全用例必须失败。
- 将零样本成功率写成 100%，空历史用例必须失败。

## 13. 部署与真实验收

代码合并不自动部署。部署需要用户另行提供 Cloudflare 登录/令牌授权。

部署顺序：

1. 使用 `wrangler login` 或环境中的 `CLOUDFLARE_API_TOKEN` 认证。
2. 创建独立 D1 数据库 `corps-monitor`。
3. 将 `wrangler.toml.example` 复制为本机 `wrangler.toml`，填入数据库 ID；实际文件不提交。
4. 远程执行 `schema.sql`。
5. 设置 Secret `CORPS_WEB_URL`；可选设置 `CORPS_ALERT_WEBHOOK_URL`。
6. 部署 Worker，确认 Cron 为 `* * * * *`。
7. 记录部署后的 `workers.dev` 地址；不在仓库写死该地址。
8. 等待至少两个 Cron 周期，核对 D1 有相邻分钟记录，且 `/status.json` 的 `stale=false`。
9. 用受控非生产目标验证失败、告警去重、恢复和陈旧判定，再切回真实目标。

只有第 8、9 步通过，才可宣称“线上分钟级监控已生效”。

## 14. 回滚

- 应用代码回滚：重新部署上一个已验证版本，不删除 D1 历史。
- 停止拨测：在 Cloudflare 暂停 Worker 或移除 Cron Trigger；状态页保留最后记录并最终进入 `stale`。
- 删除 Worker/D1：不在自动收尾中执行，需要用户单独确认，因为会丢失监控历史。

## 15. 免费额度估算

单目标每分钟一次：

- Cron 调用约 1,440 次/天，目标 GET 约 1,440 次/天，加状态页访问仍远低于 Workers Free 的 100,000 次请求/天。
- 每天约 1,440 条插入；计入状态更新、索引和清理删除后仍远低于 D1 Free 的 100,000 行写入/天。
- 90 天约 129,600 条记录；按每行不足 1 KiB 的保守估计，加索引后远低于 5 GB。

免费额度与平台限制会在部署时再次核对，不以本估算替代平台当前条款。

## 16. 最终验收清单

- [ ] 用户复核本设计规格。
- [ ] 独立分支、独立 PR，未读取真 `.env`，未写 Corps 共享/远端数据库。
- [ ] 本地测试、静态检查、Wrangler dry-run 全绿。
- [ ] required 15/15、`MERGEABLE`、`CLEAN`、`base==main tip` 后合并。
- [ ] main 首验全绿并完成 scope 审计。
- [ ] Cloudflare 部署获单独授权，真实 Cron 与告警链验收通过。
- [ ] 台账 #50 仅在上述条件齐备后销号。
