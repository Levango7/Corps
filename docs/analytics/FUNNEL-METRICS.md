# corps 漏斗埋点指标体系完善方案（FUNNEL-METRICS）

- **日期**：2026-08-26
- **状态**：ACCEPTED（2026-08-26 用户拍板通过——北极星 WAW、护栏 H1-H3、9 个新增事件与 props 增强、统计口径修正 D1-D3 全部批准；埋点实施列入开发排期）
- **维护**：平台能力决策分析师｜依据：SPEC.md §2（P2 数据埋点）、§9 AC-07、现有埋点实现代码
- **关联**：web/app/api/v1/events/route.ts（事件白名单）、web/lib/analytics.ts（客户端 SDK）、web/lib/analytics-server.ts（服务端打点）、web/app/api/v1/workspaces/[wid]/analytics/overview/route.ts（统计口径）、docs/decisions/ADR-008-国际化方案.md（S1 触发信号依赖本文档的 landing_view）

---

## 1. 背景与现状盘点

### 1.1 现有资产

表：现有埋点资产对照表

| 资产 | 内容 | 出处 |
|------|------|------|
| 存储 | AnalyticsEvent 表（id/userId 可空/workspaceId 可空/name/props Json/sessionId 可空/createdAt Timestamptz），含 [name,createdAt]/[userId,createdAt]/[workspaceId,createdAt]/[sessionId,createdAt] 四索引 | web/prisma/schema.prisma L321–341 |
| 写入通道① | POST /api/v1/events：批量 ≤50 条/批、zod 校验、限流 120 次/分/IP、匿名允许（userId=null）、白名单过滤 | web/app/api/v1/events/route.ts |
| 写入通道② | trackServerEvent：runWithAuthOp("provision") 逃生口 + 失败静默 | web/lib/analytics-server.ts |
| 客户端 SDK | 批量缓冲 20 条 + 5 秒兜底 flush + visibilitychange/beforeunload/pagehide + sendBeacon；sessionId 存 localStorage（30 分钟 TTL 续期） | web/lib/analytics.ts |
| 统计接口 | GET …/analytics/overview：五步漏斗计数 + 14 天每日趋势 + Top8 事件 + 活跃用户数，仅 owner/admin | web/app/api/v1/workspaces/[wid]/analytics/overview/route.ts |
| 展示面板 | /w/[wid]/analytics：漏斗条形图 + SVG 折线 + 热门事件列表 | web/app/w/[wid]/analytics/page.tsx |

### 1.2 实际已埋事件 vs 白名单缺口

经代码核实（grep `track(`/`trackServerEvent(`），实际打点的事件共 **9 个**：

表：实际已埋事件盘点表

| 事件 | 打点端 | 触发位置 |
|------|--------|----------|
| register_success | 服务端 | api/v1/auth/register/route.ts L77，props={plan,seatLimit} |
| login_success | 服务端 | api/v1/auth/login/route.ts L67 |
| create_task | 服务端 | api/v1/workspaces/[wid]/tasks/route.ts L97，props={priority,status,hasAssignee,hasDueDate} |
| task_status_change | 双端 | board/page.tsx L175（客户端拖拽）+ tasks/[id]/route.ts L129（服务端 PATCH） |
| create_decision | 服务端 | tasks/[id]/decisions/route.ts L92 |
| invite_member | 服务端 | members/invite/route.ts L209，props 仅 {role} |
| billing_checkout | 服务端 | billing/checkout/route.ts L95 |
| page_view | 客户端 | w/[wid]/layout.tsx L67 —— **仅登录区触发，落地页/auth 页无覆盖** |
| workspace_switch | 客户端 | w/[wid]/layout.tsx L186 |

而 events/route.ts 的 ALLOWED_EVENT_NAMES 白名单定义了 **21 个**事件名。以下 **11 个「已进白名单但从未打点」**：

> register_view、register_submit、login_view、login_submit、onboarding_start、onboarding_complete、onboarding_skip、create_comment、billing_view、billing_success、billing_cancel

结论：现状是「白名单超前、实际覆盖不足」，且统计口径存在三处缺陷：

| 缺陷编号 | 问题 | 出处 |
|----------|------|------|
| D1 | 每日聚合用 `toISOString().slice(0,10)` 取 UTC 日界，与中国用户 UTC+8 日界错位 8 小时（北京时间 0 点后的事件被计入前一个 UTC 日的桶） | overview/route.ts L76 |
| D2 | 「漏斗」为各步骤独立去重用户数，未按用户事件序列约束先后（做了 create_decision 但从未 register 的脏数据也计入末步）；且 login 不属于「注册转化」语义，invite_member/create_decision 是并行行为而非串行漏斗步骤 | overview/route.ts L19–25、L50–64 |
| D3 | sessionId 已入库且有 [sessionId,createdAt] 索引，但所有统计均未使用，无法重建会话级漏斗 | schema.prisma L340 与 overview 实现 |

---

## 2. 北极星指标

### 2.1 定义

> **北极星指标 = WAW（Weekly Active Workspaces，周活跃工作区数）**
>
> 一个自然周（周一 00:00 Asia/Shanghai 起，7 天）内产生 ≥1 次「核心行为事件」的去重 workspaceId 计数。
>
> 核心行为事件集 CORE_EVENTS = { session_start, create_task, task_status_change, create_comment, create_decision, invite_member }。
> 刻意排除 page_view/workspace_switch/login_success 等低价值信号——「打开看一眼」不构成团队价值证据。

### 2.2 候选对比与选择理由

任务书给出两个候选：「周活跃工作区数 WAW」或「首周完成 ≥3 任务的团队占比」。对比：

| 维度 | WAW | 首周完成≥3任务团队占比 |
|------|-----|------------------------|
| 指标类型 | 规模型存量指标（分子分母同向增长） | 质量型比率指标（早期样本小、周间噪声大） |
| 与商业单元一致性 | subscriptions 表以 workspace_id 为付费单元（SPEC §6），WAW≈可收费单位池 | 间接 |
| 团队价值表达 | 协作产品孤岛用户无留存价值，workspace 粒度天然贴近「团队在用」 | 直接表达激活质量 |
| 可每周稳定跟踪 | 是 | 是（但波动大） |
| 是否适合当北极星 | **是** | 否——更适合做护栏指标 |

**结论**：北极星取 WAW（规模方向 + 商业对齐）；「首周完成 ≥3 任务团队占比」降级为护栏指标 H1。理由：北极星需要同时回答「产品在被更多团队使用吗」，比率型指标无法承载规模信息；而激活质量必须有人看守，否则会出现「注册量涨、激活烂」的虚假繁荣。

### 2.3 护栏指标（Counter Metrics）

表：护栏指标定义表

| 编号 | 指标 | 定义 | 初始目标（拍板值，运行 8 周后校准） |
|------|------|------|------------------------------------|
| H1 | 首周激活率 | 注册后 7 天内完成「首任务创建且指派给他人」的工作区数 / 新增工作区数 | ≥ 40% |
| H2 | 协作深度率 | WAW 中该周 ≥2 名成员产生核心行为的工作区占比 | ≥ 50% |
| H3 | 免费转付费意向 | 该周 billing_checkout 的工作区数 / WAW | ≥ 5%（M3 定价上线后生效） |

### 2.4 计算口径（SQL 示例）

```sql
-- SQL功能名：WAW 周活跃工作区数（严格口径，Asia/Shanghai 周界）
SELECT COUNT(DISTINCT workspace_id) AS waw
FROM analytics_events
WHERE workspace_id IS NOT NULL
  AND name = ANY(:core_events)                 -- §2.1 核心行为集
  AND (created_at AT TIME ZONE 'Asia/Shanghai') >= :week_start_local  -- 周一 00:00 UTC+8
  AND (created_at AT TIME ZONE 'Asia/Shanghai') <  :week_end_local;
```

---

## 3. AARRR 漏斗完整映射

### 3.1 Acquisition（获取）

**目标链路**：访问落地页 → 点击注册 CTA → 提交注册表单 → 注册成功。

**现状判定：不够。**

| 缺口 | 说明 |
|------|------|
| 无 landing_view | page_view 只在登录区 layout 打点（w/[wid]/layout.tsx L67），营销落地页/auth 页完全无覆盖，「有多少人看到产品」不可知 |
| 无 click_signup | 无法区分「看了不感兴趣」与「想注册但在表单流失」 |
| register_view/register_submit 白名单已有但未打点 | 注册页曝光/提交两步缺失，注册表单流失定位不了 |
| 无来源归因 | referrer/utm 未采集，渠道投放无从评估 |

**目标序列与转化率**：

```
landing_view ──→ click_signup ──→ register_submit ──→ register_success
        CTR1=click/landing   CTR2=submit/click    CVR=success/submit
```

归因规则：referrer/utm_* 仅在 landing_view 首次采集（first-touch），写入该事件的 props 并随 sessionId 传播（见 §6.1）。

### 3.2 Activation（激活）

**SPEC 口径（AC-07）**：新用户完成注册后，引导流程必须在 15 分钟内可完成「创建首个任务并指派」。

**验证所需事件序列**：`register_success(t0)` → `create_task(props.hasAssignee=true 且 props.selfAssigned=false 且 t−t0 ≤ 15min)`。

**现状判定：差两块拼图。**

| 缺口 | 说明 |
|------|------|
| hasAssignee 不区分自派/他派 | 现 props 只有 hasAssignee（tasks/route.ts L104）。AC-07 语义是「指派」（协作动作），自建自派是单人行为，二者激活质量完全不同。需增加 selfAssigned 字段 |
| 无幂等激活标记 | 若靠查询实时 join 判定，每次都要扫全量 create_task 对时间窗；且「15 分钟」窗口关闭后的迟到激活会漏计。应由服务端在满足条件瞬间打一条 activation_completed（每工作区至多一次），统计退化为简单 count |

**目标序列**：

```
register_success(t0) ──→ onboarding_*（M2 引导流程上线后补埋）──→ create_task(selfAssigned=false)
                                    │
              t−t0 ≤ 15min 且首任务 ──→ activation_completed（服务端幂等标记）
```

激活率 = activation_completed 数 / register_success 数（按工作区维度）。

### 3.3 Retention（留存）

**回访定义**：以 register_success 所在日为 D0（Asia/Shanghai 日界），第 D_n 个自然日当天该用户产生 ≥1 次核心行为事件（CORE_EVENTS，§2.1），记为 D_n 回访。D1/D7/D30 为标准观察点。

**活跃判定的两个层次**：

| 层次 | 判定依据 | 用途 |
|------|----------|------|
| 会话级 | session_start 事件（新增） | 回访次数、频次、session 时长近似 |
| 用户级 | CORE_EVENTS 任一 | WAU/D_n 回访（比现 overview 的「任意事件含 page_view 即算活跃」更严格、更真实） |

**现状判定：缺 session_start。** sessionId 由 localStorage 管理（30 分钟 TTL，analytics.ts L36–57），但新建会话时没有任何显式事件，导致「一个用户今天来了几次」「隔了几天回来」全部不可计算。另注：现有 activeUsers 口径（overview/route.ts L99–108，14 天任意事件去重 userId）应废弃，替换为 WAU（严格口径）。

### 3.4 Revenue（收入）

**目标链路**：`billing_checkout`（点击升级）→ `subscription_activated`（webhook 确认开通）→ `subscription_renewed`（周期续费）；旁路 `payment_failed` / `subscription_churned`。

**现状判定：只有入口，无确认闭环。**

| 缺口 | 说明 |
|------|------|
| billing_checkout 之后无服务端确认 | webhook/route.ts 已处理 checkout.session.completed（L49）等 4 类事件但不打点；客户端 success_url 回跳不可靠（关页/延迟），不能作为开通依据 |
| 无续费事件 | 当前 webhook 未监听 invoice.paid，续费收入完全不可见 |
| 无失败/流失事件 | invoice.payment_failed 有处理逻辑（L108）无打点，AC-09 催缴效果无法评估；customer.subscription.deleted（L178）同理 |

**关键原则**：Revenue 段一律以服务端 webhook 打点为准，客户端 billing_success/billing_cancel 仅作辅助信号（其白名单保留，但看板不采用）。

**漏斗**：checkout 转化率 = subscription_activated / billing_checkout；90 天续费率 = subscription_renewed / subscription_activated（按工作区 cohort）。

### 3.5 Referral（推荐）

**目标链路**：`invite_member`（邀请者发出）→ `invite_accepted`(被邀请者接受入区)。可选延伸：接受者后续 register_success 带 channel="invite" 归因。

**现状判定：断头路。**

| 缺口 | 说明 |
|------|------|
| 无 invite_accepted | 接受端点已存在（api/v1/invitations/[token]/accept/route.ts L32，且有 acceptedAt 幂等标记 L87/L110），但成功分支无打点。「发了多少邀请」与「多少人真的进来」之间是盲区 |
| invite_member props 过薄 | 仅 {role}（members/invite/route.ts L213），缺 channel(link/email)、发出时席位占用率，无法分析「哪种邀请方式接受率高」 |
| 注册无来源归因 | register_success props 无 channel，自然注册与邀请注册混在一起，K 因子算不出 |

**病毒环雏形**：K ≈ 人均发出邀请数（invite_member / WAW）× 接受率（invite_accepted / invite_member）。

### 3.6 AARRR 总映射表

表：AARRR 漏斗总映射表

| 阶段 | 目标序列 | 现有覆盖 | 缺失 | 核心转化率 |
|------|----------|----------|------|------------|
| Acquisition | landing_view → click_signup → register_submit → register_success | 仅尾步 | 前 3 步全缺 + utm 归因 | 访问→注册成功率 |
| Activation | register_success → create_task(他派) ≤15min → activation_completed | 首尾事件有 | selfAssigned 字段、activation_completed 幂等标记 | 激活率（H1 同源） |
| Retention | session_start / CORE_EVENTS 按 D_n 分布 | page_view（粗口径） | session_start；严格 WAU 口径 | D1/D7/D30 |
| Revenue | billing_checkout → subscription_activated → subscription_renewed | 仅 checkout | 3 个 webhook 侧事件 + invoice.paid 监听 | 开通率、续费率 |
| Referral | invite_member → invite_accepted | 仅发出侧 | invite_accepted + props 增强 + 注册归因 | 邀请接受率、K 因子 |

---

## 4. 缺失事件清单

### 4.1 新增事件（9 个）

命名沿用现白名单 snake_case 风格；props 一律扁平、不含 PII（对齐 events/route.ts 注释红线）。打点端 S=服务端（trackServerEvent）/ C=客户端（track）。

表：新增事件定义表

| # | 事件名 | 端 | 触发时机 | props 结构 | 优先级 |
|---|--------|----|----------|------------|--------|
| 1 | landing_view | C | 营销落地页渲染完成后（匿名允许） | { referrer, utmSource?, utmMedium?, utmCampaign?, path, locale } | P0 |
| 2 | click_signup | C | 任一注册 CTA onClick | { cta: "header"\|"hero"\|"pricing", path } | P0 |
| 3 | session_start | C | getSessionId() 新建 sid 分支内同步打点（续期分支不打） | { referrer?, language, screenW } | P0 |
| 4 | activation_completed | S | create_task 成功事务后判定：本工作区首个任务 且 hasAssignee 且 !selfAssigned 且距 register_success ≤15min；查重保证每工作区至多一条 | { taskId, minutesSinceRegister } | P0 |
| 5 | invite_accepted | S | POST /invitations/[token]/accept 成功分支（含「已是成员直接标记 accepted」幂等路径只打一次） | { inviterUserId, channel: "link"\|"email", waitedHours } | P0 |
| 6 | subscription_activated | S | webhook checkout.session.completed 分支成功更新 Subscription 后 | { plan, quantity } | P0 |
| 7 | payment_failed | S | webhook invoice.payment_failed 分支 | { attempt?: number } | P1 |
| 8 | subscription_renewed | S | webhook 新增 invoice.paid case 且 billing_reason="subscription_cycle" | { quantity, amountMinor } （金额存最小货币单位整数） | P1 |
| 9 | subscription_churned | S | webhook customer.subscription.deleted 分支 | { reason? } | P1 |

> webhook 侧打点的 userId 取 metadata 中的 owner id 或留空（workspaceId 必填），失败静默沿用 analytics-server.ts 既有约定，绝不阻塞 Stripe 应答。

### 4.2 既有事件 props 增强（不加新事件名）

| 事件 | 增加 props | 动机 | 改动位置 |
|------|------------|------|----------|
| create_task | selfAssigned: boolean（assigneeId === ctx.payload.sub） | AC-07 他派判定 | tasks/route.ts L101–107 |
| invite_member | channel: "link"\|"email"; seatUsage: n/limit | 渠道与紧迫度分析 | members/invite/route.ts L209–214 |
| register_success | channel: "organic"\|"invite"; inviteWorkspaceId? | 获客归因闭环 | auth/register/route.ts L77–82 |
| task_status_change | toStatus 统一键名（客户端 spread patch 已隐式携带，需固化键名避免双端不一致） | 完成任务数可统计 | board/page.tsx L175 |
| page_view | 补 auth 区与落地页覆盖（或由 landing_view 替代落地页职责） | 全站曝光基线 | w/[wid]/layout.tsx L67 |

### 4.3 事件白名单更新（events/route.ts）

ALLOWED_EVENT_NAMES 需追加 9 个：`landing_view`、`click_signup`、`session_start`、`activation_completed`、`invite_accepted`、`subscription_activated`、`payment_failed`、`subscription_renewed`、`subscription_churned`。同时建议将白名单常量拆出为 `lib/analytics-whitelist.ts` 单一事实源，客户端 SDK 与服务端共用（当前客户端 track() 无本地校验，非法名会被服务端静默丢弃，排障困难——可在 dev 环境 console.warn 白名单外事件）。

---

## 5. 看板设计（analytics 页面图表优先级)

| 优先级 | 图表 | 口径 | 数据来源改造 |
|--------|------|------|--------------|
| P0 | 北极星卡：WAW + 周环比 | §2.1 严格口径 | overview API 增加 waw 字段 |
| P0 | AARRR 主漏斗：landing→signup点击→提交→注册→激活 | 序列化漏斗（§6.3 序列约束） | 重写 FUNNEL_STEPS：剔除 login/decision 两类伪步骤，改为两段漏斗（获客段+激活段） |
| P0 | 激活质量卡：H1 首周激活率 + 中位耗时 minutesSinceRegister | activation_completed 聚合 | 同上 API |
| P0 | 留存条：D1/D7/D30 回访率 | §3.3 定义，Asia/Shanghai 日界 | 新增 retention 查询 |
| P1 | Revenue 漏斗：checkout→activated→renewed + churn 标记 | §3.4 | overview API 增加 revenue 段 |
| P1 | Referral 环：发出→接受→接受者激活 | §3.5 | 同上 |
| P1 | 每日趋势折线（保留现有 SVG 折线） | 修复时区后原样保留 | 仅修 D1 缺陷 |
| P2 | Cohort 留存矩阵（周粒度三角阵） | 按 register 周 cohort | 新增 cohort 查询，注意查询成本 |
| P2 | 功能采用率：决策记录/评论/搜索的 WAW 内渗透率 | 各核心事件去重 wid / WAW | 复用现有 groupBy |

设计约束沿用现有页面：零第三方图表库、纯 token 变量色、lucide-react 图标（analytics/page.tsx 头注释既有约定）。

---

## 6. 数据质量保障

### 6.1 session 归因规则

1. sessionId 生成与 TTL：localStorage 键 corps_analytics_sid，30 分钟无活动过期，活动即续期（analytics.ts L36–57）。跨天连续使用视为同一会话——这是有意为之，留存统计依赖「天」而非「会话」，不受影响。
2. first-touch 归因：utm/referrer 仅在 landing_view 采集一次；后续事件不重复采集。查询时以 sessionId 关联到 landing_view.props 取渠道。窗口期 = sessionId 生命周期（30 分钟），超时后新会话重新归因（last session wins，工程上最简且偏差可控）。
3. 匿名→登录衔接：POST /events 对未认证请求 userId=null（events/route.ts L68–70）。同一 sessionId 内，注册成功后的事件自动携带 userId，无需显式合并逻辑。

### 6.2 身份合并（identity stitching）

- 规则：同一 sessionId 下 userId=null 与非 null 并存时，漏斗归属取该 sessionId 内**最早的非空 userId**。
- 局限声明（接受误差）：换设备/清缓存/隐私模式会造成同一人多个 sessionId、多个匿名身份。中小团队 B2B 场景下以 workspace 维度聚合（北极星 WAW）天然稀释此误差，不做跨设备 identity graph（明确过度设计，不做）。

### 6.3 去重规则

| 场景 | 规则 |
|------|------|
| 入口过滤 | 白名单外事件直接丢弃（events/route.ts L75 既有机制） |
| 传输重复 | fetch keepalive/sendBeacon 网络层重试可能造成同批重复写入；对幂等事件（activation_completed、subscription_*）查询侧按 (workspace_id,name) 取 min(created_at)；非幂等事件接受近似值（B2B 体量下影响 <1%） |
| 业务唯一 | register_success 按 userId 取首次；activation_completed 服务端写入前查重（每工作区至多一条，兜底再靠查询侧 min） |
| 序列漏斗 | 严格漏斗以「用户(或工作区)事件按 createdAt 排序后的子序列匹配」实现，替代现 overview 的独立计数（D2 缺陷修复）：某用户必须在前序步骤之后发生后续事件才计入下一步 |

### 6.4 时区处理（中国 UTC+8）

- **缺陷 D1 必须修复**：overview/route.ts L76 `toISOString().slice(0,10)` 为 UTC 日界。修复任选其一：
  - SQL 聚合层：`(created_at AT TIME ZONE 'Asia/Shanghai')::date`；
  - JS 内存层：`new Date(e.createdAt.getTime() + 8 * 3600_000).toISOString().slice(0, 10)`。
- 统一日界约定：所有「日」（DAU/D_n/日趋势）按 Asia/Shanghai 自然日；所有「周」（WAW/cohort）以周一 00:00 UTC+8 为起点（中国业务习惯）；数据库存储保持 Timestamptz（UTC 物理存储不变，仅在聚合边界换算）。

### 6.5 容量与限流边界

- 上报上限：120 req/min/IP × 50 events/batch（events/route.ts L61），20 条即 flush 的客户端策略下单工作区正常流量远低于阈值；异常洪泛由限流拦截。
- 存储估算：单行 <200B（props <1KB 上限但典型远小）；假设 1000 WAW × 5 成员 × 50 核心事件/周 ≈ 25 万行/周 ≈ 50MB/月量级，PostgreSQL 直存可行，暂不需要 OLAP 外移（每季度复核一次增速）。
- 查询保护：overview 类聚合接口已有 owner/admin 权限门槛；cohort/WAW 查询必须走 [workspaceId, createdAt] 与 [name, createdAt] 索引（schema 已备），禁止全表扫描型查询进入请求路径。

### 6.6 PII 红线（沿承既有约定）

props 禁存邮箱/姓名/IP/邀请 token 明文；金额只存 amountMinor 整数；stripeSubId 等第三方标识不入 props（订阅事实以 quantity/plan 为准）。

---

## 7. 工程改造清单

表：工程改造清单（预估基于现有代码结构）

| 文件 | 改动 | 优先级 | 预估 |
|------|------|--------|------|
| web/app/api/v1/events/route.ts | 白名单 +9；白名单抽出共享模块；dev 环境非法名 warn | P0 | 0.5h |
| web/lib/analytics.ts | session_start 触发（getSessionId 新建分支）；captureLandingAttribution() 助手（解析 utm/referrer） | P0 | 0.5d |
| 落地页组件（marketing 页，随 M2/M3 页面落地） | landing_view + click_signup 打点 | P0 | 0.5d |
| web/app/api/v1/workspaces/[wid]/tasks/route.ts | create_task +selfAssigned；事务后首任务激活判定 → activation_completed | P0 | 0.5d |
| web/app/api/v1/invitations/[token]/accept/route.ts | 成功分支 invite_accepted（含幂等路径查重） | P0 | 2h |
| web/app/api/v1/billing/webhook/route.ts | 三个既有 case 追加打点 + 新增 invoice.paid case | P0 | 0.5d |
| web/app/api/v1/auth/register/route.ts | register_success +channel/inviteWorkspaceId | P1 | 2h |
| web/app/api/v1/workspaces/[wid]/members/invite/route.ts | invite_member +channel/seatUsage | P1 | 1h |
| web/app/api/v1/workspaces/[wid]/analytics/overview/route.ts | 时区修复（D1）；序列化严格漏斗（D2）；新增 waw/retention/revenue/referral 字段 | P0 | 2d |
| web/app/w/[wid]/analytics/page.tsx | §5 的 P0 四图先行，P1 三图第二批 | P0/P1 | 2d + 1.5d |
| docs/market/product-roadmap.md | M3 埋点条目按本清单细化（P0 约 4–4.5 人日，P1 约 3 人日，合计约 1.5 周，略超原 1 周估算，建议 P0 先行） | P1 | — |

**P0 合计约 4–4.5 人日**（与 roadmap M3 给数据埋点预留的 1 周基本吻合，P1 项顺延一周内消化）。

---

## 8. 开放问题

| 编号 | 问题 | 建议 |
|------|------|------|
| Q1 | landing_view 依赖营销落地页，该页面尚未在 roadmap 明确排期（auth/register_view 可先顶替获客段入口） | M2 Beta 上线前确认 |
| Q2 | activation_completed 的 15 分钟窗口是否放宽（AC-07 是验收口径而非用户现实节奏） | 先按 SPEC 严格执行，8 周后按分布数据复议 |
| Q3 | subscription_renewed 需要 webhook 增加 invoice.paid 监听，属计费域改动 | 与 ADR-005 维护者对齐后再动 webhook |
| Q4 | 海外流量占比（ADR-008 S1 信号）依赖 landing_view.locale，locale 取 navigator.language 还是 IP GeoIP | 先用 navigator.language（零成本），GeoIP 待 CloudBase 环境确认 header 支持 |

---

## 附：口径速查卡

```
WAW          = 一周内(周一00:00起, UTC+8) CORE_EVENTS 去重 workspace 数
CORE_EVENTS  = session_start | create_task | task_status_change | create_comment | create_decision | invite_member
激活         = register_success 后 15min 内 create_task(hasAssignee && !selfAssigned)，幂等标记 activation_completed
回访 D_n     = 注册日后第 n 个 Asia/Shanghai 自然日出现 ≥1 次 CORE_EVENTS
开通         = 以 webhook subscription_activated 为准，不信客户端 success_url 回跳
推荐闭环     = invite_accepted / invite_member；K ≈ (invite_member/WAW) × 接受率
一切"日/周"  = Asia/Shanghai 边界；物理存储恒为 Timestamptz(UTC)
```