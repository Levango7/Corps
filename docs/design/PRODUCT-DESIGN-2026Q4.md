# corps 产品设计与落地方案 · 2026Q4

> 基线：`origin/main = 53808409`（2026-10-20 13:20 实测）。
> 性质：**提案**，不改代码；本文所有数字都在附录 A 给了复现命令。
> 口径：带「实测」的是我跑过的命令结果；带「判断」的是推理，不冒充实测；带「估算」的是工作量。

---

## 0. 摘要（先回答问题）

### 0.1 这套设计合理吗？分维度给结论

| 维度 | 结论 | 一句话依据 |
| --- | --- | --- |
| 产品定位 | **不合理** | 同一份 README 同时主张「5–30 人轻量协作」和「AI 原生办公平台 17 能力 5 域」；产品面是 56 页 / 31 个导航入口 / 30+ 域（实测） |
| 产品设计（对象与流程） | **核心合理，闭环缺证据** | 决策记录有版本留痕 + 双向回链，是全仓唯一真空位；但事件里没有 `decision_created/landed`，无法证明闭环发生 |
| 功能设计 | **广度与深度不匹配** | 任务/决策/文档/IM/审批有页面+测试；mail/todo/remote-control/sync/旧聊天树是「组件+API+i18n 齐全但零挂载」；E2E 完全不覆盖文档/多维表/审批/工作流/AI |
| UI | **令牌合格，交互不一致** | 156 个设计令牌 + 双主题/密度/租户色；但通用组件层只有 1 个 `FocusTrap`，903 个原生 `<button>`、64 处自建 `role="dialog"`、253 处主按钮类复制、233 条 a11y 基线违规 |
| 信息架构 | **修了一半** | 28 项平铺 → 5 组已落地；但**默认可见性没有分层**——高频与一年点一次的功能在首屏同等权重 |

### 0.2 这样的产品会受用户欢迎吗？

**按现状不会。** 这是判断，不是市场预测，判据如下（都可被证伪）：

1. **没有前门。** 应用根路径直接 `redirect(/auth/login)`（`web/app/[locale]/page.tsx:12`）；定价页只能从工作区计费页进（`web/app/[locale]/w/[wid]/billing/page.tsx:280`）；README 自述「在线体验：暂无固定域名实例」。一个 0 用户的 0.7.x 产品，前门是登录页。
2. **楔子被广度淹没。** 侧栏 31 个静态入口里，「决策记录」只是其中一项；AI 五页并列（`layout.tsx:442-457`）。新用户 15 分钟内看不到"讨论→决策→任务"这条唯一差异化链路。
3. **闭环不可度量。** 全仓 `track()` 只有 14 个事件，其中与核心闭环相关的只有 `create_task` / `task_status_change` / `workspace_create`；没有 `decision_created`、`decision_landed`、`invite_sent`、`ai_extract_*`。也就是说：即使有人用，也证明不了"他们完成了闭环并留下来"。

**可翻转的支点（判断）：** 「讨论结论自动落位成任务与决策记录」在竞品矩阵里确实是空位（`docs/market/competitive-analysis.md:23` 自述，Trello/Linear/Notion/飞书都没有原生覆盖）。它现在的问题不是"idea 不行"，而是**没有把这一件事做成 10 倍好、并放在用户看得见的地方**。

### 0.3 补 / 纠偏 / 移除（三张清单）

**需要补充（5）**
1. 一个能被访问的正式实例 + 一个 60 秒可体验的示例工作区（当前 0 实例）。
2. 决策闭环的「提取 → 确认 → 落位 → 复盘」四步产品化（现在只有对象，没有流水线）。
3. 通用组件原语（11 个）+ 对话框统一（现在 903 个原生按钮、64 个自建弹窗）。
4. 闭环事件与漏斗（决策闭环率、7 日回访）。
5. 移动端「3 分钟捕捉决议」入口（决议多数发生在会议/聊天里，不在电脑前）。

**需要纠偏（4）**
1. 定位口径统一到一句话，README / 站点 / 定价页 / roadmap 共用一处事实源。
2. 默认可见性分层：31 → 默认 6 + 可选模块（不删功能，只改默认）。
3. 付费分界线从"人数"改成"决策闭环价值"（现在 Free 覆盖 17/22 项，Pro 只有 3 个理由，且都不是楔子）。
4. 文档漂移：README 技术栈仍写 **Prisma 6**（实际 `@prisma/client` 7.10.1）；`docs/market/competitive-analysis.md:14` 写 **¥59/人/月**（实际 29.9）；`web/tests/a11y-baseline.txt:29-38` 头部仍按 363 条统计（数据实际 233 条）。

**需要移除或降级（3）**
1. 死负载：`components/ChatPanel.tsx + components/chat/*`（2,109 行、零挂载）、`components/mail`、`components/todo`、`components/remote-control`、`components/sync`（各自有组件+API+i18n，但零 importer）。按 ADR-013 的路径：先迁移有价值的 `MessageInput`，再整棵删除。
2. 有页面无入口的五个孤儿：`assistant`、`ai-usage`、`settings/calendar`、`settings/permissions`（只在 `e2e/route-health.spec.ts` 里被列举）。要么接进设置，要么删。
3. 设计实现的复制品（不是功能）：253 处主按钮类、64 处自建 dialog、27 处 `@/components/mail` 式死引用。

---

## 1. 实测基线（2026-10-20）

| 事实 | 数值 | 出处（附录 A 有命令） |
| --- | --- | --- |
| 用户可见页面 | 56 个 `page.tsx` | `find web/app -name page.tsx` |
| API 路由 / handler | 291 个 route.ts / 449 个 handler | `find web/app/api -name route.ts` |
| 组件规模 | 286 文件（`*.ts`+`*.tsx`）/ 78,773 行 | `find web/components -type f \( -name '*.ts' -o -name '*.tsx' \)` |
| 功能域 | 30+（任务/决策/文档/Wiki/多维表/表单/OKR/工作流/模板/工时/日历/会议/纪要/审批/公告/IM/通知/文件/联系人/白板/AI×5/分析/计费…） | 侧栏 `layout.tsx:332-491` |
| 导航入口 | 31 个静态入口 + 1 个收藏动态项（5 组） | 同区块 `grep -c 'href:'` = 32，其中 1 条是收藏项 |
| i18n | zh/en 各 3,544 键 / 76 命名空间，键集合差异 0 | `web/messages/*.json` |
| 数据模型 | 99 model / 54 迁移 | `grep -c '^model ' schema.prisma` |
| 设计令牌 | 156 个唯一变量 / 475 行；双主题 + 密度 + 租户色 | `design/design-tokens.css` |
| 通用 UI 组件 | 1 个（FocusTrap）；原生 button 903 / input 239 / select 74 | 附录 A |
| 弹窗 | 57 文件 64 处 `role="dialog"`，仅 2 处用 FocusTrap | 附录 A |
| a11y | 233 条基线违规 / 102 文件（静态 jsx-a11y，非 axe） | `web/tests/a11y-baseline.txt` |
| E2E | 18 spec / 80 test；无文档/多维表/审批/工作流/OKR/AI 覆盖 | `ls web/e2e` |
| 单测/集成 | 114 个测试文件 | `find web/tests -name '*.test.ts*'` |
| 未发版 | v0.7.2（2026-09-30）后 **389 个提交**；`web/package.json` 仍 0.7.2 | `git rev-list --count v0.7.2..origin/main` |
| 定价 | Free ≤10 人 / 决策最近 10 条 / 附件 10MB；Pro ¥29.9/人/月、年付 ¥299 | `web/lib/pricing.ts` |
| 付费执行点 | 席位：`lib/billing/seat-policy.ts`；决策条数：`tasks/[id]/decisions/route.ts:162`（402） | 附录 A |
| 事件 | 14 个 `track()` 事件；服务端只有支付 webhook 的 3 个 `trackServerEvent` | 附录 A |

---

## 2. 定位诊断：三个矛盾 + 一处漂移

### 2.1 轻量 vs 全能

README 第一句写「面向 **5–30 人中小团队**的**轻量**协作 SaaS」，第二屏写「已从项目管理工具升级为 **AI 原生办公平台**」；而实际导航有 31 项、API 有 449 个 handler、功能域 30+。
**后果**：用户无法用一句话转述它是什么；销售/内容/定价也无法共用一套话术。这是"功能清单冒充产品定义"。

### 2.2 楔子 vs 噪声

真正的差异化只有一条：**决策记录（版本留痕 + 双向回链）**。但在侧栏里它与邮件、OKR、多维表、白板、表单同等显眼；AI 五页（工具/洞察/问答/日报/公告草稿）并列成一组。
**后果**：新用户第一眼看到的是"很多工具"，不是"一个能解决问题的产品"。

### 2.3 承诺 vs 可达

README 说「15 分钟上手」「在线试用」；实际：根路径直接跳登录、无固定实例、定价页只能从工作区计费页进入、法律页只能从定价页页脚进入。
**后果**：所有对外承诺都没有入口承接，SEO/分享/冷启动全部落空。

### 2.4 文档与事实的漂移（必须修）

| 位置 | 写的 | 实际（实测） |
| --- | --- | --- |
| `README.md:104` | Prisma 6 | `@prisma/client` **7.10.1** |
| `docs/market/competitive-analysis.md:14` | ¥59/人/月 | ¥29.9/人/月（`web/lib/pricing.ts`） |
| `web/tests/a11y-baseline.txt:29-38` | 头部统计合计 363 | 数据行合计 **233** |
| `docs/market/competitive-analysis.md:14` | 定位"轻量任务中心" | 30+ 域、449 handler |

判断：这类漂移在商务场景是硬伤——客户按文档报价会发现不一致，评审按文档看能力会高估。

---

## 3. 定位重述（提案）

**一句话（对外统一口径）：**
> corps 把团队的讨论结论，落成有人负责、可追溯的任务。

**产品定义（对内）：**
- **目标用户**：5–30 人、以项目/客户交付为主的小团队（设计、咨询、软件外包、内容、外贸），有一个"项目推动者"（PM/负责人/创始人）。
- **唯一楔子**：决策记录（Decision）——「为什么这么定」永远可查，且与任务双向回链。
- **三个必须打赢的瞬间**：
  1. 会后 3 分钟：把讨论变成带负责人和期限的任务；
  2. 任务卡住时：一眼看到"当初为什么这么定、谁定的、后来改过吗"；
  3. 新人入职：不用问人，能查到历史决策。
- **明确不竞争（非目标）**：不做视频会议（LiveKit 降为可选/隐藏）、不做 CRM、不做通用多维表格/白板/表单、不做企业 IM 替代。
- **与「不做减法」的兼容方式**：**不删除任何能力域，只改变默认可见性**（见 §5）。这样既守住用户 2026-10-03 的拍板，又让首屏从 31 项降到 6 项。

判断：定位收敛后，"AI 原生"不再是并列卖点，而是**实现楔子的手段**（从会议/聊天/文档里提取决议），这比现在"17 个 AI 能力"的说法更能被记住。

---

## 4. 核心场景与验收口径

### 场景 A：会后落位（主场景，北极星来源）
1. 在会议纪要/文档里粘贴讨论记录（或从 IM 会话选择消息）；
2. 点「提取决议」→ AI 返回结构化草稿：`结论 / 理由 / 负责人 / 期限 / 风险 / 建议任务`；
3. **逐条确认**（可编辑；不确认不落位）→ 一次落位成决策记录 + 任务 + 日历复盘提醒；
4. 决策记录自动回链任务；任务详情显示"为什么"。

**验收（可机器判）**：
- 从粘贴到落位 ≤ **5 次点击 / 3 分钟**（Playwright 计时）；
- 每条 AI 落位的决策必须有 `sourceRef` 与 `confirmedBy`（DB 断言）；
- AI 失败时可退回纯手工，不丢草稿。

### 场景 B：决策追溯（周会/复盘）
任务卡点 → 决策页 → 版本 diff / 关联文档 / 后续任务 → 导出 PDF（现有能力）。**验收**：从任意任务 ≤2 次点击到决策页。

### 场景 C：新人上手（15 分钟）
示例工作区（1 个真实项目模板 + 3 条历史决策）→ 完成一次场景 A → 看到"我的任务"与"决策时间线"。**验收**：新账号 15 分钟内完成 A 流程的比例（埋点）。

---

## 5. 信息架构 v2：默认 6 + 可选模块

> 现有第一层（侧栏归组 + Cmd+K，`docs/design/INFORMATION-ARCHITECTURE-2026Q4.md`）保留；本方案在其上加第三层：**默认可见性**。

### 5.1 默认侧栏（新工作区开箱）

| 组 | 项 |
| --- | --- |
| 核心 | 概览、看板、我的任务、**决策**、消息、文档 |
| 管理（按角色） | 成员、设置、计费、分析 |

### 5.2 可选模块（工作区设置里开启，默认关）

会议 / 会议纪要、审批、公告、日历、联系人、Wiki、白板、多维表格、表单、OKR、工作流、模板、工时、AI 工具箱（五页并一，见下）。

- 开启后出现在对应分组；关闭时数据保留（不删数据，符合既有承诺）。
- Cmd+K **仍然全量直达**；命中未开启模块时给「启用该模块」一步入口。
- 这与「不做减法」不冲突：能力全在，只是不默认占用户注意力。

### 5.3 AI 五页并一（IA 文档 §2.1 提案，建议提前到 P1）

`/w/{wid}/ai` 一个页面五个 tab：对话工具｜洞察｜知识问答｜日报｜公告草稿；旧路由 301 保留。
侧栏 AI 组从 5 项 → 1 项。API 与能力零改动。

### 5.4 移动端

底栏 4 项：任务 / 决策 / 消息 / 我的；顶部「+」直达场景 A 的第 1 步。
（现状：底栏是任务/消息/文档/我的，`web/components/layout/MobileBottomNav.tsx:44-49`。）

**验收**：新工作区首屏入口 31 → **10**（6 + 4 管理）；新用户首日可点项从 31 → 6；未开启模块不出现但 Cmd+K 可搜到。

---

## 6. 决策闭环：功能设计

### 6.1 对象模型（复用现有表，不新增表域）

现有 `decisions` + `decision_versions` + 任务关联已满足骨架。建议扩三列（符合"90 天不新增能力域"的冻结：这是字段不是域）：

| 字段 | 用途 | 约束 |
| --- | --- | --- |
| `source` | manual / meeting / im / doc / ai-extract | 枚举，默认 manual |
| `source_ref` | 指向来源（会议 id / 消息 id / 文档 id） | 可空；AI 提取必填 |
| `review_at` | 复盘日期 | 可空；落位时映射为日历事件，不新增表 |

规则：**AI 永不直接落位**——现有承诺不变（`README.md` 的"AI 安全约束"），每条必须人工确认后才写入。

### 6.2 AI 流水线（复用 orchestrator，不新建能力域）

`capture → extract → confirm(diff) → land → learn(feedback)`

- 复用现有 `lib/ai/assistant/orchestrator.ts` 与 action 机制；新增的是**编排顺序与确认 UI**，不是新模型能力。
- 输出必须是结构化 JSON（现有 `prompts/*` 已有 JSON 约束）；解析失败退回纯文本草稿。
- 计量走现有 `AiUsageLog` / `AiUsageLimit`（已按工作区限额，429 拦截）。

### 6.3 任务集成
- 任务详情新增「决策」区块：结论一句话 + 展开看全文/版本；
- 看板卡点原因若来自决策，显示「因决策 #x 变更」；
- 任务创建时可选「挂在某决策下」——这就是双向回链的产品化。

### 6.4 提醒与复盘
`review_at` → 日历事件 + 通知（复用 cron 与 notification，不新增调度器）；
每周一生成「上周决策回顾」清单（复用 daily-report 的取数逻辑，不做新页面）。

---

## 7. UI 与设计系统

### 7.1 现状判断
视觉语言（Calm Precision）与令牌是**成体系**的；但组件层几乎空白，导致：
- 交互不一致：64 个自建弹窗只有 2 个管焦点；
- 改动成本高：主按钮类复制 253 次，换品牌色要人肉巡检；
- a11y 债：233 条违规，门禁是静态 ESLint，不是浏览器级。

### 7.2 目标与范围（不做全面换皮）

**只做 11 个原语**：Button / Input / Select / Textarea / Dialog / Sheet / Toast / Table / Tabs / EmptyState / Toolbar。
落地顺序：核心 6 页（登录、看板、任务详情、决策、文档、设置）→ 其余页面按改动自然迁移。

**四步**
1. `design-tokens.css` → Tailwind `@theme` 映射（`design/DESIGN.md:468` 已有规定，尚未落地），让 `bg-surface` 一类语义类可用；
2. Dialog/Sheet 统一（Radix 或现有 FocusTrap 封装），迁移 57 个文件；
3. 主按钮 253 → 1 个 `<Button variant="primary">`；
4. a11y：核心 6 页接 axe（playwright），基线只允许收缩（233 → ≤150）。

**验收**：核心 6 页新增原生 `<button>` = 0；dialog 100% 走原语；a11y 基线单调下降；密度切换对核心 6 页全部生效（现在裸 `h-9`/`px-4` 不吃密度）。

---

## 8. 定价与商业化

### 8.1 现状问题
- Free 覆盖 17/22 项 → 付费理由只有 3 个（人数 / 决策条数 / 附件大小），**都不是楔子**；
- 决策 10 条的体验不足以感受价值（第 11 条就要付费，用户还没形成习惯）；
- 价值度量是"席位"，不是"闭环"。

### 8.2 提案（不涨价，改包装与计量）

| 档 | 价格 | 限制（只限"新增"与"高级能力"，不锁数据） |
| --- | --- | --- |
| Free | 0 | ≤10 人；决策 **30 条**（体验够）；AI 提取 **20 次/月**；附件 10MB |
| Pro | ¥29.9/人/月（年付 ¥299） | 决策不限；AI 提取 300 次/月；版本 diff / PDF 导出 / 审计日志 |
| Team（后续） | 按年 | SSO / 数据保留策略 / 专属域名 |

- 升级触发点（埋点分开）：第 11 人邀请、第 31 条决策、第 21 次 AI 提取——分别看哪一类真的把人推到付费；
- 定价页加「在线体验」按钮（指向示例工作区），登录页加「查看定价」；
- 保留既有承诺：降级不删数据、取消随时、年付 14 天退款。

判断：把 AI 提取做成**计量型**价值，比"无限功能"更符合"AI 原生"的叙事，也能覆盖模型成本。

---

## 9. 度量体系

### 9.1 北极星（提案）
**每周完成闭环的决策数** = 决策落位 → 至少 1 个关联任务 → 14 天内至少 1 个任务完成。

### 9.2 漏斗（用现有 14 事件 + 需要补的 12 个）

现有：`landing_view / register_view / register_submit / click_signup / workspace_create / page_view / create_task / task_status_change / view_pricing / select_billing_period / click_upgrade / workspace_switch / filter_applied / view_saved`。

**缺口（实测）**：没有决策、邀请、AI 提取与留存事件。建议补：
`decision_created / decision_landed / decision_reviewed / task_from_decision / invite_sent / invite_accepted / ai_extract_started / ai_extract_confirmed / ai_extract_failed / first_value_reached / week_return / export_pdf`。

### 9.3 判据（试点阶段）
- 激活：注册后 24h 内完成一次 A 流程；
- 留存：7 日回访率 ≥40%；4 周留存 ≥25%（判断阈值，可按首批 2–3 个团队校准）；
- 闭环：活跃团队每周 ≥3 条闭环决策。

---

## 10. 架构方案

### 10.1 现状判断
**模块化单体**（Next.js App Router + 291 route + 99 model + RLS + cron + AI orchestrator + Tauri/PWA）是正确选择，**不要拆微服务**：
- 事务一致性 + RLS 单一 choke point 是安全卖点的来源；
- 449 个 handler 的复杂度靠域边界与注册表治理，靠拆分只会放大运维成本。

### 10.2 缺的三样东西

1. **模块注册表（单一事实源）**：`web/lib/modules/registry.ts` —— 模块 id / 名称 / 路由前缀 / 默认可见 / 依赖的权限 / 是否计费。默认可见性、feature flag、计费矩阵、Cmd+K 都从这里读。
2. **领域边界**：跨域禁止直接 import 表/SQL，只走 `modules/<domain>/service.ts`；用 eslint `no-restricted-imports` 试点 1 个域（决策→任务）。
3. **AI 能力清单**：把 17 个能力注册成 manifest（输入 schema / 所需 scope / 落位 action / 计量口径），编排器只按 manifest 执行——现在能力散在 `lib/ai/assistant/prompts/*` 与 route 里。

### 10.3 数据
- 不新增表域（90 天冻结）；决策闭环用 §6.1 的三列 + 现有外键；
- 任何新表必须 `workspaceId` + RLS 三态（ENABLE/FORCE/策略）+ 进 `check_rls_coverage.py`；无归属键的表先反查父级落列（ADR-010 已有先例）；
- 迁移必须带角色注释（属主/BYPASSRLS）——去重迁移已经踩过这个坑。

### 10.4 前端
- 组件原语（§7）+ 三态统一（empty/loading/error）：现在 56 页只有 1 个 `loading.tsx`、1 个 `error.tsx`；
- 长列表统一虚拟化/分页（多维表格与 IM 是重点）；
- 移动端复用 PWA，不做独立 RN 客户端（成本/收益不划算）。

### 10.5 部署
- **主路径**：一台 2C4G 云服务器 + compose（现成）+ Caddy 反代 + 固定域名；这是 `docs/ROADMAP-2026Q4.md §1.3` 已算过账的方案；
- **Vercel 不再是主路径**：Git 集成构建自 10-14 起从未成功（见 `docs/audit/RELEASE-READINESS-2026-10-17.md §5`），修它需要 owner 的 Vercel 凭据；本地 compose 已验证全栈；
- **桌面/移动壳**：必须先修 `corps.com / releases.corps.com`（指向别人的站点与不存在的更新主机，见 §13），否则下一次发包必炸。

---

## 11. 测试与质量

- 现状：12 道 CI 门禁全绿；但 E2E 只覆盖 auth/billing/calendar/IM/task/viewer/route-health，**核心闭环零 E2E**。
- 提案：
  1. **三条闭环 E2E**（场景 A/B/C），作为发布门槛；
  2. 新功能准入四条：E2E 或集成测试 + openapi 契约 + RLS 三态 + i18n 键齐全；
  3. AI 回归：用固定样本跑 17 个 capability 的结构化输出（已有 57 例 builder 测试可复用）；
  4. 性能：核心 6 页 LCP ≤2.5s、API P95 ≤300ms（本地/CI 条件写明）；
  5. `describe.serial` 19 处独立化（#29），否则一条失败会连带一片 "did not run"。

---

## 12. 落地路线（P0–P3）

| 阶段 | 内容 | 验收判据 | 估算 |
| --- | --- | --- | --- |
| **P0 收尾**（1 周） | 切版（含 4 条迁移，其中 1 条删数据）；正式实例 + `SMOKE_TARGET_URL`；桌面域名占位纠正；文档漂移四处；死模块登记/隐藏 | 版本可部署；smoke 有真目标；README/定价/基线数字一致 | 1 周 |
| **P1 楔子**（2–3 周） | 默认 6 模块 + 模块注册表；AI 五页并一；决策闭环三场景；3 条 E2E；12 个事件；定价页可发现 | 新用户 15 分钟完成 A；闭环事件可查；首屏 31→10 | 2–3 周 |
| **P2 设计系统**（2 周） | 11 个原语；核心 6 页迁移；Dialog 统一；axe 接入 | 原生 button 0 新增；dialog 100% 原语；a11y 233→≤150 | 2 周 |
| **P3 试点**（2 周） | 2–3 个团队邀请式试用；跑漏斗；每周复盘 | 7 日回访 ≥40%；每周闭环 ≥3/团队；决定扩张/收缩 | 2 周 |

> 估算前提：单会话并行、无新能力域、不改框架。每一阶段结束必须能回答"上一个阶段的判据是否达成"，否则不进入下一阶段。

---

## 13. 风险与"不做"清单

**风险**
1. 范围蔓延：冻结靠模块注册表落地，不靠人记；
2. 切版删数据迁移：必须 owner 点头 + 属主角色执行（`20261007000000_dedup_task_conversations`）；
3. 设计系统迁移触碰 253 处按钮/64 处弹窗：分页迁移，每页独立可回滚；
4. AI 成本：按提取次数计量 + 限额，先小样本回归；
5. 域名/部署：这是 P0 的硬前置，不是代码能补的。

**不做**
- 不删功能域（默认隐藏）；
- 不做实时协同服务端（ADR-012 已决策）；
- 不重写 UI 框架、不引入组件库全家桶；
- 90 天内不新增能力域/表/route 域（沿用 `docs/ROADMAP-2026Q4.md §3`）；
- 不做"大而全应用市场"式的插件体系。

---

## 附录 A：复现命令

```bash
# 规模
find web/app -name page.tsx | wc -l                          # 56
find web/app/api -name route.ts | wc -l                      # 291
grep -c '^model ' web/prisma/schema.prisma                   # 99
ls web/prisma/migrations | wc -l                             # 54
find web/tests -name '*.test.ts*' | wc -l                    # 114
ls web/e2e/*.spec.ts | wc -l                                 # 18
grep -rc 'test(' web/e2e/*.spec.ts | awk -F: '{s+=$2} END{print s}'   # 80

# 设计系统
grep -oE '^\s*--[a-z0-9-]+:' design/design-tokens.css | sort -u | wc -l   # 156
for t in button input select textarea; do printf "<$t> "; grep -roh "<$t" web/app web/components --include=*.tsx | wc -l; done
grep -rn 'role="dialog"' web/app web/components --include=*.tsx | wc -l    # 64
find web/components -type f \( -name '*.ts' -o -name '*.tsx' \) | wc -l             # 286
find web/components -type f \( -name '*.ts' -o -name '*.tsx' \) -print0 | xargs -0 cat | wc -l  # 78773
grep -roh 'bg-\[var(--accent)\]' web/app web/components --include=*.tsx | wc -l  # 253
awk 'NF&&$1!~/^#/{n++;s+=$3}END{print n,s}' web/tests/a11y-baseline.txt   # 176 233

# 死负载（每条都应输出空）
grep -rn "@/components/mail" web/app web/components --include="*.tsx"
grep -rn "@/components/todo" web/app web/components --include="*.tsx"
grep -rn "@/components/remote-control" web/app web/components --include="*.tsx"
grep -rn "ChatPanel" web/app --include="*.tsx" | grep -v "TaskChatPanel\|AiChatPanel"

# 事件
grep -rhoE 'track\("[a-z0-9_]+"' web/app web/components web/lib | sort -u

# 发布/漂移
git rev-list --count v0.7.2..origin/main                     # 389
grep -m1 '"@prisma/client"' web/package.json                 # 7.10.1（README 写 Prisma 6）
grep -n "¥59" docs/market/competitive-analysis.md            # 与 pricing.ts 的 29.9 不一致
```

**证据说明**：本文中"死模块零挂载""无 E2E 覆盖""事件缺口""文档漂移"四类结论都来自上表可复跑命令；"会不会受欢迎"与各阶段估算属判断，已明确标注。
