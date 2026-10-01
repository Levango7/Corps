# corps — 讨论结论自动落位成任务

![CI](https://github.com/Levango7/Corps/actions/workflows/ci.yml/badge.svg)

面向 **5–30 人中小团队**的轻量协作 SaaS：以工作区任务看板为锚点，让每一次讨论的结论自动固化为**决策记录**（版本留痕、双向回链任务）——"为什么这么定"永远可查，不再散落在聊天记录里。

> 15 分钟上手 · 中英双语 · 免费版最多 10 人（非"全功能"，受限项见下方定价行）

---

## 为什么是 corps

小团队的日常：会上结论都说清了，会后还得有人手动把结论搬进任务工具，搬着搬着"为什么这么定"就再也找不到了。约 1/4 的任务因为这个流程断裂而超期。

corps 把这个断点补上：

| 能力 | 说明 |
|---|---|
| **决策记录** | 每条任务可携带"为什么这么定"——markdown + Mermaid 图表（流程图/时序图/思维导图），版本留痕，双向回链 |
| **子任务 + 阻塞** | 大任务拆子任务，父任务看板卡自动显示 done/total 进度条；被依赖卡住的任务标红写原因 |
| **文档中心** | 团队公约 / 新人手册沉淀（与决策正交），支持**公开只读分享链接**——发给客户、外包不用拉进工作区 |
| **任务内轻沟通 IM** | 附件上传、实时推送、已读回执；附件点击直接预览（图片放大 / PDF 内嵌） |
| **一键导出 PDF** | 任务决策记录与文档导出为排版良好的 PDF（打印 CSS 方案，深色主题自动浅色输出） |
| **Markdown 工具栏 + 模板库** | 粗体/表格/代码块一键插入；三个决策模板（方案对比 / 事故复盘 / 立项决议） |
| **中英双语** | 全站 UI 完整双语，`/en` 前缀路由 + 一键切换 |
| **AI 原生能力** | 17 个核心 AI 能力贯穿全流程（续写/摘要/翻译/问答/任务拆解/工作流构建/日报/项目洞察…），多轮对话 + 反馈循环 + 使用量统计，所有建议需用户确认后落位 |

**Free 可用 17 项（22 项功能中：14 项全量 + 3 项受限——≤10 人 / 最近 10 条决策 / 10MB 附件）** · Pro ¥29.9/人/月（年付 ¥299）。逐项 Free/Pro 归属以站内定价页 `web/lib/pricing.ts` 的矩阵为准，本文件不再重复罗列，避免两处口径漂移。

## AI 原生能力

corps 已从"项目管理工具"升级为 **AI 原生办公平台**：17 个核心 AI 能力贯穿讨论→决策→执行全流程，覆盖文档、知识、任务、协作、日程五大域，并以跨能力编排串联复合意图。

| 域 | 能力 |
|---|---|
| **文档** | 续写（completion）· 格式化（format）· 摘要（summarize）· 翻译（translate） |
| **知识** | 智能问答（knowledge-qa）· Wiki 搜索（wiki-search） |
| **任务与工作流** | 任务拆解（task-breakdown）· 工作流构建（workflow-build）· 项目洞察（project-insight）· 日报生成（daily-report） |
| **协作沟通** | IM 回复建议（im-reply）· 公告起草（announcement-draft）· 审批建议（approval-advice）· 会议流程（meeting-flow）· 追问建议（follow-up-suggestions） |
| **日程** | 日程排程（calendar-schedule） |
| **编排** | 跨能力编排（orchestrate）——多能力串联，一次完成复合意图 |

**8 方向深化**：

- **A 上下文聚合**：scope 13 → 20 种，AI 看到的上下文更完整
- **B 执行引擎扩展**：action 3 → 8 种，AI 建议可直接落位为任务/文档/日程等结构化对象
- **C 多轮对话与追问**：上下文内连续对话，追问建议引导深入
- **D 反馈循环**：每条 AI 结果可点赞 / 点踩 / 修正反馈，闭环优化
- **E 流式进度阶段反馈**：长任务分阶段实时回传进度
- **F 跨能力联动**：一次请求可串联多个能力
- **G 使用统计与限额**：Token / 调用次数 / 成本三维计量，按工作区限额
- **H Prompt 工程**：few-shot + 思维链（CoT）+ 输出格式校验，结果更稳更可控

## 工程上的硬承诺

- **租户隔离（双层防御）**：`schema.prisma` 共 99 张表（99 个模型，全部显式 `@@map`，表名不靠猜）。其中 **72 张含 `workspaceId` 的租户表全部启用 `ENABLE + FORCE ROW LEVEL SECURITY` 并配有策略，另有 9 张虽无 `workspaceId` 但也已入引擎层**（`workspaces` 按成员资格、`conversation_members` / `chat_presences` / `message_reads` / `calendar_connections` / `task_calendar_events` / `task_labels` / `push_subscriptions` / `push_tokens` 按用户或成员关系），合计 **81 张受保护、272 条策略**——这 9 张的存在同时说明"按 `app.user_id` 做引擎层判定"的机制在生产里已经在用，不是纸面能力。由 CI 的 `rls-coverage`（租户表 ENABLE + FORCE + 策略三态齐备）、`schema-drift`（schema ↔ 已部署库逐项比对）与 `check_rls_exemptions.py`（**豁免登记表，只允许收缩**）三道门禁守护。

  余下 **18 张未入引擎层**，按成因分四类，处置代价并不相同（详见 `docs/decisions/ADR-010-RLS豁免登记表.md`）：**P · 有租户父级 10 张**（`ai_messages`、`assistant_messages`、`database_fields`/`database_records`/`database_views`、`decision_action_items`、`file_versions`、`key_results`、`meeting_participants`、`yjs_persistence`）——同事务内会被父表策略拒绝而整体回滚，属**纵深防御少一层**而非当前越权面，但独立事务写或只改子表的路径拦不住；**G1 · Better Auth 身份域 4 张**（`users`/`sessions`/`accounts`/`verifications`，无租户键、由认证层自管，永久豁免）；**G2 · 支付幂等 2 张**（`processed_payment_events`/`processed_stripe_events`，webhook 须跨租户判重，永久豁免）；**G3 · 用户级有主表 2 张**（`notification_preferences`/`ai_voice_preferences`，都有 `userId → users`，机制现成，是**最便宜的可收编项**；原第三张 `push_tokens` 已于 2026-10-01 试点收编入引擎层，见上文 81 张之列）。原 **G4 · 无归属键 1 张**（`share_access_logs`，装分享访问审计含 IP/UA）已于 2026-10-01 以"写入时反查实体行落 `workspace_id` 列"方式收编（迁移 `20261001000001`，历史孤儿行落 NULL、对应用不可见）——至此"无任何归属键"一类清零。这 18 张**一张都没有 `workspaceId` 列**，因此都不受"应用层 workspaceId 过滤"的保护
- **CI 关卡**（12 个 job）：lint（eslint + prettier + `tsc --noEmit`）/ 覆盖率棘轮（四档百分比 + **零行覆盖文件清单只允许收缩**：实测 707 个文件里 646 个行覆盖为 0，而它们照样往 functions/branches 计数器里送条目，把全库 functions 抬成 58.73%、只看被测到的那 61 个文件实为 46.86%——所以百分比之外另立清单口径）/ RLS 覆盖率（租户表 ENABLE+FORCE+策略三态 + **豁免登记表**）/ schema 漂移 / API 契约 / **角色权限门禁**（写 handler 是否真的调用权限矩阵，四档基线只允许收缩）/ 安全审计 / 单测+集成 / **加固模式回归**（以 `NOBYPASSRLS` 最小权限角色 + RLS 激活跑集成测试）/ 浏览器 E2E / 生产构建 / 镜像发布。**新增的两道登记表门禁自身也进 CI 跑注入式自检**（RLS 豁免登记表 4 类红因 / 5 条变异，零覆盖棘轮 3 类红因 / 6 条变异），防止判据悄悄失效后永远绿灯。状态见页首徽章——**徽章是刻意加的：此前长红三周无人发现，正因为仓库里没有任何 CI 状态出口**
- **可复现的部署**：镜像发布到 GHCR，`docker compose up -d` 一键起全栈（app + PostgreSQL + Redis + cron 调度器 + LiveKit）
- **AI 安全约束**：所有 AI 建议均需用户确认后才落位（写入任务/文档/日程），AI 不直接修改业务数据；AI 用量按工作区**计量**（Token / 调用次数 / 成本三维，写入 `AiUsageLog`），限额配置见 `AiUsageLimit`

## 快速开始（自部署）

```bash
# 1. 准备 .env（参考 .env.example，必填项见 docs/runbook-deploy.md）
cp .env.example .env

# 2. 本地构建镜像并启动全栈（docker-compose.yml 使用本地镜像 corps-web:latest）
docker compose up -d --build

# 3. 健康检查
curl http://localhost:3000/api/health
```

本地开发：

```bash
cd web
pnpm install
cp .env.local.example .env.local   # 修改密码
npx prisma generate && npx prisma migrate dev
pnpm dev                           # http://localhost:3000
```

## 技术栈

Next.js 16（App Router / Turbopack）· React 19 · Tailwind CSS 4 · Prisma 6 · PostgreSQL 18（RLS）· Better Auth · next-intl · mermaid · Stripe / 微信 / 支付宝三通道

## 仓库结构

```
web/          # Next.js 应用（app/ + components/ + lib/ + prisma/ + e2e/ + tests/）
db/           # rls-activate.sql（加固模式一键激活）+ rls-smoke.sh（引擎级冒烟）
scripts/      # CI 门禁脚本：check_rls_coverage / check_rls_exemptions / check_schema_migration_drift / check_api_contract / check_zero_coverage_ratchet
docs/         # ADR 决策记录 / runbook / 市场与定价文档
design/       # 设计系统（design-tokens.css 双主题）
api/          # openapi.yaml 契约
.github/      # CI workflow
```

## 链接
- **在线体验**：尚无公开实例（无 URL 可给；此项待真实部署后回填）
- **变更日志**：[CHANGELOG.md](./CHANGELOG.md)
- **部署手册**：[docs/runbook-deploy.md](./docs/runbook-deploy.md)
- **发布页**：[Releases](https://github.com/Levango7/Corps/releases)（v0.5.0–v0.7.2 已于 2026-10-01 补齐；其中 v0.7.1 无容器镜像）
- **镜像**：`docker pull ghcr.io/levango7/corps:0.7.2`（由 `v0.7.2` tag 触发的 CI 发布；历史 `0.7.1` 镜像实际不存在）
- **定价**：内置定价页（Pro ¥29.9/人/月，年付 ¥299）。两处数字分属两张表，勿混用——`web/lib/pricing.ts` 的 `PRICING_MATRIX` 是**功能对比表**：22 个功能行中 Free 全量 14 行 + 受限 3 行（决策条数 / 人数 / 附件大小）= 可用 17 行；同文件 `PRICING_PLANS.free.features` 是**套餐卡要点列表**：21 条（`pricing.features.free.f01–f21`，中英词条齐备）。逐项 Free/Pro 归属以 `PRICING_MATRIX` 为准。

---

*个人开发者长期项目 · 安全问题请通过 GitHub Security Advisories 报告*
