# Corps 项目优化建议清单

> 生成时间：2026-09-20
> 分析范围：`web/` 目录（Next.js 16 + React 19 + Tailwind v4 + Prisma + better-auth）
> 分析维度：AI 集成完善度、UI 一致性、性能瓶颈、i18n 覆盖率、测试覆盖

## 概览

| 维度 | 健康度 | 关键发现 |
|------|--------|----------|
| AI 集成完善度 | 🟢 良好 | 流式响应、token 统计、成本控制均已实现；缺多提供商 fallback |
| UI 一致性 | 🟢 优秀 | design token 体系完善，硬编码色值极少；ErrorBoundary 覆盖不足 |
| 性能瓶颈 | 🔴 严重 | 99% 组件为 client component，code splitting 极少，未分页查询多 |
| i18n 覆盖率 | 🟡 中等 | key 对齐良好，但 AI 组件 135+ 处硬编码中文 |
| 测试覆盖 | 🟡 中等 | 覆盖率阈值仅 15%，AI/组件测试覆盖不足 |

---

## P0 — 高优先级（性能与架构关键问题）

### P0-1. client component 滥用（254/256 组件为 client component）

- **问题描述**：`components/` 目录下 250 个 `.tsx` 文件中，254 个顶部声明 `"use client"`，仅 `Logo.tsx` 和 `Skeleton.tsx` 是 server component。几乎所有组件都在客户端渲染，完全丧失了 Next.js App Router 的服务端渲染（RSC）优势。
- **影响范围**：
  - 首屏 JS bundle 膨胀，TTFB/FCP/LCP 恶化
  - 数据获取无法在服务端完成，SEO 不友好
  - 无 RSC 流式渲染优势，用户感知白屏时间延长
  - 257 个文件使用 `useTranslations`，本可在 server component 中用 `getTranslations`
- **建议方案**：
  1. 逐组件审计 `"use client"` 是否必要：仅在使用 hook（useState/useEffect/useRef）、事件处理（onClick 等）、浏览器 API（window/document/localStorage）、第三方 client-only 库时才需要
  2. 纯展示型组件（如 `EmptyState`、`DueTag`、`TaskLabels`、`MilestoneFilter`、`ViewToggle`）改为 server component
  3. 数据展示组件用 server component + `getTranslations` 获取文案，交互部分拆为 client 子组件
  4. 列表/详情页用 server component 服务端取数，分页/筛选控件拆为 client 子组件
- **预估工作量**：5-8 人日（需逐组件审计，注意 hook 和事件边界）

### P0-2. code splitting 严重不足（仅 2 处 dynamic import）

- **问题描述**：250 个组件中仅 2 处使用 `dynamic()` 或 `React.lazy`（`DocumentPreview`、`FileGridItem`）。重型组件（Mermaid 图表、RichTextEditor、Whiteboard、CommandPalette、各 AI 面板）全部静态导入，全部进入首屏 bundle。
- **影响范围**：
  - 首屏 JS 体积过大，冷启动慢
  - 用户可能从不访问的功能（如白板、Mermaid 图表）也被提前加载
  - 移动端弱网体验差
- **建议方案**：
  1. 重型可视化组件 `Mermaid`、`Whiteboard`、`RichTextEditor`、`DocumentEditor` 用 `next/dynamic` 懒加载（`ssr: false`）
  2. AI 面板（41 个）按需 dynamic import，仅在用户打开时加载
  3. 模态/抽屉类组件（`AttachmentPreviewModal`、`NewTaskDialog`、`TaskBreakdownDialog`、`CalendarScheduleDialog`）懒加载
  4. `CommandPalette` 用 `next/dynamic` 懒加载（Ctrl+K 触发）
  5. 配合 `next build` 分析 bundle，确认拆分效果
- **预估工作量**：2-3 人日

### P0-3. 未分页列表查询（42 个文件 findMany 无 take/skip）

- **问题描述**：`app/api/` 下 179 处 `findMany`，其中 42 个文件的 `findMany` 未加 `take`/`skip` 限制。虽然部分是合理的（cron job、权限校验、配置查询），但列表型 API（如 `contact-groups`、`calendar/events`、`key-results`、`documents/permissions`）未分页，数据量增长后会拖垮响应。
- **影响范围**：
  - 工作区数据增长后，单次查询返回数百/数千条记录
  - 数据库内存占用飙升，响应时间线性恶化
  - 前端一次性渲染大量 DOM 节点，卡顿
- **建议方案**：
  1. 审计 42 个无 `take` 的文件，区分"全量合理"（如 cron、权限）与"需分页"（如列表 API）
  2. 列表 API 统一加 `take`（默认 50）+ `skip`（基于 `page` 参数）+ `cursor` 分页
  3. 返回 `{ data, total, hasMore }` 信封，前端做无限滚动
  4. 对 `lib/ai/context.ts` 的上下文聚合查询（已有截断标注）保持全量但加 `take` 上限保护
- **预估工作量**：3-4 人日

---

## P1 — 中优先级（质量与可维护性）

### P1-1. AI 组件硬编码中文（135+ 处）

- **问题描述**：`components/ai/` 下 20+ 个组件中存在 135 处硬编码中文字符串（如 `"生成草稿"`、`"生成中…"`、`"预览"`、`"编辑"`、`"保存为公告"`、`"聚合数据"`、`"分析"`、`"生成"`）。这些字符串未走 `t()` 函数，英文用户会看到中文。
- **影响范围**：
  - AI 功能在英文 locale 下显示中文，体验不一致
  - 与项目已有 3243 个 i18n key 的规范脱节
  - 新增语言（如日文）无法覆盖这些字符串
- **建议方案**：
  1. 在 `messages/en.json` 和 `messages/zh.json` 的 `ai` 命名空间下补齐缺失 key
  2. 将 AI 组件中的硬编码字符串替换为 `t("ai.xxx.yyy")`
  3. 进度阶段文案（`"聚合数据"`/`"分析"`/`"生成"`）统一抽到 `ai.stages` 命名空间
  4. 同步修复 `widgets/ActivityWidget.tsx`（`"活动加载失败"`、`"暂无活动"`）和 `widgets/AiInsightWidget.tsx`（`"洞察加载失败"`）
  5. 在 `tests/unit/i18n-keys.test.ts` 中增加 AI 组件硬编码中文检测，防止回退
- **预估工作量**：2-3 人日

### P1-2. AI 单一提供商，无 fallback 机制

- **问题描述**：AI 集成仅支持 DeepSeek（`deepseek-chat` + `deepseek-reasoner`），`deepseek.ts` 硬编码 `baseURL: "https://api.deepseek.com/v1"`。无 OpenAI/Anthropic/本地模型 fallback。DeepSeek 宕机或限流时，所有 AI 功能不可用。
- **影响范围**：
  - DeepSeek API 故障时 AI 功能全量不可用
  - 无法按场景选择更优模型（如 GPT-4o 做视觉、Claude 做长上下文）
  - 成本优化受限（无法混用便宜和昂贵模型）
- **建议方案**：
  1. 抽象 `ModelProvider` 接口，支持多提供商注册
  2. 环境变量增加 `AI_PROVIDER=deepseek|openai|anthropic`，按能力路由到不同提供商
  3. 实现自动 fallback：主提供商超时/限流时切到备用提供商
  4. `usage-tracker.ts` 的定价表抽为配置文件，支持多模型定价
  5. 保留 DeepSeek 作为默认，新增 OpenAI/Anthropic 作为可选
- **预估工作量**：3-5 人日

### P1-3. ErrorBoundary 覆盖不足

- **问题描述**：组件层 0 个 `ErrorBoundary`，仅 `app/global-error.tsx`、`app/[locale]/error.tsx`、`app/not-found.tsx` 三个路由级错误边界。`Suspense` 仅 2 处使用。重型组件（Mermaid、RichTextEditor、Whiteboard、AI 面板）渲染崩溃会白屏整个路由。
- **影响范围**：
  - 单个组件崩溃导致整页白屏
  - Mermaid 渲染异常、AI 流解析失败等无局部兜底
  - 用户无法恢复，必须刷新整页
- **建议方案**：
  1. 为重型可视化组件（`Mermaid`、`Whiteboard`、`RichTextEditor`、`DocumentEditor`）包裹 `<ErrorBoundary>` + 降级 UI
  2. AI 面板（41 个）统一用 `ErrorBoundary` 包裹，崩溃时显示"AI 服务暂时不可用，请重试"
  3. 数据展示组件用 `Suspense` + `Skeleton` 包裹，实现流式加载
  4. 封装 `<SafeComponent>` 工厂，统一 ErrorBoundary + fallback + 上报
- **预估工作量**：2-3 人日

### P1-4. 测试覆盖率阈值过低（15%）且 AI/组件覆盖不足

- **问题描述**：`vitest.config.ts` 覆盖率阈值仅 `lines: 15, branches: 10, functions: 15, statements: 15`。58 个测试文件覆盖 656 个源文件（覆盖率约 8.8%）。AI 模块 17 个 lib 文件 + 41 个组件，仅 3 个测试文件（`ai-feedback`、`ai-usage-limit`、`ai-usage-tracker`）。关键路径如 `orchestrator`、`executor`、`stream`、`context` 无单测。
- **影响范围**：
  - AI 编排、执行、流式等核心逻辑无回归保护
  - 重构风险高，容易引入隐性 bug
  - CI 无法有效拦截质量退化
- **建议方案**：
  1. 为 `lib/ai/orchestrator.ts` 补单测：`normalizePlan`、`validateActionFields`、`cleanJsonResponse` 的边界用例
  2. 为 `lib/ai/stream.ts` 补单测：`createAiProgressStream`、`createAiJsonProgressStream` 的进度阶段和错误降级
  3. 为 `lib/ai/context.ts` 补单测：各 scope 的截断和空数据降级
  4. 为 `lib/ai/executor.ts` 补单测：8 种 action 类型的执行和失败回滚
  5. 逐步提高覆盖率阈值：3 个月内提升到 `lines: 30, branches: 25`，6 个月到 `lines: 50`
  6. E2E 补充 AI 功能冒烟（当前 9 个 spec 无 AI 场景）
- **预估工作量**：5-8 人日

### P1-5. 21 个 i18n key 未翻译（zh 值 == en 值）

- **问题描述**：`zh.json` 中有 21 个 key 的值与 `en.json` 完全相同（如 `nav.menu.okr`、`pricing.comparison.free`、`pricing.comparison.pro`、`languageSwitcher.en`、`permissions.role.viewer` 等），中文用户看到英文。
- **影响范围**：中文 locale 下部分 UI 显示英文，体验不一致
- **建议方案**：
  1. 逐 key 补充中文翻译
  2. 在 `tests/unit/i18n-keys.test.ts` 中增加"zh 值不应等于 en 值"的检测（排除品牌名等合理例外）
- **预估工作量**：0.5 人日

---

## P2 — 低优先级（优化与打磨）

### P2-1. 头像未用 next/image 优化

- **问题描述**：5 处 `<img>` 标签用于头像渲染（`MessageBubble`、`MessageInput`、`MentionPopover`、`MessageItem`×2），未走 `next/image` 优化。代码注释说明是为避免 `remotePatterns` 配置耦合。
- **影响范围**：
  - 头像无自动压缩、格式转换（WebP/AVIF）、懒加载
  - 移动端流量浪费
- **建议方案**：
  1. 配置 `next.config.ts` 的 `images.remotePatterns` 允许头像域名
  2. 替换 `<img>` 为 `next/image` 的 `<Image>`，设置 `width/height` 或 `fill`
  3. `DocumentPreview` 和 `billing` 的 `<img>` 可保留（注释已说明合理理由：任意 src / 本地 QR Data URL）
- **预估工作量**：1 人日

### P2-2. AI 定价表硬编码

- **问题描述**：`lib/ai/usage-tracker.ts` 的 `estimateCost` 函数将 DeepSeek 定价硬编码在函数体内（`deepseek-chat: $0.14/1M input, $0.28/1M output`）。价格调整需改代码重新部署。
- **影响范围**：模型调价或新增模型时需改代码
- **建议方案**：
  1. 将定价表抽为 `lib/ai/pricing.ts` 或环境变量配置
  2. 支持从数据库 `AiModelPricing` 表读取（便于运营后台调整）
  3. 保留硬编码作为 fallback 默认值
- **预估工作量**：0.5 人日

### P2-3. AI 限额检查非原子（高并发可能轻微超限）

- **问题描述**：`lib/ai/usage-limit.ts` 的 `checkAiUsageLimit` 仅做"是否超限"判定，不原子占用配额。代码注释已承认此问题，建议引入 Redis 原子计数但"暂不在范围内"。
- **影响范围**：高并发下多请求同时通过检查后各自写入，可能超出限额几个请求
- **建议方案**：
  1. 引入 Redis `INCR` 原子计数器，按 `workspaceId:userId:day` 维度计数
  2. 或用数据库事务 + `SELECT ... FOR UPDATE` 悲观锁
  3. 对 AI 调用场景，轻微超限可接受，可保持现状但监控超限量
- **预估工作量**：1-2 人日（Redis 方案）/ 0.5 人日（保持现状+监控）

### P2-4. AI 超时防护未全覆盖

- **问题描述**：`lib/ai/deepseek.ts` 提供了 `createAbortTimeout` 工具（普通模型 30s、推理模型 60s），但 `lib/ai/stream.ts` 的 `createAiProgressStream` 和 `createAiJsonProgressStream` 未使用该工具，`orchestrator.ts` 的 `suggestOrchestration` 也未传入 `abortSignal`。
- **影响范围**：流式 AI 调用和编排调用无超时保护，DeepSeek 长尾请求可能挂起
- **建议方案**：
  1. `createAiProgressStream` 增加 `timeoutMs` 参数，传给 `streamText` 的 `abortSignal`
  2. `suggestOrchestration` 用 `createAbortTimeout(REASONER_TIMEOUT_MS, "suggestOrchestration")` 包裹
  3. `createAiJsonProgressStream` 同理
- **预估工作量**：0.5 人日

### P2-5. Suspense + Skeleton 流式加载覆盖不足

- **问题描述**：仅 2 个文件使用 `Suspense`，16 个文件使用 `Skeleton`。大部分数据展示组件无流式加载，用户感知"全有或全无"的加载态。
- **影响范围**：首屏数据未到时整块空白，而非渐进式骨架屏
- **建议方案**：
  1. 列表/详情页用 `<Suspense fallback={<Skeleton/>}>` 包裹数据展示区
  2. 配合 P0-1 的 server component 改造，利用 RSC 流式渲染
  3. 仪表盘 widget 逐个 `Suspense` 包裹，独立加载
- **预估工作量**：2-3 人日

---

## 附录：分析数据汇总

### AI 集成完善度

| 检查项 | 状态 | 说明 |
|--------|------|------|
| AI lib 文件数 | 17 | `lib/ai/` 下 17 个文件 + `assistant/`、`prompts/`、`tools/` 子目录 |
| AI 组件数 | 41 | `components/ai/` 下 41 个面板/视图 |
| Prompt 模板数 | 33 | `lib/ai/prompts/` 下 33 个场景化 prompt |
| 流式响应 | ✅ | `stream.ts` 基于 Vercel AI SDK v7 `createUIMessageStream` |
| Token 统计 | ✅ | `usage-tracker.ts` 记录 input/output/total tokens |
| 成本控制 | ✅ | `estimateCost` 按定价表估算美元成本 |
| 限额检查 | ✅ | `usage-limit.ts` 支持日/月 Token + 调用次数限额 |
| 超时防护 | 🟡 | 工具已实现但未全覆盖 `stream.ts`/`orchestrator.ts` |
| 多提供商 fallback | ❌ | 仅 DeepSeek，无备用提供商 |
| 降级处理 | ✅ | 意图识别超时降级为 semantic_search，JSON 解析失败降级为纯文本 |

### UI 一致性

| 检查项 | 状态 | 说明 |
|--------|------|------|
| design token 体系 | ✅ 优秀 | `design-tokens.css` 定义完整，含浅/深主题 + 租户换肤 + 密度切换 |
| 硬编码色值 | ✅ 极少 | 仅 5 处（PWA manifest、协作光标、HTML 导出、placeholder），均合理 |
| 暗色模式 | ✅ | `[data-theme="dark"]` 覆盖所有 primitive + 语义 token |
| 响应式断点 | ✅ | 294 处 `sm:`/`md:`/`lg:`/`xl:` 使用 |
| Skeleton 加载态 | 🟡 | 16 个文件使用，覆盖不足 |
| ErrorBoundary | ❌ | 组件层 0 个，仅路由级 3 个 |
| Suspense | ❌ | 仅 2 处使用 |

### 性能瓶颈

| 检查项 | 状态 | 说明 |
|--------|------|------|
| N+1 查询 | 🟡 | 179 findMany + 111 findUnique，需逐路径审计 |
| 未分页查询 | 🔴 | 42 个文件 findMany 无 take/skip |
| code splitting | 🔴 | 仅 2 处 dynamic import |
| next/image | 🟡 | 0 个 import，5 个 `<img>`（头像），注释说明合理 |
| client component | 🔴 | 254/256 为 client component（99.2%） |

### i18n 覆盖率

| 检查项 | 状态 | 说明 |
|--------|------|------|
| en.json key 数 | 3243 | |
| zh.json key 数 | 3243 | |
| key 对齐 | ✅ | 0 个 en-only，0 个 zh-only |
| 未翻译（zh==en） | 🟡 | 21 个 key |
| t() 使用 | ✅ | 257 个文件，7568 处调用 |
| AI 组件硬编码中文 | 🔴 | 135+ 处 |

### 测试覆盖

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 单元测试文件 | 34 | `tests/unit/` |
| 集成测试文件 | 14 | `tests/integration/` |
| API 测试文件 | 1 | `tests/api/` |
| E2E 测试文件 | 9 | `e2e/` |
| 测试用例总数 | 884 | 826 unit/integration + 58 e2e |
| 覆盖率阈值 | 15% | lines/branches/functions/statements 均为 10-15% |
| AI 模块测试 | 🟡 | 仅 3 个文件覆盖 usage/feedback，orchestrator/executor/stream/context 无测试 |

---

## 优先级排序总结

| 优先级 | 编号 | 问题 | 工作量 |
|--------|------|------|--------|
| P0 | P0-1 | client component 滥用（99.2%） | 5-8 人日 |
| P0 | P0-2 | code splitting 严重不足（仅 2 处） | 2-3 人日 |
| P0 | P0-3 | 未分页列表查询（42 个文件） | 3-4 人日 |
| P1 | P1-1 | AI 组件硬编码中文（135+ 处） | 2-3 人日 |
| P1 | P1-2 | AI 单一提供商无 fallback | 3-5 人日 |
| P1 | P1-3 | ErrorBoundary 覆盖不足 | 2-3 人日 |
| P1 | P1-4 | 测试覆盖率阈值过低（15%） | 5-8 人日 |
| P1 | P1-5 | 21 个 i18n key 未翻译 | 0.5 人日 |
| P2 | P2-1 | 头像未用 next/image | 1 人日 |
| P2 | P2-2 | AI 定价表硬编码 | 0.5 人日 |
| P2 | P2-3 | AI 限额检查非原子 | 1-2 人日 |
| P2 | P2-4 | AI 超时防护未全覆盖 | 0.5 人日 |
| P2 | P2-5 | Suspense + Skeleton 覆盖不足 | 2-3 人日 |

**总预估工作量：28-44 人日**

> 注：P0-1（client component 改造）与 P0-2（code splitting）、P1-3（ErrorBoundary）、P2-5（Suspense）有协同效应，建议合并为一个"渲染架构优化"迭代统一推进。