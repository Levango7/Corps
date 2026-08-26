# 三线设计审核报告

> 日期：2026-08-26 ｜ 审核人：三线设计审核员（任务 #92）
> 待审对象：docs/design/pricing-page-impl-design.md（#89 定价线）、docs/design/analytics-instrumentation-design.md（#90 埋点线）、docs/design/payment-provider-refactor-design.md（#91 支付线）
> 权威依据（均 ACCEPTED 冻结）：docs/market/pricing-page-spec.md、docs/market/pricing-strategy.md、docs/analytics/FUNNEL-METRICS.md、docs/decisions/ADR-003-计费方案.md §5、docs/decisions/ADR-008-国际化方案.md
> 审核方式：逐份对照权威依据 ＋ 对文档引用的代码事实做源码抽查复核 ＋ 跨线协调裁决。本报告只评审不代改；修改由各线实现者按本报告执行。

---

## 第1章 总体结论表

表：总体结论对照表

| 文档 | 结论 | BLOCKER | MAJOR | MINOR | 一句话评语 |
|------|------|---------|-------|-------|------------|
| pricing-page-impl-design.md（定价线） | **需修改** | 0 | 4 | 3 | 调研扎实、代码事实引用几乎全部属实；但 §5.1 单方面否决 landing_view 属越权，且与埋点线/支付线存在三处同文件双线改动冲突 |
| analytics-instrumentation-design.md（埋点线） | **需修改** | 0 | 3 | 3 | 行号校准认真、幂等与时区分析质量高；activation 判定块缺失败隔离是唯一实质技术缺陷，另须承接跨线边界登记义务 |
| payment-provider-refactor-design.md（支付线） | **需修改** | 1 | 2 | 3 | 三份中架构论证最强（四方法合并/路径兼容/行为保全清单均成立）；但 migration 窗口「影响可控」论断错误，DROP 旧表会造成 webhook 事件静默永久丢失 |

合计：1 项 BLOCKER、9 项 MAJOR、9 项 MINOR，无否决项。BLOCKER/MAJOR 按「第4章 放行条件」修订完成后即可进入实现阶段；MINOR 可在实现 PR 中顺带处理。

---

## 第2章 逐份详审

### 2.1 定价线：pricing-page-impl-design.md

#### 2.1.1 代码事实抽查结果

表：定价线关键断言抽查结果对照表

| 断言 | 抽查结果 |
|------|----------|
| middleware.ts（131 行）无登录重定向，仅 CSRF/CORS/CSP nonce/HSTS 四职责 | ✅ 属实。全文核对无任何 auth 重定向；matcher L130 含 `/(.*)` 但仅用于注入安全响应头。「/pricing 天然公开可达、middleware 零改动」结论成立 |
| lucide-react 精确锁定 0.513.0；SquareKanban 主名 declare 于 d.ts L17554、`SquareKanban as KanbanSquare` 别名存在；GitBranch/ShieldCheck/Check/ChevronDown/ArrowRight 原生 declare；TriangleAlert as AlertTriangle 先例 | ✅ 全部属实（实测 dist/lucide-react.d.ts：别名命中 1 处；五图标原生 declare 位于 L9169/L16293/L4112/L4151/L1148）。`import { SquareKanban as KanbanSquare }` 决策正确 |
| predev/prebuild 复制方向为 design/design-tokens.css → web/app/design-tokens.css | ✅ 属实（package.json scripts L7/L9）。「Token 只改 design/ 源文件」的团队约定必要且正确 |
| 根 layout headers() 读 nonce 致全站退出静态生成；prerender-manifest 仅 /_global-error | ✅ 属实（layout.tsx L12 await headers()；实测 .next 产物唯一 .html 为 _global-error.html）。放弃 SSG/ISR 的论证链成立 |
| checkoutSchema 仅 priceId/successUrl/cancelUrl 三字段；trackServerEvent props 现状 { seatLimit } | ✅ 属实（checkout/route.ts L7–11、L97–102） |
| signup 页已有 window.location.search 读 invite 先例（L28–47） | ✅ 属实（L29–30 注释明示规避 useSearchParams Suspense 约束） |
| events/route.ts ALLOWED_EVENT_NAMES 共 22 个事件名 | ❌ 有误：L21–46 实数 **20 个**（9 注册激活＋5 核心激活＋2 留存＋4 转化）。见 P1-5 |

#### 2.1.2 规格符合性（A 维度）

1. CTA 目标 `/auth?src=pricing` 适配为 `/auth/signup?src=pricing`：实际路由确无裸 /auth（web/app/auth/{login,signup}/page.tsx），适配合理，且已按 R1 登记 PR 披露与 spec 勘误流程——处理规范。
2. PRICING_PLANS/FAQ 六条/对比表/九区块/年付默认选中/社会证明条件渲染/断点行为均与 spec §3–§7 一致；验收对照发现 spec 验收项在第 9 节而非第 8 节并已澄清，无漏项。
3. 唯一实质偏离：§5.1 对 landing_view 的「裁定建议」（见 P1-1）与 §3.4 click_signup 映射裁定（见 P1-2）——两处均涉及对平行冻结口径（FUNNEL-METRICS）的单方面处置，越权，须按裁决书修订。

#### 2.1.3 问题清单

编号规则：P1-x 为定价线条目，级别分 BLOCKER／MAJOR／MINOR。

| 编号 | 级别 | 问题 | 修改建议 |
|------|------|------|----------|
| P1-1 | MAJOR（跨线·裁决1） | §5.1「landing_view 本期不进白名单、不打点，名称留给未来营销首页」单方面废弃了 FUNNEL-METRICS（ACCEPTED）的 P0 事件与 ADR-008 S1 依赖信号；一条设计线无权否定另一份冻结权威文档的口径 | 按「第3章 裁决1」修订 §5.1：接受 PublicPageTracker 自动覆盖 /pricing（landing_view＝全站公开页曝光基线），本页自身仍只实现 spec §8 三事件；新增「与 landing_view 的语义边界」小节互相注明 |
| P1-2 | MAJOR（跨线·裁决1附属） | §5.1 将 click_signup 映射进 click_upgrade 的裁定未与埋点线漏斗定义对齐：FUNNEL-METRICS §3.1 获客段第二步依赖 click_signup，若 /pricing 不打该事件而埋点线不知情，上线后会被当作数据缺失排查 | 与埋点线按「裁决1附属」对齐：/pricing 四 CTA 只打 click_upgrade；埋点线在漏斗匹配器文档中登记「/pricing 来源跳过 click_signup 属预期跳步」；click_signup 本期落地范围收敛为 auth/login 页注册链接 |
| P1-3 | MAJOR（跨线·裁决4） | 第2章依赖交付项 D1 要改 signup/page.tsx 并使 register_success props 增加 src 字段（隐含还要改 auth/register/route.ts），与埋点线对同两文件的改造计划正面冲突 | D1 从「本任务交付项」改写为「移交埋点线的对接需求输入」：src 参数读取与透传由埋点线在 signup/page.tsx/register/route.ts 改造中一次成型；本线 e2e 归因链路验收（spec §9）依赖其交付后联调 |
| P1-4 | MAJOR（跨线·裁决3） | 第2章 #6 要改 checkout/route.ts（schema 加 period、props 扩 { seatLimit, period }），与支付线对该路由的整体重构冲突；且支付线 §4.1 目前声称埋点「不变」，两端认知不一致 | checkout/route.ts 改动归属支付线（含 period schema 与 props.period 两项需求）；本文档 §5.4/R4 改写为对接契约引用（见「裁决3」契约六要点），不再自列该文件改动 |
| P1-5 | MINOR | 白名单计数「共 22 个」错误（实为 20 个） | 更正为 20；顺带说明上游 FUNNEL-METRICS §1.2 的「21」亦不准确（见 P2-4） |
| P1-6 | MINOR（内部一致性） | §3.1 结论段称「另抽两个组件」且目录树只列 PricingSection/PricingViewTracker，与第2章清单及 §5.3 末尾「修正为三个文件」残留矛盾 | 定稿前统一：components/pricing/ 下三个文件（PricingSection/PricingViewTracker/TrackedCta），删除「文中修正文」式补丁表述 |
| P1-7 | MINOR（可实施性） | D1/D2 依赖交付项未纳入工时估算汇总，spec §10 的 0.5 周预算未复核是否覆盖 D1 移交后的联调成本 | 补充本线工时小结并标注 D1 已移交埋点线计价 |

#### 2.1.4 优点摘要（审核确认项）

middleware 零改动结论以实测证据砍掉一项计划内改动；SSG 决策论证链完整（prerender-manifest 实证 → revalidate 无效 → route groups 列后续项）；tokens 双文件覆盖机制风险披露准确（--space-5=22px 等 trap 均核实无误）；TrackedCta 解决服务端区块沾染客户端行为的选型论证清晰；R7 Footer 占位、R8 双主题目检等非功能性风险登记完整。

### 2.2 埋点线：analytics-instrumentation-design.md

#### 2.2.1 代码事实抽查结果

表：埋点线关键断言抽查结果对照表

| 断言 | 抽查结果 |
|------|----------|
| trackServerEvent 入参不含 sessionId，写入时该列恒 null；签名 userId: string 必填 | ✅ 属实（analytics-server.ts 全文 33 行，create data 无 sessionId 字段；L29 还将 userId 传入 runWithAuthOp 第三参——见 P3-5 的类型适配提醒） |
| overview daily 为 JS 内存聚合（findMany＋for 循环）、UTC 日界缺陷在 toISOString().slice(0,10) | ✅ 属实（route.ts L63–80、缺陷行 L72）。D1 选 JS 侧 +8h 修复的选型依据成立 |
| FUNNEL_STEPS 五步伪漏斗（L19–25）、activeUsers「14 天任意事件去重 userId」过松 | ✅ 属实（L19–25、L95–103） |
| tasks/route.ts POST 回调返回 { invalidAssignee, task } 结构可扩展 isFirstTask | ✅ 属实（L64/L72 现状结构与伪代码吻合）；create_task 打点 L95–105 ✓ |
| accept/route.ts acceptedAt 一次性消费：L55 二次请求 410 拦截、L113 result.full 幂等路径 | ✅ 属实（实测 L55/L107/L113） |
| invite/route.ts 打点实际 L199–205（修正上游 L209 偏差）；L28 已有全局 prisma 直查 user 先例 | ✅ 两处均属实。行号校准工作真实可信 |
| board/page.tsx L193 客户端 task_status_change 用 spread patch 隐式携带键名 | ✅ 属实（`track("task_status_change", { batch:true, count:resp.updated, ...patch })`） |
| w/[wid]/layout.tsx page_view=L73、workspace_switch=L192 | ✅ 属实 |
| 白名单「21 个」 | ❌ 实数 **20 个**（源头为 FUNNEL-METRICS §1.2 自身的计数偏差，本文自称逐行实测却未纠出）。见 P2-4 |

#### 2.2.2 技术正确性复核（B 维度）

1. **D1 固定 +8h**：中国无夏令时，UTC+8 固定偏移数学正确；shanghaiWeekKey 以周一 00:00 UTC+8 为界的 `(getUTCDay()+6)%7` 回推公式验证正确；物理存储保持 Timestamptz 不动的口径与 FUNNEL-METRICS §6.4 一致。**通过**。
2. **activation 幂等并发窗口分析**：「事务内 count 可读到历史已提交事件、仅毫秒级并发双写窗口＋查询侧 min 兜底＋partial unique index 列二期加固」的分层判断成立；但存在两处实现级问题（P2-1 失败隔离缺失、§2.4.2 文字与 §2.4.3 伪代码的执行位置表述不一致），见问题清单。
3. **webhook async parseWebhook 修正必要性**（支付线主张，本文档 §2.7 配合）：checkout.session.completed 分支确需 subscriptions.retrieve 补 quantity（webhook/route.ts L73–79），同步签名无法承载，异步化必要。两线对 invoice.paid 过滤 billing_reason="subscription_cycle"、amountMinor 整数的设计完全一致，无冲突。**通过**。
4. **session_start 注入方式**：绕开 track() 二次调用避免递归、SSR 卫语句、隐私模式降级三层分析到位；与 landing_view 职责切分（回访信号 vs 渠道归因载体）清晰。**通过**。
5. **t0 取 users.createdAt**：对批准文档「register_success(t0)」的实现级细化有完整候选对比论证（观测副本 vs 业务事实），方向保守健壮且已在 §2.4.3 口径备注声明与 Q2 一并复议——判定为「可接受的口径细化」，不设条目，建议指标负责人知悉即可。

#### 2.2.3 问题清单

| 编号 | 级别 | 问题 | 修改建议 |
|------|------|------|----------|
| P2-1 | MAJOR | §2.4.3 activation 判定块的 user.findUnique ＋ analyticsEvent.count 直查无任何 try-catch 包裹：一旦抛错（全局 prisma 实例读 analytics_events 是否受 RLS SELECT 策略拦截未经验证；或瞬时网络故障），将使 create_task 主接口 500——违反项目「埋点失败不阻塞主流程」既有约定（tasks/route.ts 现有打点依赖 trackServerEvent 自身 .catch 静默，本新增块打破该防线） | 整个判定块包 try-catch 失败静默；同时建议把 dupCount 查询移入主事务内用 tx.count（既消除 RLS 疑问又与 §2.4.2「事务内随任务创建一并 count」文字对齐），并在单测补「查询抛错时主接口仍 200」用例 |
| P2-2 | MAJOR（跨线·裁决2） | analytics-server.ts 将被本线（加 sessionId 参数）与支付线（userId 放宽 string|null）双向修改；本文档未声明独占归属，也未给出含 runWithAuthOp 第三参适配的目标签名终态 | 按「裁决2」在 §7 阶段 1 显式声明：本线独占 analytics-server.ts 改造，一次成型目标签名为 `trackServerEvent(data: { userId?: string \| null; workspaceId: string \| null; sessionId?: string; name; props? })`，内部 `data.userId ?? undefined` 传 runWithAuthOp、`data.userId ?? null` 入库；支付线只消费不得并行修改 |
| P2-3 | MAJOR（跨线·裁决1附属） | 漏斗定义未登记「/pricing 来源无 click_signup 步骤」的预期跳步规则；click_signup 落点表写了「未来 /pricing 与营销页 CTA 同式接入」，与定价线「/pricing 只打 click_upgrade」的裁定冲突 | §4.2 获客段定义处登记跳步规则说明；§2.1 #2 click_signup 本期落地范围收敛为 auth/login 页注册链接，删除「未来 /pricing 同式接入」表述（改引裁决书） |
| P2-4 | MINOR | 白名单基数「21 → 30」错误（20 → 29）；§6.1 快照测试断言「含 30 名」会直接失败 | 更正基数为 20/29；快照测试以代码实数为准 |
| P2-5 | MINOR | clientSessionId 采用请求体字段（O3 倾向）但未给 zod 形态约束；analytics_events.session_id 列为 varchar(64)，超长输入会被 PG 截断报错后遭 .catch 静默丢弃 | 明确 zod 校验 `z.string().max(64)`（对齐 events/route.ts eventSchema.sessionId 先例），写入 O3 的落地建议 |
| P2-6 | MINOR | §2.7 ①注释「置于 L59 runWithAuthOp(...) 调用之后」字面可误读为「发起之后」而非「resolve 之后」 | 统一改为「runWithAuthOp 回调 resolve 之后（对应现状 webhook/route.ts L102 之后）」，与放置原则 1 措辞一致 |

#### 2.2.4 优点摘要（审核确认项）

对上游批准文档的行号逐一实测校准并如实登记偏差（invite_member L199–205 等 7 处修正全部属实）；landing_view 载体三候选对比与「公开路由守卫组件＋path 维度拆解消化 /auth/* 口径稀释」方案合理，O4 登记开放问题的边界意识好；PII 防线完整（token 明文不入 props、utm 截断 128、仅识别 utm_ 前缀键）；白名单抽出单一事实源＋同 PR 合入防「事件已打闸门未开」的顺序设计周到；阶段化实施顺序与 4.5 人日估算与批准文档 §7 吻合。

### 2.3 支付线：payment-provider-refactor-design.md

#### 2.3.1 代码事实抽查结果

表：支付线关键断言抽查结果对照表

| 断言 | 抽查结果 |
|------|----------|
| webhook/route.ts 现状：secret 未配置 500（L13–18）、await req.text()、验签失败 400、幂等 processedStripeEvent.create＋catch(null) 返回 duplicate、四分支结构 | ✅ 属实（L38–47 幂等、L51–108/L110–125/L126–178/L179–203 四分支与文档行号逐一吻合） |
| customer.subscription.deleted 分支只降 plan 不回落 seatLimit，与 updated 分支不对称 | ✅ 属实（L194–199 仅 update plan:"free"；对比 L156 回落 FREE_SEAT_LIMIT）。「冻结不顺手修」的行为保全纪律正确 |
| AnalyticsEvent.userId 为 uuid nullable（schema.prisma L327）；trackServerEvent userId: string 必填；空串将被 PG invalid uuid 拒绝且被 .catch 静默吞掉 → webhook 四埋点会全军覆没 | ✅ 属实。签名放宽为 `userId?: string \| null` 是 FUNNEL-METRICS L230「userId 或留空」的唯一正确兑现路径，论证成立 |
| ADR-003 正文 L25 三方法（含 syncSubscription/handleWebhook）与 §5 草案三方法（createPortal/parseWebhook）互相矛盾；members/[uid]/route.ts L118–127 存在真实 Stripe quantity 同步调用 | ✅ 属实。四方法合并论证（以「覆盖全部现存 Stripe 调用点」为验收标准）充分 |
| db/schema.sql subscriptions_status_check 五值 CHECK；processed_stripe_events 仅 pkey | ✅ 属实。SubscriptionStatus 类型与之严格一致的要求合理 |
| checkout/portal/status 三路由的行号引用（Owner 403 L50–55、safeRedirectUrl L20–44、quantity clamp L90、metadata L93、stripeReady L36–37、canManage L43 等） | ✅ 全部属实 |

#### 2.3.2 技术正确性复核（B 维度）

1. **【BLOCKER】migration up 含 DROP TABLE processed_stripe_events ＋ §6.4「migration 先行、代码紧随……webhook 会短暂 500，Stripe 会自动重试补投，影响可控」——论断错误**。现状幂等占位是 `prisma.processedStripeEvent.create(...).catch(() => null)`，create 因「表不存在」抛出的任何异常都会被吞成 null，随后走「已处理过」分支**返回 200 { duplicate: true }**——Stripe 收到 200 即停止重试。即迁移窗口内到达旧代码实例的资金敏感事件（订阅开通/扣款失败）不是「短暂 500 可重试」，而是**被静默应答后永久丢失**，直接转化为「开了会员没生效」客诉。滚动发布排水期内存活的旧实例同样中招，「同批滚动」并不能消除该风险。修复方案见 P3-1。
2. **parseWebhook 异步化**：必要（见 2.2.2-3），metadata.seats 优先＋retrieve fallback 的兼容设计保留防御深度。**通过**。
3. **period 缺省 monthly＋yearly 未配置显式 400 不静默降级**：商业资损分析正确（静默降级＝月付单价扣费却预期年付权益）；对存量客户端零影响。**通过**。
4. **migration up/down 数据零丢失复核**：up 的回填 'stripe' 前提（subscriptions 仅由 webhook checkout 分支 upsert 产生）经源码核实成立；down 从新表搬回 stripe 行再删列，Phase 1 单通道时期数据可逆。唯一缺口即 P3-1 的 DROP 时机。
5. **webhook 路径保留决策（D2）**：「丢事件风险不对称」论证与 ADR-003 落地要点 3 原文（每通道独立子路径）吻合，否决改名备选的理由充分。**通过**。

#### 2.3.3 问题清单

| 编号 | 级别 | 问题 | 修改建议 |
|------|------|------|----------|
| P3-1 | **BLOCKER** | §6.3 up migration 末尾 `DROP TABLE "processed_stripe_events"` ＋ §6.4「短暂 500＋Stripe 自动重试补投，影响可控」论证错误：旧代码 `.catch(()=>null)` 把「表不存在」误判为幂等命中并返回 200，事件被静默永久丢弃（证据：webhook/route.ts L38–47） | ① 将 DROP 旧表移出本批 migration（up 只做：加两列→回填→建新表→INSERT SELECT 搬数据；DROP 留给下一次清理迁移，并在 down 中对称处理）；② 「migrate 与应用同批滚动」从可选建议升格为硬性上线约束写入 §6.4 与测试计划；③ §9 新增「迁移窗口行为」集成用例：旧表保留期新旧代码并存时，重复 evt 在跨表场景下的行为断言（新表无记录的重投会重复处理，因落库全为 upsert/updateMany 幂等而副作用≈0，须写明该取舍）；④ 更正 §6.4 论述文字 |
| P3-2 | MAJOR（跨线·裁决3） | §4.1 埋点行写「不变」，与定价线要交付的 spec §8 要点 4（props 扩 { seatLimit, period }）冲突；checkout/route.ts 同时被本线整体重构与定价线增量改造双向认领 | checkout/route.ts 归本线独占重构，并将两项定价线需求并入附录 A 清单：请求体 zod 增 `period: z.enum(["monthly","yearly"]).optional()`（缺省 monthly）、billing_checkout props 扩为 `{ seatLimit, period }`；§4.1 埋点行相应修订；新增「与定价线对接契约」小节载明契约六要点（见裁决3） |
| P3-3 | MAJOR（跨线·裁决1附属/裁决2） | §5.5 配套改动 1（trackServerEvent 放宽）与配套改动 2（白名单＋4）均与埋点线范围重叠，未声明归属与合流规则 | 配套 1 改为「依赖埋点线阶段 1 交付的目标签名，本线只消费；若排期倒挂则按埋点线终态签名自行落地、合流以埋点线版本为准」；配套 2 改为「白名单由埋点线一次性扩齐 16 名并抽出 lib/analytics-whitelist.ts，本线不再单独改 events/route.ts」（16＝FUNNEL 9＋spec §8 的 view_pricing/select_billing_period/click_upgrade 3＋webhook 4） |
| P3-4 | MINOR | §4.3 stripeReady「getPaymentProviderSafe() 返回 null（未配置密钥）」与 §3 惰性构造不自洽：constructor 已不检查 secret（延迟到 requireClient），secret 缺失时 Safe 出口将返回非 null 实例，stripeReady 可能误报 true（现状为 false），前端升级入口误显示、点击后才得 400 | 补充约定：getPaymentProviderSafe 内部除捕获 not_configured 外，对 StripeProvider 额外探测 STRIPE_SECRET_KEY 就绪性（如导出 isConfigured 属性），保持「secret 或价格缺失 ⇒ stripeReady=false」的现状语义 |
| P3-5 | MINOR | §5.5 配套改动 1 只写了「内部 data.userId ?? null」，遗漏 analytics-server.ts L29 向 runWithAuthOp 第三参（`userId?: string`）传值的类型适配 | 补一句：runWithAuthOp 第三参改传 `data.userId ?? undefined`（auth.ts L119–125 签名不变），否则 TS 编译不过 |
| P3-7 | MINOR | 新增 STRIPE_PRICE_ID_YEARLY 属配置增量，而 ADR-003 §6（L181）已宣布「STRIPE_PRICE_ID 配置自即日起冻结」——不构成违反（新增非变更），但缺披露动作 | 并入附录 B 勘误建议：随 ADR-003 勘误注记一并登记年付变量增量；同时在 .env.example 注释标注 portal return_url 依赖 NEXT_PUBLIC_APP_URL 生产必配 |

#### 2.3.4 优点摘要（审核确认项）

四方法合并、seats 收口路由层、priceOverride 兼容、period 可选化四处草案偏差全部有据论证且方向正确；D2 webhook 路径保留的丢事件风险分析到位；§5.6 行为保全清单（六条红线含 deleted 不回落 seatLimit 的现状不对称冻结）是三份文档中最好的验收纪律样本；payment.succeeded 第五变体「只打点不落库」的类型级意图表达清晰；幂等表复合主键泛化＋新旧对照的 pg_dump 流程完备；注册表工厂惰性读取的三条理由（构建期求值/运行时聚焦/测试注入）全部成立。

---

## 第3章 跨线协调裁决书

裁决原则：两份 ACCEPTED 冻结文档（pricing-page-spec §8 与 FUNNEL-METRICS）在交叉点上均有约束力，任何一条设计线不得单方面废弃另一份的口径；冲突通过「语义分工＋文件归属唯一＋契约节落纸」化解。

### 3.1 裁决一：埋点双轨命名（landing_view vs view_pricing）——**共存，按语义分域**

- **结论**：两者共存，不互斥。landing_view＝全站公开页曝光基线（获客段漏斗第一步＋ADR-008 S1 国际化信号载体）；view_pricing＝定价页专属曝光与 spec §9 白名单联调事件。/pricing 单次 PV 两条事件并存：各自独立会话去重（landing_view 按 (sid,path) 模块级 Set、view_pricing 按 sessionStorage），无重复刷量；漏斗各走各的——获客段用 landing_view（path=/pricing 可过滤），spec §8 的 view_pricing→click_upgrade→billing_checkout 转化漏斗用 view_pricing。
- **白名单归属**：PublicPageTracker 与 PUBLIC_LANDING_ROUTES（含 "/pricing"、"/auth/*"）由**埋点线单一线维护**；定价页上线对该组件与白名单零感知、零改动。events/route.ts 的 ALLOWED_EVENT_NAMES 由**埋点线一次性扩齐 16 名**并抽出 lib/analytics-whitelist.ts 单一事实源（16＝FUNNEL-METRICS 9＋spec §8 三事件 3＋支付线 webhook 四事件 4），定价线/支付线只消费；若支付线排期倒挂需临时自扩 4 名，合流时以埋点线版本为准。
- **附属裁决（click_signup）**：/pricing 四 CTA 只打 spec §8 的 click_upgrade（定价线独占）；click_signup 本期落地范围收敛为 auth/login 页注册链接（埋点线独占）；埋点线漏斗匹配器登记「/pricing 来源跳过 click_signup 属预期跳步」——匹配器本就允许跳步，register_submit 计数不受影响，「点击意愿」信号由 click_upgrade 单独承载。理由：同一意图双打会造成 CTR 分子重复计数，比少一格漏斗步骤危害更大；未来独立营销首页出现后 click_signup 自然获得真实落点。
- **落实位置**：埋点线 §5.3 增补「与 view_pricing/click_upgrade 的边界」小节、§4.2 增补跳步规则、§2.1 #2 收敛落点范围；定价线 §5.1 撤销「本期不打 landing_view」的单方裁定改为边界声明；支付线 §5.5 配套改动 2 改为消费白名单模块（对应 P1-1/P1-2/P2-3/P3-3）。

### 3.2 裁决二：trackServerEvent 签名改造——**归埋点线独占，支付线只消费**

- **结论**：analytics-server.ts 的全部改造（`userId?: string | null` 放宽＋`sessionId?: string` 新增＋runWithAuthOp 第三参 `?? undefined` 适配）由埋点线在其阶段 1 一次成型，目标签名写入埋点线文档作为终态契约；支付线 webhook 四埋点只消费该签名，不得并行修改该文件。
- **排期规则**：支付线实现排在埋点线阶段 1 之后；若倒挂，支付线可按埋点线文档载明的终态签名自行落地最小实现，合流时以埋点线版本为准（签名一致即无合并冲突）。
- **落实位置**：埋点线 §7 阶段 1 声明独占并写终态签名（P2-2）；支付线 §5.5 配套改动 1 改写为依赖声明（P3-3/P3-5）。

### 3.3 裁决三：checkout period 链路——**两端契约一致已核实，改动归支付线，契约落纸**

- **核对结果**：字段名 `period`、枚举 `"monthly" | "yearly"`、optional、缺省 monthly、yearly 未配置→400「年付价格未配置」（unsupported_period）——定价线 §5.4/第2章 #6 与支付线 §2 CheckoutRequest/§4.1 两端完全一致，无字段名/枚举值/缺省行为分歧。
- **归属**：checkout/route.ts 由支付线整体重构独占；定价线的两项需求（zod 增 period 枚举、billing_checkout props 扩 { seatLimit, period }）并入支付线清单交付。
- **必须披露的现状断层**：Phase 1 定价页年付默认选中只作用于展示与 click_upgrade 归因；注册进 app 后 billing 页 upgrade() 暂传 `period: undefined`（仅打通管道），年付实际下单依赖 billing 周期 UI 后续迭代——此断层定价线 R4 已登记，须在两份文档的对接契约节互相引用，避免验收时误判「年付转化链路已闭环」。
- **对接契约六要点**（写入两份文档）：①请求体字段 period:string 枚举 monthly|yearly 可选；②缺省 monthly；③非法值由 zod 400 兜底；④yearly 且 STRIPE_PRICE_ID_YEARLY 未配置→400 文案「年付价格未配置」，绝不静默降级；⑤响应信封不变 `{ code:200, data:{ url } }`；⑥billing_checkout props 为 { seatLimit, period? }，period 缺省时键可省略。
- **落实位置**：支付线 §4.1 埋点行修订＋新增「与定价线对接契约」小节（P3-2）；定价线第2章 #6 移除、§5.4/R4 改为契约引用（P1-4）。

### 3.4 裁决四：signup/page.tsx 与 auth/register/route.ts——**归埋点线独占，src 归因作需求输入移交**

- **结论**：signup/page.tsx（register_view/register_submit 打点、inviteToken 上送、clientSessionId 上送、**src 参数读取与透传**）与 auth/register/route.ts（zod 加 inviteToken/clientSessionId、register_success props 一次成型＝{ plan, seatLimit, channel, inviteWorkspaceId?, src?, sessionId? }）均由埋点线单线改造。定价线的 ?src=pricing 归因是纯增量字段需求，被埋点线改造面天然覆盖，作为需求输入移交后 D1 关闭。
- **理由**：同文件双线改必然冲突；props 一次成型避免 register_success 被两轮改造；spec §9「归因链路走通」验收由定价线 e2e 在埋点线交付后联调，责任边界清晰。
- **落实位置**：定价线第2章 D1 行改写为「移交埋点线的对接需求：signup 页读 ?src= 并随 register 请求上送，服务端并入 register_success props.src="pricing"」（P1-3）；埋点线 §2.2 register_success 行增补 src 字段承接说明。

### 3.5 裁决五：migration 与 webhook 同批上线——**是硬性约束，且支付线现有论证必须更正**

- **结论**：是硬性上线约束，且当前支付线测试计划**未体现**（§9 仅 §9.4 有 up/down 回滚验证，无上线编排约束与窗口行为用例）。更重要的是 §6.4 的风险论证本身错误（见 P3-1）：DROP 旧表后旧代码不是「500＋Stripe 重试补投」，而是把表不存在异常吞成幂等命中返回 200，事件永久丢失。因此：
  1. DROP TABLE processed_stripe_events 移出本批 migration（旧表保留至下一次清理迁移，新旧表过渡期以新表为幂等事实源）；
  2. 「migrate job 与应用同批滚动、migrate 先于应用启动完成」升格为发布检查单硬性条目；
  3. §9 补「迁移窗口行为」集成用例（跨表重投的重复处理取舍断言）；
  4. 更正 §6.4 论述文字。
- **落实位置**：全部在支付线文档内（P3-1 四项修复）。

---

## 第4章 放行条件

实现阶段开始前必须完成的修改项（完成即放行；MINOR 不作门槛，随实现 PR 处理）：

| # | 对应问题 | 责任线 | 必须完成的修改 |
|---|----------|--------|----------------|
| 1 | P3-1（BLOCKER） | 支付线 | migration 去除 DROP 旧表；§6.4 论证更正；同批滚动写入发布约束；§9 增迁移窗口集成用例 |
| 2 | P1-1／P1-2 | 定价线＋埋点线 | 定价线 §5.1 按裁决一修订（共存＋边界声明）；埋点线 §4.2/§5.3 登记跳步规则与 click_signup 落点收敛 |
| 3 | P1-3／裁决四 | 定价线＋埋点线 | 定价线 D1 改写为移交项；埋点线承接 src 字段并在 §2.2 载明 |
| 4 | P1-4／P3-2／裁决三 | 支付线＋定价线 | checkout/route.ts 归属支付线；period 契约六要点写入支付线对接契约节；定价线 §5.4/R4 改为契约引用 |
| 5 | P2-1 | 埋点线 | activation 判定块包 try-catch 静默；dupCount 查询改主事务内 tx.count（或至少消除 RLS 疑问）；补「查询抛错主接口仍 200」单测 |
| 6 | P2-2／P3-3／P3-5 | 埋点线＋支付线 | analytics-server.ts 独占声明＋终态签名落纸（含 runWithAuthOp 第三参适配）；支付线配套改动改为消费声明 |
| 7 | P3-4 | 支付线 | getPaymentProviderSafe 对 secret 就绪性的探测约定补充，保持 stripeReady 现状语义 |

MINOR 项备忘（随 PR 顺带）：P1-5/P1-6/P1-7（定价线计数更正、组件清单统一、工时补充）、P2-4/P2-5/P2-6（埋点线基数更正、clientSessionId zod 校验、措辞统一）、P3-7（年付变量披露入 ADR 勘误建议）。

### 附：审核依据的可复核性声明

本报告全部代码结论基于当日源码实测：middleware.ts（131 行全文）、lib/analytics-server.ts（33 行全文）、api/v1/billing/webhook/route.ts（213 行全文）、prisma/schema.prisma L325–341、api/v1/events/route.ts（136 行全文）、node_modules/lucide-react@0.513.0/dist/lucide-react.d.ts（别名与五图标 declare 实测）、web/package.json、app/layout.tsx、app/auth/signup/page.tsx、checkout/route.ts（112 行全文）、overview/route.ts、tasks/route.ts、accept/route.ts、members/invite/route.ts、board/page.tsx、w/[wid]/layout.tsx、db/schema.sql、design-tokens.css 行号抽查（L167/L180/L193/L208/L317）、.next 构建产物。三份文档引用行号经抽查基本可信，发现的偏差均已在本报告列明。