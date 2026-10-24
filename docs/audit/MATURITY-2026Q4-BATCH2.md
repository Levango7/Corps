# 2026Q4 第二批 · 四处缺口清偿对账报告

- 批次窗口：**`a818303`（10-25 04:00）→ `b93d9d1`（10-25 05:45）**
- 生成工具：`scripts/score_maturity.py`
- 基线：`scripts/maturity-baseline.json`（棘轮口径，CI 强制）
- 上一批报告：`MATURITY-2026Q4-BATCH1.md`

---

## 1. 用户批示与本批范围

第一批收官时留了三个待拍板项，用户批示 **"做做吧 12 解决一下"**，即：

1. **收四处缺口**（`.gitignore` / `db/schema.sql` / 按路由 RED 指标 / OpenAPI 契约清偿）
2. **评分器进 CI**

两项都在本批完成。第 3 项（买 VPS + 域名、ICP 备案）不在我手上，仍未动。

---

## 2. 四处缺口逐条对账

| # | 缺口 | 动作 | 结果 |
|---|---|---|---|
| 1 | `.gitignore` 只忽略裸 `.env`，`.env.prod` 变体漏网 | 改 `.env*` + `!.env.example` | ✅ 已堵。实测三类行为：三个已入库 `.example` 模板仍可见、根 `.env.prod` 被 `git check-ignore` 命中、`git status` 无异常 |
| 2 | `db/schema.sql` 落后最新迁移 1 个，且无门禁看守 | 刷新快照 + 新增陈旧门禁 | ✅ 已修。见 §3 |
| 3 | 无按路由 RED 指标 | 接通 **Errors** 一维，Rate/Duration **未接且未假装接** | ⚠️ 部分。见 §4 |
| 4 | OpenAPI 契约覆盖率 30.4%，自述数字漂移 8 | 清偿 5 条 + 修自述漂移 | ⚠️ 部分。见 §5 |

---

## 3. schema.sql：这不是"重新 dump"那么简单

**第一反应是错的。** 本机 `corps` 库**本身也是旧的** —— 最新已应用迁移同样是
`20261019000000_add_user_locale`，同样缺 `20261022000000_add_workspace_settings`。
直接 pg_dump 会把陈旧**洗成"已刷新"**，比不刷新更坏。

实际做法：建一次性临时库 → 灌入现有 schema.sql → 应用那条待应用迁移 →
只 pg_dump `workspaces` 一张表 → 把权威 DDL 拼回去 → 删临时库。

**没有全量重 dump**：实测 pg_dump 重新序列化会改写 CHECK 约束的书写形式
（`(ARRAY[...])::text[]` → `ARRAY[(...)::text, ...]`，语义不变），全量替换会
产生大量无关 diff。最终 diff **只有 3 增 2 删**（2 行头 + 1 行 `settings` 列），
新增行与 pg_dump 权威产物逐字相同。

新增 `scripts/check_schema_snapshot_freshness.py`：判据是快照头部声明的
「对应迁移」必须等于 `web/prisma/migrations/` 下最新目录。原来的
`check_schema_migration_drift.py` 只管 Prisma schema ↔ migrations，**不覆盖这份快照**，
所以陈旧时 CI 全绿 —— 这是第一批实测发现的真实盲区。自带 5 条注入式自测。

---

## 4. RED 指标：只接通了能诚实接通的那一维

新增 `web/lib/red-metrics.ts`，并在 `instrumentation.ts` 的 `onRequestError`
钩子上接通 **Errors**。`/api/metrics` 现在能吐出
`corps_http_request_errors_total{route="..."}`。

**Rate 与 Duration 两维没有接，也没有假装接。** 两个候选接入点都评估过并否决：

| 方案 | 否决理由 |
|---|---|
| middleware 里记 Rate | middleware 跑在 **Edge runtime**，是独立 isolate，模块级状态与 Node runtime 的 `/api/metrics` **不共享**。在 middleware 里记数，指标在端点里一个都看不到 —— 等于接一条假线，比不接更坏 |
| 逐路由包装器拿 Duration | App Router 没有暴露"路由处理器执行完毕"的全局钩子。`withRed()` 已写好，但套一两个路由覆盖率只有 0.3%，指标存在却基本是空的，属于自欺 |

**评分器随之把这一项拆成三根**（Errors / Rate / Duration 分别判）。
**可观测性综合分因此从 8.33 微降到 8.12** —— 这不是退步，是测量变细后暴露出
两维没接。诚实的分数比好看的分数有价值。

测试 `web/tests/unit/red-metrics.test.ts` 15 例，其中 3 例**直接打 GET 处理器**
断言响应体里真的出现 RED series —— 证明的是接线，不是模块行为。

---

## 5. OpenAPI：清偿 5 条 + 修掉自述漂移

声明 `/api/v1/ai/agents`（GET/POST）、`/coordinate`、`/{id}`（PATCH/DELETE）、
`/{id}/messages`、`/{id}/respond`，补 `AgentId` 参数与 `RateLimited` 响应组件，
基线 201 → **196**。

**契约内容全部依据 `route.ts` 的文件头注释** —— 那些注释把方法、入参、出参、
限流都写清楚了，所以补齐是**可验证的**而非编造。注释未写明的字段只标
`type: object`，不猜字段名：契约写错比不写更危险，因为它会让人以为已经对齐了。

修掉 `api/openapi.yaml` 第 12 行的自述漂移：`declares 80 paths (2026-09-27)`
→ `declares 93 paths (2026-10-25)`。

**清偿节奏提示**：burndown 计划要求 12-31 前从 205 降到 150，即 10 周清 55 条，
**每周约 5-6 条**。本批清了 5 条，正好是两周的量。剩余 196 条里最大一簇是
`/api/v1/workspaces/{wid}/...`（102 条），模板化程度最高，适合下一批集中打。

---

## 6. 评分器自身被抓出的三个误报

这是本批最有价值的副产品 —— 全是**反向测试**抓出来的，不是读代码看出来的。

| # | 误报 | 症状 | 修法 |
|---|---|---|---|
| 1 | **布尔指标方向写反** | `observability-4` 用默认"越低越好"，于是"接通 Errors"（0→1）被棘轮判成**退步**报红 —— 改进反被门禁挡住 | 显式 `lower_is_better=False` |
| 2 | **接线判据太弱** | 只查"文件里出现过 `recordError` 字样"，而 import 行里也有这个词。反向测试（删掉调用只留 import）照样判 PASS —— **假绿灯** | 剥掉 import/export 行后要求出现真正的调用 `recordError(` |
| 3 | **测试文件算成生产接线** | 第一版把 `red-metrics.test.ts` 里的 5 处 `withRed(` 当成已接线，得出"5 处/目标 1 处"的假绿灯 | 排除 `tests/`、`e2e/`、`__tests__` 与 `.spec.`/`.test.` |
| 4 | **`cicd-7` 判错对象** | `gh run list` 不按工作流过滤，抓到的是**定时 Smoke** 的失败，而 Smoke 不是 required check | 改 `--workflow CI`；并标 `ratchet=False`（它描述远端状态而非仓库内容，会因别人推代码就翻转） |

第 4 条顺带牵出一件真事，见 §8。

---

## 7. 评分结果

计量口径（与棘轮同口径，可跨 commit 对比）：

| 维度 | 批次前 | 批次后 | Δ |
|---|---:|---:|---:|
| 安全 | 8.75 | **10.00** | +1.25 |
| 数据层 | 5.00 | **10.00** | +5.00 |
| API 层 | 5.00 | **6.67** | +1.67 |
| 代码质量 | 10.00 | 10.00 | ±0 |
| 测试 | 7.50 | 7.50 | ±0 |
| CI/CD | 10.00 | 10.00 | ±0 |
| 可观测性 | 8.33 | 8.12 | −0.21（测量拆细，非退步）|
| 文档 | 10.00 | 10.00 | ±0 |
| **综合** | **8.47** | **9.04** | **+0.57**（Silver → Gold）|

> API 层从 5.00 涨到 6.67，主要来自修掉自述漂移（api-5 由 FAIL 转 PASS）。
> **这不是覆盖率的实质提升** —— 契约覆盖率只从 28.3% 走到 30.0%。
> 把"文档说对了"和"活干完了"分开记账，是这份报告该做的事。

---

## 8. 顺带发现的一条真实运维红灯（未处理，需你决策）

排查 `cicd-7` 时发现：**定时 Smoke 工作流失败**，
`https://corps-five.vercel.app/api/health` 返回：

```
HTTP 503  {"code":503,"data":{"status":"degraded","db":"down"},"message":"数据库不可达"}
```

- main 的 **CI 与 Burndown 工作流都是 success**，12 条必需检查全绿 —— 不是代码回归。
- 这是**部署实例的数据库不可达**，属于运维面。Smoke 不是 required check，
  所以它红着也不会拦合并，也就一直没人管。
- 处置流程已在 `docs/runbook-monitoring.md §5`：先 curl `/api/health` 区分
  db down 与 app down，再按 `runbook-deploy.md §4` 回滚 DB 或重启应用。

**这条要你定**：Vercel 预览实例的库为什么挂了（Supabase/Neon 额度？连接串变更？
项目休眠？），是修还是把 Smoke 目标切到本机 compose。我没动它。

---

## 9. 遗留与下一步

| 项 | 状态 |
|---|---|
| RED-Rate / RED-Duration | 包装器已就绪，零调用点。要接通需按目录批量套 `withRed()`，并同步把评分器两项从 WARN 改 PASS |
| OpenAPI 剩余 196 条 | 最大簇 `/api/v1/workspaces/{wid}/...` 102 条，模板化最高，适合下一批 |
| `tests/api` 路由级测试仅 1 个 | 292 个路由对 1 个路由级测试，仍是测试维度的主要短板 |
| SLO/SLI 文档 0 份 | 路线图 §1.5 承诺产出，尚未落地；也是 RED 指标之后顺理成章的下一步 |
| Vercel 预览实例 db down | §8，待你决策 |
| **VPS + 域名 + ICP 备案** | 关键路径，2-4 周。十一月要试用就得现在动手 |
