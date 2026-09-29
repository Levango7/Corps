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

- **租户隔离（双层防御）**：`schema.prisma` 中 71 个含 `workspaceId` 的租户模型（对应 79 张表）全部启用 PostgreSQL `FORCE ROW LEVEL SECURITY`，共 264 条策略；由 CI 的 `schema-drift`（schema ↔ 已部署库逐项比对）与 `rls-coverage`（ENABLE + FORCE + 策略三态齐备）双门禁守护。另有 20 张仅带父级外键的子表依赖应用层 `workspaceId` 过滤，未入引擎层
- **CI 关卡**（12 个 job）：lint（eslint + prettier + `tsc --noEmit`）/ 覆盖率棘轮 / RLS 覆盖率 / schema 漂移 / API 契约 / **角色权限门禁**（写 handler 是否真的调用权限矩阵，四档基线只允许收缩）/ 安全审计 / 单测+集成 / **加固模式回归**（以 `NOBYPASSRLS` 最小权限角色 + RLS 激活跑集成测试）/ 浏览器 E2E / 生产构建 / 镜像发布。状态见页首徽章——**徽章是刻意加的：此前长红三周无人发现，正因为仓库里没有任何 CI 状态出口**
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
scripts/      # CI 门禁脚本：check_rls_coverage / check_schema_migration_drift / check_api_contract
docs/         # ADR 决策记录 / runbook / 市场与定价文档
design/       # 设计系统（design-tokens.css 双主题）
api/          # openapi.yaml 契约
.github/      # CI workflow
```

## 链接

- **在线体验**：部署中（v0.7.1 已发布）
- **变更日志**：[CHANGELOG.md](./CHANGELOG.md)
- **部署手册**：[docs/runbook-deploy.md](./docs/runbook-deploy.md)
- **镜像**：`docker pull ghcr.io/levango7/corps:0.7.1`
- **定价**：内置定价页（Pro ¥29.9/人/月，年付 ¥299）。两处数字分属两张表，勿混用——`web/lib/pricing.ts` 的 `PRICING_MATRIX` 是**功能对比表**：22 个功能行中 Free 全量 14 行 + 受限 3 行（决策条数 / 人数 / 附件大小）= 可用 17 行；同文件 `PRICING_PLANS.free.features` 是**套餐卡要点列表**：21 条（`pricing.features.free.f01–f21`，中英词条齐备）。逐项 Free/Pro 归属以 `PRICING_MATRIX` 为准。

---

*个人开发者长期项目 · 安全问题请通过 GitHub Security Advisories 报告*
