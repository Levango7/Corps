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
| 产品设计（对象与流程） | **核心合理，闭环缺证据** | 决策记录有版本留痕 + 双向回链，是全仓唯一真空位；但事件只记到「决策被创建」（服务端 `create_decision`），没有「决策真的落位成任务」的信号，无法证明闭环发生（更正见 §9.2） |
| 功能设计 | **广度与深度不匹配** | 任务/决策/文档/IM/审批有页面+测试；mail/todo/remote-control/sync/旧聊天树是「组件+API+i18n 齐全但零挂载」；E2E 完全不覆盖文档/多维表/审批/工作流/AI |
| UI | **令牌合格，交互不一致** | 156 个设计令牌 + 双主题/密度/租户色；但通用组件层只有 1 个 `FocusTrap`，903 个原生 `<button>`、64 处自建 `role="dialog"`、253 处主按钮类复制、233 条 a11y 基线违规 |
| 信息架构 | **修了一半** | 28 项平铺 → 5 组已落地；但**默认可见性没有分层**——高频与一年点一次的功能在首屏同等权重 |

### 0.2 这样的产品会受用户欢迎吗？

**按现状不会。** 这是判断，不是市场预测，判据如下（都可被证伪）：

1. **没有前门。** 应用根路径直接 `redirect(/auth/login)`（`web/app/[locale]/page.tsx:12`）；定价页只能从工作区计费页进（`web/app/[locale]/w/[wid]/billing/page.tsx:280`）；README 自述「在线体验：暂无固定域名实例」。一个 0 用户的 0.7.x 产品，前门是登录页。
2. **楔子被广度淹没。** 侧栏 31 个静态入口里，「决策记录」只是其中一项；AI 五页并列（`layout.tsx:442-457`）。新用户 15 分钟内看不到"讨论→决策→任务"这条唯一差异化链路。
3. **闭环不可度量。** 两侧事件名实测（截至 main `6755db21`）：客户端 `track()` 14 个、服务端 `trackServerEvent` 13 个、并集去重 25 个。缺的不是「决策事件」——`create_decision`、`invite_member`、`invite_accepted`、`activation_completed` 早就在服务端发；留存也不是缺口（D1/D7/D30 已由 `CORE_EVENTS` 派生算出，见 §9.2）。真正缺的是**落位信号**：决策的行动项同步出任务（`decision_landed`）、导出分享（`export_pdf`）、AI 提取（`ai_extract_*`）。另有一处实测到的静默失效：`workspace_create` 客户端一直在发，但从未进白名单，服务端对白名单外事件**静默丢弃** ⇒ 这一步在漏斗里等于不存在。也就是说：即使有人用，也证明不了"他们把决议变成了动作"。

**可翻转的支点（判断）：** 「讨论结论自动落位成任务与决策记录」在竞品矩阵里确实是空位（`docs/market/competitive-analysis.md:23` 自述，Trello/Linear/Notion/飞书都没有原生覆盖）。它现在的问题不是"idea 不行"，而是**没有把这一件事做成 10 倍好、并放在用户看得见的地方**。

### 0.3 补 / 纠偏 / 移除（三张清单）

**需要补充（5）**
1. 一个能被访问的正式实例 + 一个 60 秒可体验的示例工作区（当前 0 实例）。
2. 决策闭环的「提取 → 确认 → 落位 → 复盘」四步产品化（现在只有对象，没有流水线）。
3. 通用组件原语（11 个）+ 对话框统一（现在 903 个原生按钮、64 个自建弹窗）。
4. 闭环事件与漏斗（决策闭环率）。进度（截至 2026-10-21）：`decision_landed` / `export_pdf` / 补开 `workspace_create` 闸门 + 埋点契约门禁已提 PR #138；仍缺的只有 `decision_reviewed` 与 `ai_extract_*`（`week_return`、`first_value_reached` 是我重复造的轮子，已撤回，见 §9.2）。
5. 移动端「3 分钟捕捉决议」入口（决议多数发生在会议/聊天里，不在电脑前）。

**需要纠偏（4）**
1. 定位口径统一到一句话，README / 站点 / 定价页 / roadmap 共用一处事实源；**AI 从卖点降为辅助**（用户 2026-10-20 拍板：这是办公系统，AI 只是辅助角色）。
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
| 事件 | 客户端 `track()` 14 名 + 服务端 `trackServerEvent` 13 名（并集去重 25）；白名单 34 名，其中 `workspace_create` 发了但没开闸 ⇒ 静默丢弃 | 附录 A |

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

### 2.4 文档与事实的漂移（**2026-10-20 已在 P0 修复**）

| 位置 | 写的 | 实际（实测） |
| --- | --- | --- |
| `README.md:104` | Prisma 6 | `@prisma/client` **7.10.1** |
| `docs/market/competitive-analysis.md:14` | ¥59/人/月 | ¥29.9/人/月（`web/lib/pricing.ts`） |
| `web/tests/a11y-baseline.txt:29-38` | 头部统计合计 363 | 数据行合计 **233** |
| `docs/market/competitive-analysis.md:14` | 定位"轻量任务中心" | 30+ 域、449 handler |

判断：这类漂移在商务场景是硬伤——客户按文档报价会发现不一致，评审按文档看能力会高估。
> 修复记录：以上四处已随 P0 提交改为 Prisma 7.10 / ¥29.9 / 233 / 「协作办公系统 + AI 辅助」口径。

---

## 3. 定位重述（提案）

> **用户 2026-10-20 的定位口径（本节方案即按此收敛）：这是办公系统，AI 只是辅助角色。**
> 因此对外不主张「AI 原生平台」，AI 只作为减少重复劳动的助手出现在具体步骤里。

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

判断：定位收敛后，AI 不再是并列卖点，而是**实现楔子的手段**（从会议/聊天/文档里提取决议）；按用户 10-20 的口径，它是办公系统的辅助角色，不是产品标签。

---

## 4. 核心场景与验收口径

### 场景 A：会后落位（主场景，H4 决策闭环率的来源；北极星仍是已批的 WAW，见 §9.1）
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

### 9.1 北极星：与已批准口径对齐（**2026-10-21 自我更正**）

初稿这里直接写「北极星 = 每周完成闭环的决策数」，**这是一处越权**：
`docs/analytics/FUNNEL-METRICS.md` 的状态是 **ACCEPTED（2026-08-26 用户拍板）**，
§2.1 已把北极星定为 **WAW（周活跃工作区数）**，并把「首周完成 ≥3 任务团队占比」降级为护栏 H1。
一份后写的产品方案不能静默替换一份已批准的决定——所以本节改为「对齐 + 提案」，取舍权回到用户手里。

| 指标 | 出处与状态 | 它回答什么 | 它答不了什么 |
| --- | --- | --- | --- |
| WAW（北极星） | FUNNEL-METRICS §2.1，**已批准但实测未实现**（见 §9.1.1） | 有没有更多团队在用（规模，且 workspace 就是付费单元） | 用得是不是我们的差异化能力——WAW 涨、楔子死掉是可能的 |
| H1 首周激活率 / H2 协作深度 / H3 转付费意向 | FUNNEL-METRICS §3，**已批准** | 激活质量与商业意向 | 同样不覆盖"决策是否真的落位" |
| **决策闭环率**（本文提案，暂命名 H4） | 本文 §9.2，事件随 PR #138 落 | 楔子（讨论→决策→任务）有没有真的跑起来 | 样本极小时周间噪声大（这正是当初 WAW 胜出北极星的理由） |

**提案（待用户裁决，不自行生效）**：北极星**保持 WAW 不动**；把决策闭环率作为 **H4 护栏**加进
FUNNEL-METRICS §3 的护栏序列，与 H1 同层。两周试点先取数，若它比 WAW 更能预判去留，
再走一次 FUNNEL-METRICS 的状态变更来谈替换——而不是由这份设计文档单方面改口径。

理由与已批文档自身的逻辑一致：§2.2 判 WAW 胜出的关键维度是「规模信息 + 与付费单元对齐」，
比率型指标承载不了；而 §2.2 同时承认「激活质量必须有人看守，否则虚假繁荣」——
**楔子质量就是同一个坑的新变体**，所以它该进护栏序列，而不是挤掉北极星。

### 9.1.1 实测：北极星没有落地，而且有一张**量纲错标**的卡（2026-10-21 发现）

复跑命令与三处出处的原文行号：

| 事实 | 出处 |
| --- | --- |
| 全仓只有 **1 个** analytics 路由，且是工作区级 `…/workspaces/{wid}/analytics/overview` | `find web/app/api -path "*analytics*" -name route.ts` → 唯一一条 |
| 该路由自己写明：「本工作区内：当前周 CORE_EVENTS 去重 userId；**全局 WAW 跨工作区聚合另设端点，此处仅出工作区内值**」 | [overview/route.ts:176-177](file:///F:/Nexus/corps-reverify-1017/web/app/api/v1/workspaces/%5Bwid%5D/analytics/overview/route.ts#L176) |
| `waw.users` 实际算的是**本周本工作区去重 userId**（不是工作区数） | 同文件 :180-189 |
| 分析页把这个数渲染成标题为「**WAW 周活跃工作区**」的北极星卡（星标、占 2 列） | [analytics/page.tsx:159-166](file:///F:/Nexus/corps-reverify-1017/web/app/%5Blocale%5D/w/%5Bwid%5D/analytics/page.tsx#L159)、`web/messages/zh.json:1128` |

**为什么这比"没实现"更糟**：单工作区语境里真正的 WAW 恒等于 1，所以卡片显示的绝不可能是工作区数；
但它顶着「周活跃工作区」的标题。读它的人会以为"本周 7 个团队在用"，实际是"本团队 7 个人活跃"。
**已批口径的名字被挂到了一个代理指标上**——这类卡比没有卡更危险，因为它给出的是可复算的错误结论。

**结构性缺口（需要用户决策，不是我能顺手修的）**：WAW、全局留存、收入这类**平台运营方视角**的指标，
在这个产品里**没有归属面**——整个应用从路由到权限都是租户内闭环（`runWithWorkspace` + `analytics:read` 限 owner/admin，
且限本工作区）。要真读北极星，只有两条路：
1. 加一个跨工作区的运营端点（新契约 path、新的平台方权限模型、OpenAPI + API Contract Check 都要跟）；
2. 或者承认北极星只能靠**直接查库的固定 SQL**（我可以把 SQL 落到 `docs/analytics/`，作为试点期口径）。

我建议先走 2（试点只要一个数，不需要一个产品面），把 1 留到有真实多租户运营需求时。
在选定的那条路落地之前，**先把那张卡改名**（「本工作区本周核心活跃人数」），错标不能留在界面上过夜。

### 9.2 事件基线与缺口（**2026-10-20 更正**）

> 初稿这里写「现有 14 事件 + 需补 12 个」「服务端只有支付 webhook 的 3 个」，
> 并把 `decision_created` / `invite_sent` 列为缺失。复核后三处都不准：
> 单行 `grep -rhoE 'track\("[a-z0-9_]+"'` 只扫得到**客户端**，天然数不到服务端调用点。
> 下面按两侧分别实测，并给出可复跑判据。

**实测（截至 main `6755db21`）**

| 侧 | 去重事件名数 | 与闭环/留存相关的已有项 |
| --- | --- | --- |
| 客户端 `track("x")` | 14 | `landing_view`、`click_signup`、`workspace_create`（**未开闸**）、`create_task`、`task_status_change`、`view_pricing`、`select_billing_period`、`click_upgrade`、`filter_applied`、`view_saved`、`page_view`、`workspace_switch`、`register_view`、`register_submit` |
| 服务端 `trackServerEvent({name})` | 13 | `register_success`、`login_success`、`activation_completed`、**`create_decision`**、`create_task`、`task_status_change`、`invite_member`、**`invite_accepted`**、`billing_checkout`、`payment_failed`、`subscription_activated` / `_renewed` / `_churned` |

并集去重 25（`create_task` 与 `task_status_change` 两侧都发）。白名单 34 名。

**两个真实缺陷**（不是"事件太少"这么简单）：
1. `workspace_create` 客户端在发、白名单没有 ⇒ 服务端静默丢弃。这类「事件已打、闸门未开」
   在两侧都不报错，靠人审表看不出来，所以必须有一道**从源码扫调用点**的门禁（PR #138 已加）。
2. 决策链只记到「被创建」，没记「落位成任务」。`create_decision` 证明有人写了决议，
   不证明决议变成了动作——楔子的差异化恰恰在后者。

**缺口（2026-10-21 二次更正）**：真正缺的只有 `decision_reviewed`（复盘）与
`ai_extract_started` / `_confirmed` / `_failed`。

初稿这里列的 12 个"缺口事件"，复核 FUNNEL-METRICS（ACCEPTED）与 overview API 的实际实现后，
有 5 个是我重复造轮子，撤回：

| 初稿提案 | 为什么不该加 |
| --- | --- |
| `decision_created` | 已有服务端事件 `create_decision`，不新造同义词 |
| `invite_sent` | 已有 `invite_member` |
| `task_from_decision` | `decision_landed` 的 `createdTasks` / `linkedTasks` 已带这个维度 |
| `week_return` | **D1/D7/D30 回访率不是事件，是派生指标**：已按已批口径（注册日后第 n 个 Asia/Shanghai 自然日出现 ≥1 次 `CORE_EVENTS`）实现于 overview API 的 `retention` 字段。再加一个 `week_return` 事件只会造出第二个事实源，两套口径必然漂移 |
| `first_value_reached` | 已批口径用 `activation_completed`（register_success 后 15min 内他派 create_task，幂等标记）承担首值达成，H1 就是它 |

教训记一条：**提"补埋点"之前先查该指标是否已有派生口径**。留存/首值这两条我差点用新事件去
重复实现已有的派生计算——加事件比改派生便宜，但代价是同一件事出现两个数。

**H4 决策闭环率的可测性**（初稿写的三步，逐格标注现在到底能不能算）：

| 步骤 | 靠什么算 | 状态 |
| --- | --- | --- |
| 决策落位 | `decision_landed`（`actionSync.tasks` 非空才发） | PR #138 |
| 至少 1 个关联任务 | 同事件的 `linkedTasks` / `createdTasks` props + `DecisionActionItem.taskId` 回链 | PR #138 |
| 14 天内至少 1 个任务完成 | **现在算不出来**：`Task` 只有 `status`（todo/in_progress/review/done）+ `updatedAt`，**没有完成时间戳**，`updatedAt` 会被后续任何编辑顶掉 | 需 §6.1 补字段才能兑现 |

所以初稿那句「决策落位 → ≥1 关联任务 → **14 天内**完成」，第三步是空头支票。
不加迁移就能算的近似口径有两个，但**都必须标注口径、不能伪装成时序指标**：
1. 闭环 = 该决策 ≥1 个关联任务**当前** `status = done`（展示要写「按当前状态」）；
2. 或直接用 `DecisionActionItem.checked`（行动项在决策正文里被勾掉）算完成度。
要真正的"14 天内完成"，得给 `Task` 加 `completedAt`（可空列 + 迁移），归入 §6.1 单独点头。

判据：闭环率要能在 `/analytics` 或一条固定 SQL 里读出来，不接受"临时手写脚本"。

### 9.3 判据（试点阶段）
口径一律**沿用 FUNNEL-METRICS（ACCEPTED）的既有定义**，不自造第二套：

- 激活：用 **H1 首周激活率**——注册后 7 天内完成「首任务创建且指派给他人」的工作区 / 新增工作区，
  已批阈值 ≥40%。（初稿写的"24h 内完成一次 A 流程"是我另起炉灶，作废。）
- 留存：用已实现的 `retention.d7` / `retention.d30`（D_n 派生自 `CORE_EVENTS`，见 §9.2）。
  初稿的"≥40% / ≥25%"两个数字**不是已批阈值**，改为"先取两周基线，再定去留线"。
- 闭环：H4 决策闭环率（§9.1/§9.2），口径按 §9.2 的近似定义（当前 `status = done`）。
  **试点期不设百分比门槛**：2–3 个团队的样本下任何比率都不具统计意义，
  只看绝对数与周趋势（多少条闭环、有没有连续两周 >0）。
- WAW（北极星，已批）：作为"是否有人在用"的分母背景，与 H4 并排看——
  WAW 涨而 H4 为 0，就是"用了但没用对"，这正是要 H4 的原因。

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
| **P1 楔子**（2–3 周） | 默认 6 模块 + 模块注册表；AI 五页并一；决策闭环三场景；3 条 E2E；事件缺口补 6 名（§9.2 更正后口径，其中 3 名已随 PR #138 交付）；定价页可发现 | 新用户 15 分钟完成 A；闭环事件可查；首屏 31→10 | 2–3 周 |
| **P2 设计系统**（2 周） | 11 个原语；核心 6 页迁移；Dialog 统一；axe 接入 | 原生 button 0 新增；dialog 100% 原语；a11y 233→≤150 | 2 周 |
| **P3 试点**（2 周） | 2–3 个团队邀请式试用；跑漏斗；每周复盘 | 判据口径按 §9.3 沿用已批定义（H1、`retention.d7`、H4 绝对数与周趋势），**不新设阈值**；据此决定扩张/收缩 | 2 周 |

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

# 事件（**两侧都要扫**；单行 grep 只数得到客户端，初稿就栽在这里）
grep -rhoE '\btrack\(\s*"[a-z0-9_]+"' web/app web/components web/lib | sed -E 's/.*"([a-z0-9_]+)"/\1/' | sort -u
grep -rlU 'trackServerEvent(' web/app web/lib          # 先定位调用点，再逐个读 name 字段
npx vitest run web/tests/unit/analytics-event-contract.test.ts   # 两侧事件名 ⊆ 白名单 + 计数==集合大小

# 发布/漂移
git rev-list --count v0.7.2..origin/main                     # 389
grep -m1 '"@prisma/client"' web/package.json                 # 7.10.1（README 写 Prisma 6）
grep -n "¥59" docs/market/competitive-analysis.md            # 与 pricing.ts 的 29.9 不一致
```

**证据说明**：本文中"死模块零挂载""无 E2E 覆盖""文档漂移"三类结论都来自上表可复跑命令；"会不会受欢迎"与各阶段估算属判断，已明确标注。
**一处自我更正**：初稿的"事件缺口"结论虽也来自上表命令，但那条命令只扫客户端，导致服务端 13 个事件被数成 3 个、
`create_decision` / `invite_accepted` 被误判为缺失（§9.2 已按两侧实测重写）。教训：**探针自证目标**——
扫描命令覆盖的调用面必须先确认与声称的范围一致，否则错的是量具不是被测量。

**二处自我更正（2026-10-21）**：初稿 §9.1 直接另立北极星、§9.2 提 12 个"缺口事件"，都没有先读
`docs/analytics/FUNNEL-METRICS.md`——它是 **ACCEPTED（2026-08-26 用户拍板）**，北极星已定为 WAW，
且 D_n 回访 / 首值激活都是**已实现的派生口径**。结果是：我越权替换了一个已批准的决定，
并给 5 个已有承担方的指标各造了一个同义事件（§9.1/§9.2/§9.3 已改为"沿用 + 提案 H4，待裁决"）。
教训：**提"补埋点/立指标"前先查该文档是否已有批准口径**——加事件比改派生便宜，
但代价是同一件事出现两个数，而两个数必然漂移。
