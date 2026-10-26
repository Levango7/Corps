# 内部 SLI 口径与现状

> 维护者必读：本文**不是 SLO**，也不构成任何对外承诺。路线图 §5 负面清单写明
> 「无正式实例时不对外承诺 SLO」，本文只做一件事——把我们**现在能测什么、怎么算**
> 钉成可核对的口径，好让将来真要谈目标值时，用的是同一套定义而不是现场拍脑袋。

---

## 0. 这份文档是什么 / 不是什么

| | 内容 |
|---|---|
| **是** | 内部可观测口径定义：信号清单、SLI 计算式、数据源、当前可得性、已知盲区 |
| **不是** | 对外 SLO。全文**不设任何目标值**（无 99.9%、无 p95 < X ms），阈值列一律「未设定」 |
| **为什么现在写** | RED 三维已部分落地：Errors 全路由接通（`instrumentation.ts` 的 `onRequestError`），Rate/Duration 首批接线 6 文件 15 个 handler（2026-10-26）。`/api/metrics` 已经能吐出逐路由序列，此时不定口径，等数据来了就会变成"看着数字调阈值" |
| **将来怎么升级成 SLO** | 见 §4 的前置条件；满足后回路线图 §5 复议那条负面清单，**不是本文自己能解除的** |

判据来源（都可复跑，不靠记忆）：

- `web/lib/red-metrics.ts`（桶边界、标签规范化、基数上限）
- `web/app/api/metrics/route.ts`（序列名与接线现状注释）
- `web/app/api/health/route.ts`（真实 DB 探测 + 2s 超时）
- `.github/workflows/smoke.yml`（探测节奏与"别按 cron 字面理解"的实测结论）
- `scripts/score_maturity.py` 的 `observability-5/6`（按生产代码里 `withRed(` 调用点计数）

---

## 1. 数据源清单（逐项可核对）

| 信号 | 载体 / 序列 | 口径 | 当前状态 |
|---|---|---|---|
| 进程存活时长 | `corps_uptime_seconds` | gauge，进程运行秒数 | 可用（进程重启即归零） |
| 内存 | `corps_memory_rss_bytes`、`corps_memory_heap_used_bytes` | gauge | 可用 |
| 运行时版本 | `corps_node_version` | info | 可用 |
| 逐路由请求数（RED-R） | `corps_http_requests_total{route}` | counter，**仅 `withRed()` 包装过的 handler 会计数** | 部分可用：15 / 292 个路由文件 |
| 逐路由错误数（RED-E） | `corps_http_request_errors_total{route}` | counter，来自 `onRequestError` | 全路由可用（与上面**不同源**，见 §3） |
| 逐路由耗时（RED-D） | `corps_http_request_duration_ms{route}` | histogram，桶边界 1/5/25/100/500/2500/10000 ms + `+Inf` | 部分可用，与 RED-R 同源同范围 |
| 实例健康（含 DB） | `/api/health` → `{status, db, uptimeSec}` | 真实执行 `SELECT 1`，与 2s 超时赛跑；超时/失败判 `degraded` | 可用 |
| 外部探活 | `.github/workflows/smoke.yml` | `SMOKE_TARGET_URL=https://corps-five.vercel.app`（2026-10-22 起设置） | 可用，但**节奏不是 15 分钟**，见 §3 |
| 前端/服务端错误上报 | `web/lib/observability.ts` | 错误事件上报 | 可用（不进 `/api/metrics`，与 RED-E 不是同一条链路） |

明确**不计入** SLI 的信号：CI 的 e2e / 集成测试、本地 `db/rls-smoke.sh`。它们是发布门禁，
不是生产观测；把它们算进可用率等于用"构建产物能不能跑"冒充"线上是否可用"。

---

## 2. SLI 定义（只给计算式，不给目标值）

记法按 Prometheus。所有窗口值都是**占位**，不是承诺——窗口长度本身也要等抓取留存建起来才有意义。

| 编号 | 名称 | 计算式 | 数据源 | 阈值 |
|---|---|---|---|---|
| SLI-1 | 逐路由错误率 | `sum(rate(corps_http_request_errors_total{route="<r>"}[5m])) / sum(rate(corps_http_requests_total{route="<r>"}[5m]))` | RED-E / RED-R | 未设定 |
| SLI-2 | 逐路由延迟分位 | `histogram_quantile(0.95, sum by (le) (rate(corps_http_request_duration_ms_bucket{route="<r>"}[5m])))` | RED-D | 未设定 |
| SLI-3 | 健康探测成功率 | smoke 成功次数 / 总次数（按运行记录统计） | smoke 工作流 | 未设定 |
| SLI-4 | DB 可达率 | `/api/health` 返回 `db:"up"` 的比例 | `/api/health` | 未设定 |
| SLI-5 | 进程稳定性 | `corps_uptime_seconds` 非预期跌落次数（重启 / crash loop） | `/api/metrics` | 未设定 |

术语对齐：SLI 是**指标本身**（怎么量），SLO 是**目标值**（要量到多少）。本文只有前者。

---

## 3. 已知盲区（别把"没数据"读成"健康"）

这几条是当前口径的真正边界，写下来是为了不让半年后的自己误读仪表盘：

1. **RED-R / RED-D 只覆盖 15 / 292 个路由文件**（contacts、contact-groups、announcements、
   activity 四域）。未接线路由**不出现在指标里**——不是"零错误"，是"没测到"。
2. **RED-E 与 RED-R/D 分母不同源**：错误数来自 `onRequestError`（全路由），请求数与耗时来自
   `withRed()`（部分路由）。因此**错误率只能在已接线路由上算**；拿全路由错误数去除以
   已接线路由的请求数，会把错误率系统性放大，得出一个看起来很糟但不存在的故障。
3. **指标是进程内内存态**：`registry` 是模块级 `Map`，进程重启归零、多副本之间不聚合、
   没有外部抓取留存。结论：**任何长于进程生命周期的窗口（30 天可用率）目前算不出来**，
   `/api/metrics` 只能回答"此刻这一个进程"。
4. **探活节奏被高估**：smoke 的 `cron: "*/15"` 是**请求**节奏，本仓 schedule 实测相邻间隔
   1–5.5 小时（GitHub 对 schedule 会延迟/丢弃，低活跃仓库更明显）。它是"每天几次的兜底探活"，
   **不是分钟级监控**，分钟级故障大概率落在两次探测之间。要分钟级只能接外部 uptime 服务。
5. **标签基数有上限**：`MAX_ROUTES = 500`，超限后新路由**不再登记**（静默丢指标）。路由标签
   已用模式（`[id]`）折叠，但域扩张时这条仍会咬人。
6. **耗时桶上限 10s**：超过 10 秒的请求全落进 `+Inf`，分位数在这个桶里会被平滑掉——
   "p95 正常"不等于"没有超慢请求"。

---

## 4. 何时才能谈 SLO（阈值的前置条件）

按顺序，缺一条就不该写目标值：

1. **有正式实例**，且不是"构建产物被 smoke 探一下"的那种。
2. **外部抓取 + 长期留存**（Prometheus 或托管方案）连续跑够一个完整窗口（建议 ≥30 天）。
   在此之前任何 99.9% 都是凭空写的。
3. **关键域路由全部 `withRed()` 接线**。进度可以用评分器 `observability-5/6` 的调用点数看，
   但注意那是**调用点数不是覆盖度**——同一个域多包几个 handler 数字也会涨。
4. **分钟级外部探活**就位，补上 §3.4 的采样缺口。
5. 满足以上之后，**回到路线图 §5 复议**「无正式实例时不对外承诺 SLO」这一条；
   阈值与目标值写在复议结论里，不在本文。

---

## 5. 维护约定

- 口径变了（桶边界、标签规范化规则、新增/改名序列、`MAX_ROUTES`）必须**同提交改本文**，
  否则 §1 与 §2 会变成一份骗人的说明书。
- `withRed()` 按目录分批推进时**不需要**改本文（进度看代码即可）；但**阈值一旦写进 §2**，
  就必须同时处理路线图 §5 那条负面清单——两者不一致比两者都缺更糟。
- 评分器 `observability-7` 只判「是否存在文件名含 SLO/SLI/可观测 的文档」，
  **它读不懂本文内容**。本文存在 ≠ 口径正确，这条局限留在这里以免有人拿评分当质量证明。

---

## 附：本文数字的复核命令

```bash
# 路由文件总数 / 已接线 handler 数（应为 292 / 15）
find web/app/api -name "route.ts" | wc -l
grep -rn "withRed(" web/app --include=*.ts | grep -v "\*" | wc -l

# smoke 实际节奏（别信 cron 字面值）
gh run list --workflow=smoke.yml --limit 20 --json event,createdAt

# 监控目标是否配置
gh variable list
```
