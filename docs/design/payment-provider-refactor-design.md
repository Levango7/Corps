# PaymentProvider 抽象落地重构设计

> 状态：Revised v2（落实三线审核放行条件 P3-1 BLOCKER + P3-2~P3-7）｜作者：支付架构设计师｜日期：2026-08-27
> 上游依据：`docs/decisions/ADR-003-计费方案.md` §5（ACCEPTED）、`docs/analytics/FUNNEL-METRICS.md` §4.1、`spec/SPEC.md` L102–105 端点清单
> 审核依据：`docs/design/tri-line-design-review.md` 第4章放行条件 #1/#4/#6/#7（P3-1/P3-2/P3-3/P3-4/P3-5/P3-7）
> 范围声明：本文档为设计产物，不含任何产品代码改动。所有「现有代码」引用均出自仓库当前真实文件与行号。

---

## 0. 关键决策摘要

表：关键设计决策摘要对照表

| # | 决策点 | 结论 | 详见 |
|---|--------|------|------|
| D1 | 接口定稿 | 四方法接口：`createCheckout` / `createPortal` / `syncSubscription` / `parseWebhook`；`period` 缺省 monthly，yearly 经可选环境变量 `STRIPE_PRICE_ID_YEARLY` 支持，未配置时显式报错不降级 | §1、§2 |
| D2 | webhook 路径兼容性 | **保留 `POST /api/v1/billing/webhook` 不迁移**；Phase 2 新通道各自新增子路径 | §5.2 |
| D3 | 数据模型增量 | `subscriptions` 加 `provider`/`provider_order_id` 两列（nullable + 全量回填 `'stripe'`）；幂等表直接重命名泛化为 `processed_payment_events(provider, event_id)` 复合主键，不留旧视图别名 | §6 |
| D4 | 注册表工厂 | `getPaymentProvider(id?)` 惰性读 `PAYMENT_PROVIDER`（默认 `"stripe"`）+ 进程内单例缓存 + 测试 reset 出口 | §7 |
| D5 | createPortal null 语义 | null → HTTP 501；status 响应新增 `portalReady` 字段供前端隐藏入口（对齐 `stripeReady` 先例） | §4.3 |
| D6 | 续费编排定时任务 | 明确非目标，仅预留 `supportsAutoRenewal` 属性 | §8 |
| D7 | 对外契约 | 三 billing 端点 + webhook 端点的路径/鉴权/响应信封逐一核对不变；仅允许增量可选字段 | §4 |

---

## 1. 现状盘点

### 1.1 模块盘点表

表：计费域现状盘点表（模块/文件/行为）

| 模块 | 文件出处 | 现有行为（关键事实与行号） |
|------|----------|---------------------------|
| Stripe 客户端装配 | `web/lib/stripe.ts` | 模块顶层读 `STRIPE_SECRET_KEY` 构造 `stripe: Stripe \| null`（L3–7）；`requireStripe()` 未配置时抛错（L9–14）；导出 `STRIPE_PRICE_ID` / `STRIPE_WEBHOOK_SECRET`（L16–17）；`FREE_SEAT_LIMIT = 10`（L20） |
| Checkout 路由 | `web/app/api/v1/workspaces/[wid]/billing/checkout/route.ts` | Owner 校验 403（L50–55）；`STRIPE_PRICE_ID` 未配置返回 400（L57–63）；zod 入参 `{ priceId?, successUrl?, cancelUrl? }`（L7–11）；`safeRedirectUrl` 同源防护（A-4，L20–44）；`quantity = Math.max(workspace?.seatLimit ?? 1, 1)`（L90）；`metadata.workspaceId`（L93）；埋点 `billing_checkout { seatLimit }` 用 `trackServerEvent`（L97–102）；响应 `{ code: 200, data: { url } }`（L104）；异常统一 500（L105–110） |
| Portal 路由 | 同目录 `portal/route.ts` | Owner 校验（L8–14）；无 `stripeCustomerId` 返回 400「尚无 Stripe 客户」（L21–26）；`billingPortal.sessions.create({ customer, return_url })`（L31–34）；响应 `{ code: 200, data: { url } }`（L35） |
| Status 路由 | 同目录 `status/route.ts` | 返回 plan / seatLimit / memberCount / seatsUsed / role / subscription 快照；`stripeReady = Boolean(stripe && STRIPE_PRICE_ID)`——前端据此隐藏升级入口而非报错（L36–37）；`canManage = Boolean(subscription.stripeCustomerId)`（L43） |
| Webhook 路由 | `web/app/api/v1/billing/webhook/route.ts` | secret 未配置 500 拒收（L13–18）；`await req.text()` 取原始体验签（L20–29，约定出处 ADR-005 L19）；验签失败 400（L30–34）；`processedStripeEvent.create + catch(null)` 幂等，重复事件返回 200 `{ duplicate: true }`（L38–47）；四分支：`checkout.session.completed`（校验 workspace 存在 → retrieve 订阅补 quantity → upsert 订阅 + workspace 升 pro/seatLimit=quantity，L51–108）、`invoice.payment_failed` → `past_due`（AC-09，L110–125）、`customer.subscription.updated`（同步 status/quantity/currentPeriodEnd；canceled 时降级 free 且 seatLimit 回落 `FREE_SEAT_LIMIT`，否则 seatLimit=newQty，L126–178）、`customer.subscription.deleted`（置 canceled + workspace.plan=free，**注意：该分支未回落 seatLimit**，L179–203）；`current_period_end` 因 SDK v18 类型缺失做断言并注释（L130–135）；全部写库走 `runWithAuthOp("webhook", ...)` |
| 席位同步调用方（重构影响面） | `web/app/api/v1/workspaces/[wid]/members/[uid]/route.ts` | 移除成员后动态 import `requireStripe` 并 `subscriptions.retrieve` + `update items[0].quantity = seatLimit`（L118–127）；审计 F-11 口径：同步的是 seatLimit 而非人数（L94 注释） |
| 席位拦截（不改动，仅依赖关系） | 同目录 `members/invite/route.ts` | 达 seatLimit 返回 402「席位已满，请升级套餐」（L92、L180），与 provider 无耦合，本次不动 |
| 幂等数据模型 | `web/prisma/schema.prisma` L305–310 | `model ProcessedStripeEvent`，主键即 stripe event id（VarChar(255)），映射表 `processed_stripe_events` |
| 订阅数据模型 | `web/prisma/schema.prisma` L284–301 | `model Subscription`：`stripeCustomerId` / `stripeSubId` VarChar(255)?、`quantity Int @default(1)`、`status VarChar(20)`、`@@unique([workspaceId])`、`@@index([stripeCustomerId])`，映射表 `subscriptions` |
| SQL 双源 | `db/schema.sql` | `subscriptions` 含 CHECK 约束 `subscriptions_status_check`（枚举五值）+ UNIQUE `subscriptions_workspace_id_key` + INDEX `subscriptions_stripe_customer_id_idx`；`processed_stripe_events` 仅 pkey；文件头为 pg_dump 产物（AR-3 双源同步约定） |
| Migration 风格 | `web/prisma/migrations/` | `YYYYMMDDHHMMSS_蛇形描述/migration.sql`，头部注释说明动机，Prisma 注释风格（`-- AlterTable` / `-- CreateIndex`）；样例：`20260828000000_add_account_issuer`、`20260824130000_timestamptz_and_processed_stripe_events`（该文件即创建 `processed_stripe_events` 的原始 migration） |
| 服务端埋点 | `web/lib/analytics-server.ts` | `trackServerEvent({ userId, workspaceId, name, props })`：内部 `runWithAuthOp("provision")` + 失败静默（L30–32）；**签名 `userId: string` 必填**，而 `AnalyticsEvent.user_id` 列为 uuid nullable（schema.prisma L327） |
| 埋点白名单 | `web/app/api/v1/events/route.ts` L21–46 | `ALLOWED_EVENT_NAMES` 目前含转化组 4 个（billing_view/checkout/success/cancel），**不含** FUNNEL-METRICS §4.1 要求的 webhook 侧 4 事件 |

### 1.2 ADR 草案与代码事实的差异清单（接口定稿的输入）

表：ADR-003 §5 草案 vs 代码事实差异对照表

| # | 差异点 | ADR §5 草案 | 代码事实 | 定稿处理（论证见对应节） |
|---|--------|-------------|----------|--------------------------|
| 1 | 方法集不一致 | ADR 正文 L25 承诺三方法 `createCheckout / syncSubscription / handleWebhook`；§5 草案却是 `createCheckout / createPortal / parseWebhook`，两处互相矛盾 | `members/[uid]/route.ts` 存在真实的 Stripe quantity 同步调用（AC-08），若按 §5 三方法则该调用无法收敛到接口后 | 合并为四方法：`createCheckout / createPortal / syncSubscription / parseWebhook`（§1.3 论证①） |
| 2 | `CheckoutRequest.seats` 口径 | `seats: number`（注释=workspace.seatLimit，F-11 口径） | 实际取 `Math.max(workspace.seatLimit ?? 1, 1)`，由路由层查询 workspace 后计算 | seats 由路由层算好传入 provider；provider 不感知 workspace 表（§1.3 论证②） |
| 3 | `priceId` 透传 | 草案无此字段 | 现有 API 公开接受 `body.priceId` 覆盖默认价（checkout route L8、L67） | 接口加可选 `priceOverride?: string`，仅 StripeProvider 消费；对外 API 字段名不变（保持契约）（§1.3 论证③） |
| 4 | `period` 年付表达 | `period: BillingPeriod`（必填） | `STRIPE_PRICE_ID` 仅一个价格 ID，无年付价格概念；且现有请求体无 period 字段 | `period?: BillingPeriod` 可选、缺省 `monthly`（兼容存量客户端）；新增可选环境变量 `STRIPE_PRICE_ID_YEARLY`，未配置时收到 yearly 显式抛错（§1.3 论证④） |
| 5 | `parseWebhook` 同步签名 | `parseWebhook(...): UnifiedBillingEvent`（同步） | `checkout.session.completed` 分支需要异步 `subscriptions.retrieve` 补 quantity（webhook route L73–79） | 改为 `Promise<UnifiedBillingEvent>` 异步签名；同时 createCheckout 在 session metadata 写入 `seats`，webhook 优先读 metadata、缺失才 fallback retrieve（§5.4 论证） |
| 6 | 幂等所需事件 ID | `UnifiedBillingEvent` 各变体未携带事件 ID | 幂等表主键是 stripe event id（webhook route L38–40） | 各变体增加必填 `providerEventId: string`（§2） |
| 7 | 埋点字段缺口 | `payment.failed` 无 attempt、`subscription.canceled` 无 reason | FUNNEL-METRICS §4.1 规格要求 `{ attempt? }` 与 `{ reason? }` | 两变体分别增加 `attempt?: number`、`reason?: string`（§5.5） |
| 8 | portal 上下文 | `createPortal(ctx: { workspaceId })` | portal 需要先查订阅拿 `stripeCustomerId`（portal route L16–26），查询目前发生在路由层 | 维持草案签名，customer 查询平移进 StripeProvider 内部（§3） |

### 1.3 关键差异论证

#### ① 方法集合并为四方法

ADR 正文 L25 的三方法承诺（含 `syncSubscription`）早于 §5 草案，但两者均已被用户批准。以「覆盖全部现存 Stripe 调用点」为验收标准盘点：checkout 路由（sessions.create）、portal 路由（billingPortal.sessions.create）、members/[uid]（subscriptions.retrieve/update）、webhook（webhooks.constructEvent + subscriptions.retrieve）。四类调用面恰好对应四方法，缺一则必有调用点绕过抽象直连 SDK，违背 ADR L25「不为 Stripe 硬编码业务规则」的目标。因此定稿四方法，并在文档层面消除 ADR 内部矛盾（建议后续在 ADR-003 追勘误注记，不在本设计权限内改 ADR）。

#### ② seats 口径收口在路由层

`Math.max(seatLimit, 1)` 是防御性口径（seatLimit 理论上可为 0/null 的免费工作区），属于业务规则而非通道规则——微信/支付宝直连下单同样需要这个数。放进路由层（或未来统一的 billing service）让各 Provider 收到的 seats 恒 ≥ 1，接口契约更干净；provider 内部不做二次 clamp。

#### ③ priceOverride 保留而非删除

删除 `body.priceId` 会破坏已发布的对外 API 契约（SPEC §5 端点清单虽未细化 body 字段，但前端/脚本可能已使用）。折中：API 层字段名 `priceId` 保持不变，进入接口层时映射为 `CheckoutRequest.priceOverride`，注释标明「仅 Stripe 语义有效，其他通道忽略」。Phase 2 若无对应概念即自然废弃。

#### ④ yearly 的务实结论

事实约束：`STRIPE_PRICE_ID` 已冻结（ADR-003 §6 L181），当前仅一个价格 ID；定价两档制为月付 ¥59 / 年付 ¥590（`docs/market/pricing-strategy.md`）。结论：

1. 新增**可选**环境变量 `STRIPE_PRICE_ID_YEARLY`，语义为年付档价格 ID；`STRIPE_PRICE_ID` 语义固化为「缺省档＝monthly」。未配置 yearly 变量时系统处于「仅月付」状态。
2. `createCheckout` 收到 `period="yearly"` 而 `STRIPE_PRICE_ID_YEARLY` 未配置时，**抛出带明确文案的错误，由路由层映射 400**「年付价格未配置」，**不做静默降级到 monthly**——静默降级会让用户以月付单价被扣费却预期年付权益，属商业资损风险，且违反最小惊讶原则。
3. Phase 1 即支持 yearly（无需等 Phase 2）：配置变量即生效，定价页年付默认选中策略（`docs/market/pricing-page-spec.md`）依赖此变量就绪。这比「Phase 1 干脆不支持 yearly」更务实——接口层一次到位，避免 Phase 2 再动 CheckoutRequest 契约。

---

## 2. types.ts 最终接口定义

落位 `web/lib/payments/types.ts`（命名沿用项目 camelCase/PascalCase 约定，对齐 ADR §5 L102）。

代码示例：PaymentProvider 统一接口定稿（TypeScript）

```ts
/**
 * PaymentProvider 统一支付通道接口（ADR-003 §5 定稿版）。
 *
 * 设计约束：
 *  - 路由层只依赖本模块，禁止 import "stripe" SDK（注册表工厂见 lib/payments/index.ts）；
 *  - 实现不得抛出未分类异常：验签/解析失败抛 PaymentWebhookError，
 *    其余失败以 Result 形式返回或抛 PaymentProviderError，保证路由可统一应答；
 *  - 本文件不得包含任何通道专属类型（Stripe.Invoice 等），
 *    通道细节一律在各 Provider 实现内部消化。
 */

/** 支付通道标识（Phase 1 仅 stripe 有实现；后两个为 Phase 2 直连预留） */
export type ProviderId = "stripe" | "wechatpay-native" | "alipay-page";

export type BillingPeriod = "monthly" | "yearly";

/** 与 subscriptions.status 列 CHECK 约束（db/schema.sql subscriptions_status_check）严格一致 */
export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "incomplete";

export interface CheckoutRequest {
  /** 目标工作区 */
  workspaceId: string;
  /**
   * 购买席位数（审计 F-11 口径 = workspace.seatLimit，路由层已保证 >= 1，
   * 计算式沿用 checkout/route.ts L90 的 Math.max(seatLimit ?? 1, 1)）。
   */
  seats: number;
  /**
   * 计费周期；缺省 "monthly" 保持存量客户端行为不变。
   * "yearly" 需要通道配置了年付价格（Stripe 为 STRIPE_PRICE_ID_YEARLY），
   * 未配置时实现抛 PaymentProviderError，路由层映射 400，绝不静默降级。
   */
  period?: BillingPeriod;
  /**
   * 价格 ID 覆盖。兼容既有 API body.priceId 字段（checkout/route.ts L8/L67），
   * 仅 StripeProvider 消费；其余通道应忽略。
   */
  priceOverride?: string;
  /** 必须先过 safeRedirectUrl 同源校验（A-4，校验逻辑留在路由层，见 §4.1） */
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutResult {
  /**
   * 跳转型通道（Stripe Checkout / 支付宝电脑网站支付）：前端 window.location.href 跳转。
   * 对应现状响应 data.url（checkout/route.ts L104）。
   */
  redirectUrl?: string;
  /** 扫码型通道（微信 Native）：前端渲染二维码并轮询订单状态 */
  qrCodeUrl?: string;
  /**
   * 通道侧订单号（Stripe = checkout session.id；微信 = prepay_id；支付宝 = trade_no）。
   * 写入 subscriptions.provider_order_id，幂等与对账用。
   */
  providerOrderId: string;
  providerId: ProviderId;
}

export interface PortalContext {
  workspaceId: string;
}

export interface PaymentPortalResult {
  /** 自助管理入口 URL（发票/换绑/取消） */
  url: string;
}

export interface SyncSubscriptionContext {
  /** subscriptions.provider_order_id（Stripe = subscription id，sub_xxx） */
  providerOrderId: string;
  /** 最新购买席位数（审计 F-11：同步 seatLimit 口径，非成员人数） */
  seats: number;
}

export interface PaymentProviderCapabilities {
  /** 是否提供自助管理门户（决定 status.portalReady 与前端是否渲染管理按钮） */
  portal: boolean;
}

/**
 * 统一支付通道接口。
 */
export interface PaymentProvider {
  readonly id: ProviderId;
  /**
   * 是否原生支持自动续扣。
   * true = 通道自动重试扣款（Stripe 外币卡）；
   * false = 到期邮件提醒 + 一键续付链接（国内扫码通道，续费编排定时任务为非目标，见 §8）。
   */
  readonly supportsAutoRenewal: boolean;
  readonly capabilities: PaymentProviderCapabilities;

  createCheckout(req: CheckoutRequest): Promise<CheckoutResult>;

  /**
   * 自助管理入口。通道整体不支持 portal 时返回 null（如微信 Native 手动续费模式），
   * 路由层映射 501；「通道支持但该工作区从未购买」仍由实现抛业务错误（对齐现状 400 语义）。
   * 前端感知方式见 §4.3（status.portalReady，对齐 stripeReady 先例）。
   */
  createPortal(ctx: PortalContext): Promise<PaymentPortalResult | null>;

  /**
   * 席位数变更同步（AC-08）。平移自 members/[uid]/route.ts L118–127。
   * 不支持改单的通道应 no-op 并 console.warn（手动续费模式下数量在下一次付款时生效）。
   */
  syncSubscription(ctx: SyncSubscriptionContext): Promise<void>;

  /**
   * 验签并解析回调为统一事件。rawBody 必须为原始文本
   * （对齐 Stripe webhook await req.text() 既有约定，见 ADR-005 L19）。
   * headers 键一律小写（Node fetch Headers 规范化行为）。
   * 验签失败抛 PaymentWebhookError；事件增强所需的异步 IO（如补拉订阅详情）在本方法内完成。
   */
  parseWebhook(
    rawBody: string,
    headers: Record<string, string>,
  ): Promise<UnifiedBillingEvent>;
}

/**
 * 统一计费事件。providerEventId 为通道侧原始事件 ID（Stripe = evt_xxx），
 * 是 processed_payment_events 幂等表的 event_id 来源（§6）。
 * status/quantity/currentPeriodEnd/reason 等字段的取值口径见 §5.4 映射表。
 */
export type UnifiedBillingEvent =
  | {
      type: "checkout.completed";
      providerEventId: string;
      workspaceId: string;
      providerCustomerId: string;
      providerOrderId: string; // Stripe 订阅 id（写入 provider_order_id）
      seats: number;
      period: BillingPeriod;
    }
  | {
      type: "subscription.synced";
      providerEventId: string;
      providerOrderId: string;
      status: SubscriptionStatus;
      quantity: number;
      currentPeriodEnd?: Date;
    }
  | {
      type: "payment.failed"; // → past_due（AC-09 语义：催缴不中断服务）
      providerEventId: string;
      providerOrderId: string;
      attempt?: number; // FUNNEL-METRICS §4.1 #7 payment_failed props
    }
  | {
      type: "subscription.canceled"; // → plan=free 降级（A-7/F-11 语义）
      providerEventId: string;
      providerOrderId: string;
      reason?: string; // FUNNEL-METRICS §4.1 #9 subscription_churned props
    };

/** 验签失败/报文不可解析：webhook 路由捕获后统一应答 400（对齐现状 L30–34） */
export class PaymentWebhookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentWebhookError";
  }
}

/** 配置缺失、通道拒绝等其余失败：checkout/portal 路由按 message 映射 400/500（§4.1） */
export class PaymentProviderError extends Error {
  constructor(
    message: string,
    readonly code:
      | "not_configured" // 密钥/价格未配置（对齐现状 STRIPE_PRICE_ID 400 先例）
      | "unsupported_period" // yearly 未配置价格（D1-④）
      | "no_customer" // 尚无通道客户（对齐现状 portal 400 文案）
      | "channel_error", // 通道侧失败（对齐现状 500 兜底文案）
  ) {
    super(message);
    this.name = "PaymentProviderError";
  }
}
```

说明两点：

1. `handleWebhook`（ADR 正文 L25 提法）拆解为 `parseWebhook`（通道内：验签+归一化）+ 路由层分发器 `handleBillingEvent`（通道无关：幂等+落库+埋点，§5.1）。这样幂等表与埋点是全通道共享的单份实现，新通道接入零重复。
2. `capabilities.portal` 是相对 ADR 草案的增量属性：status 页需要在**不发任何请求**的情况下决定是否渲染管理按钮，纯靠运行时调 createPortal 探测代价过高；supportsAutoRenewal 单字段表达不了「UI 能力」维度。

---

## 3. StripeProvider 方法 ↔ 现有代码映射表

新文件 `web/lib/payments/stripe-provider.ts` 实现 `PaymentProvider`。「平移」= 行为逐行等价搬迁，「改造」= 语义有明确定义的调整。

表：StripeProvider 方法与现有代码映射表

| 接口方法 | 现有代码出处 | 平移/改造 | 说明 |
|----------|--------------|-----------|------|
| `constructor` | `web/lib/stripe.ts` L3–14 | 平移 | `STRIPE_SECRET_KEY` 缺失时不再导出全局 null，改为实例内 `requireClient()` 抛 `PaymentProviderError("not_configured")`；`appInfo { name: "corps" }` 保留 |
| `id` / `supportsAutoRenewal` / `capabilities` | —（新语义） | 新增 | 固定为 `"stripe"` / `true` / `{ portal: true }` |
| `createCheckout(req)` | checkout/route.ts L57–94 | 改造 | 价格解析：`req.priceOverride ?? (req.period === "yearly" ? STRIPE_PRICE_ID_YEARLY : STRIPE_PRICE_ID)`；yearly 且变量缺失 → `PaymentProviderError("unsupported_period", ...)`；secret 缺失 → `not_configured`（现状 requireStripe 抛错被 catch 成 500，语义不变）。`mode:"subscription"`、`customer: 已存订阅的 customerId`、`line_items.quantity = req.seats`、`metadata` 从 `{ workspaceId }` **扩展为** `{ workspaceId, seats: String(req.seats), period: req.period ?? "monthly" }`（§5.4 论证）。success/cancel URL 原样透传（同源校验留在路由层，见 §4.1） |
| `createPortal(ctx)` | portal/route.ts L16–35 | 平移+内聚 | customer 查询（原路由 L16–26）移入实现：查 `subscription.findUnique({ where: { workspaceId } })`；无记录或无 `providerCustomerId`（读取时按 `provider ?? "stripe"` 归一）→ 抛 `PaymentProviderError("no_customer", "尚无 Stripe 客户，请先通过升级完成订阅")`（文案不变）；`return_url` 组装：接口签名维持草案 `{ workspaceId }` 不扩展 returnUrl 参数，实现内用环境变量 `NEXT_PUBLIC_APP_URL` 构造绝对地址 `${APP_URL}/w/${wid}/billing`；未配置该变量时退化为相对路径 `/w/{wid}/billing`，若通道校验拒绝相对地址则抛 `channel_error` 走 500 兜底。此为唯一一处行为微调，已在 §4.2 标注 |
| `syncSubscription(ctx)` | members/[uid]/route.ts L118–127 | 平移 | `subscriptions.retrieve(subId)` 取 `items.data[0].id` → `subscriptions.update({ items: [{ id, quantity: ctx.seats }] })`；retrieve 失败的容错分支一并平移 |
| `parseWebhook(rawBody, headers)` | webhook/route.ts L13–34 + L49–205 的事件识别部分 | 改造 | secret 缺失 → `PaymentProviderError("not_configured")`（路由映射 500 拒收，现状 L13–18 语义不变）；`constructEvent` 失败 → `PaymentWebhookError(err.message)`（现状 400 文案格式 `Webhook Error: ${message}` 由路由拼接保持）；随后把 `event.type` 四分类归一化为 `UnifiedBillingEvent`（映射表见 §5.4）；`checkout.completed` 的 seats 优先读 metadata.seats（新会话必有），缺失 fallback `subscriptions.retrieve`（兼容迁移窗口期发出的旧 session，即现状 L73–79 路径原样保留为兜底）；`current_period_end` 断言注释随迁（现状 L130–135） |

`web/lib/stripe.ts` 重构后降级为 `StripeProvider` 的内部装配细节（或整体并入 payments 包），**对外不再导出** `requireStripe`/`stripe`；全代码库仅允许 `lib/payments/**` 与测试 mock 引用 `stripe` 包。`FREE_SEAT_LIMIT` 是业务常量不是通道常量，上移至 `lib/payments/constants.ts`（值 10 不变，消费方：webhook 分发器、status 兜底语义不变）。

---

## 4. 三路由改造前后对比

### 4.1 checkout 路由

> **文件归属（P3-2 / 裁决三，放行条件 #4）**：`checkout/route.ts` 由本线（支付线）**独占**整体重构。定价线对该路由的两项需求（zod 增 `period` 枚举、`billing_checkout` props 扩 `{ seatLimit, period }`）并入本线清单交付，定价线不再自列该文件改动。对接契约见 §4.5。

职责重新划分：路由层保留鉴权、workspace 查询、seats 计算、safeRedirectUrl（A-4 属 HTTP 安全策略，留在边界层）、埋点、信封组装；Stripe 细节全部下沉。

表：checkout 路由改造前后对比表

| 维度 | 改造前 | 改造后 |
|------|--------|--------|
| 路径/方法 | POST `/api/v1/workspaces/:wid/billing/checkout` | **不变** |
| 鉴权 | access token + owner（401/403） | **不变**（同一中间件链） |
| 请求体 | `{ priceId?, successUrl?, cancelUrl? }` | `{ priceId?, successUrl?, cancelUrl?, period? }` —— 仅增量可选字段；`period: z.enum(["monthly","yearly"]).optional()`，缺省 monthly，存量客户端零影响；非法值由 zod 400 兜底 |
| 安全防护 | safeRedirectUrl 同源校验（L20–44） | **原样保留在路由层**（A-4 是应用安全策略，不应随通道实现漂移；provider 收到的 URL 已经过滤） |
| 通道调用 | 直接 `stripe.checkout.sessions.create`（L87–94） | `getPaymentProvider().createCheckout({ workspaceId: wid, seats, period, priceOverride: body.priceId, successUrl, cancelUrl })` |
| 错误映射 | PRICE_ID 未配置→400；其余→500（L57–63、L105–110） | 400：`not_configured` / `unsupported_period`（新增场景，文案「年付价格未配置」）；500：`channel_error` 及未知异常兜底（文案「计费服务暂时不可用」不变） |
| 响应信封 | `{ code: 200, data: { url } }` | `{ code: 200, data: { url: result.redirectUrl } }`（Phase 1 恒走 redirectUrl；qrCodeUrl 场景留待 Phase 2 再议信封扩展） |
| 埋点 | `billing_checkout { seatLimit }`（L97–102） | `billing_checkout { seatLimit, period }`（P3-2：props 扩 `period`，缺省 monthly 时键仍写出以稳定下游聚合；位置保持在 provider 调用成功之后） |

### 4.2 portal 路由

表：portal 路由改造前后对比表

| 维度 | 改造前 | 改造后 |
|------|--------|--------|
| 路径/方法/鉴权 | POST `/api/v1/workspaces/:wid/billing/portal` + owner | **不变** |
| 前置检查 | 路由查订阅判 `stripeCustomerId` → 400「尚无 Stripe 客户…」（L21–26） | 检查下沉进 provider；路由 catch `PaymentProviderError("no_customer")` → 400（文案不变） |
| 通道调用 | `stripe.billingPortal.sessions.create`（L31–34） | `getPaymentProvider().createPortal({ workspaceId: wid })` |
| **新增 501** | —（不存在该状态码） | `createPortal` 返回 null → `{ code: 501, message: "当前支付通道不支持自助管理" }`。Phase 1 StripeProvider 恒返回 portal URL，该分支实际不可达；它是为 `PAYMENT_PROVIDER` 切换后的部署形态准备的 |
| return_url | `${origin}/w/${wid}/billing`（请求 origin，L30） | 见 §3 createPortal 行说明：NEXT_PUBLIC_APP_URL 兜底/相对路径退化，属已知微调项 |
| 响应信封 | `{ code: 200, data: { url } }` | **不变** |

### 4.3 status 路由

表：status 路由改造前后对比表

| 维度 | 改造前 | 改造后 |
|------|--------|--------|
| 路径/方法/鉴权 | GET `/api/v1/workspaces/:wid/billing/status` + access | **不变** |
| `stripeReady` | `Boolean(stripe && STRIPE_PRICE_ID)`（L37），前端隐藏升级入口 | 语义改为 `provider.capabilities` 就绪判定：`getPaymentProviderSafe()` 返回 null（PAYMENT_PROVIDER 无实现/未配置密钥）或缺价格变量时 false；**字段名与布尔含义不变，前端零改动** |
| **新增 `portalReady`** | — | `Boolean(provider?.capabilities.portal && stripeReady)`；前端 billing 页据此隐藏「管理订阅」按钮——这是 createPortal=null 语义在前端的静态预判（D5），与 stripeReady 先例同构 |
| `canManage` | `Boolean(subscription.stripeCustomerId)`（L43） | 通道无关化：`Boolean(subscription.providerOrderId) && portalReady`（字段名不变，语义从「有 stripe 客户」泛化为「可打开当前通道的自助管理」） |
| 其余字段 | plan/seatLimit/memberCount/seatsUsed/role/subscription 快照 | **不变**（subscription 快照中 status/quantity/currentPeriodEnd 均为通道无关列） |

### 4.4 webhook 路由对外契约

表：webhook 路由对外契约核对表

| 维度 | 现状 | 改造后 |
|------|------|--------|
| 路径 | POST `/api/v1/billing/webhook` | **不变**（D2 结论，Stripe Dashboard endpoint 无需任何变更） |
| 应答码 | 200 received / 200 duplicate / 400 验签失败 / 500 secret 未配置、handler error | 逐一保持（内部结构变化见 §5） |

### 4.5 与定价线对接契约（P3-2 / 裁决三，放行条件 #4）

> 本节落纸裁决三的对接契约六要点，定价线 `pricing-page-impl-design.md` §5.4/R4 以本节为单一引用源，不再自列 `checkout/route.ts` 改动。

表：checkout period 链路对接契约六要点对照表

| # | 契约要点 | 本线落实位置 |
|---|----------|--------------|
| ① | 请求体字段 `period: string`，枚举 `"monthly" \| "yearly"`，optional | §4.1 请求体行；zod schema `z.enum(["monthly","yearly"]).optional()` |
| ② | 缺省 `"monthly"`（保持存量客户端行为不变） | §4.1；`CheckoutRequest.period?` 缺省语义（§2 types.ts） |
| ③ | 非法值由 zod 400 兜底（不进入 provider 层） | §4.1 错误映射行；zod safeParse → 400 |
| ④ | `yearly` 且 `STRIPE_PRICE_ID_YEARLY` 未配置 → 400 文案「年付价格未配置」（`unsupported_period`），**绝不静默降级到 monthly** | §1.3 ④；§3 createCheckout 行；§4.1 错误映射行 |
| ⑤ | 响应信封不变 `{ code: 200, data: { url } }` | §4.1 响应信封行 |
| ⑥ | `billing_checkout` props 为 `{ seatLimit, period }`；`period` 缺省 monthly 时键仍写出（稳定下游聚合口径） | §4.1 埋点行 |

**现状断层披露（裁决三要求）**：Phase 1 定价页年付默认选中只作用于展示与 `click_upgrade` 归因；注册进 app 后 billing 页 `upgrade()` 暂传 `period: undefined`（仅打通管道），年付实际下单依赖 billing 周期 UI 后续迭代。此断层定价线 R4 已登记，验收时不应误判「年付转化链路已闭环」。

---

## 5. Webhook 重构方案

### 5.1 目标分层结构

```
POST /api/v1/billing/webhook                    ← Stripe 专用薄壳（路径不变，D2）
  ├─ STRIPE_WEBHOOK_SECRET 未配置 → 500 拒收     （现状 L13–18 平移进 provider 的 not_configured）
  ├─ rawBody = await req.text()                 （原始体验签约定，ADR-005 L19）
  ├─ headers 小写化为 Record
  ├─ provider.parseWebhook(rawBody, headers)
  │    └─ 验签失败 → PaymentWebhookError → 400 `Webhook Error: ${message}` （现状文案保持）
  ├─ 幂等占位：processed_payment_events(provider='stripe', event_id)
  │    └─ INSERT 冲突 → 200 { received: true, duplicate: true } （现状 L44–47 语义保持）
  └─ handleBillingEvent(event)                  ← 通道无关分发器 web/lib/payments/handle-billing-event.ts
       ├─ checkout.completed   → 校验 workspace 存在 → upsert 订阅 + workspace 升 pro/seatLimit → 埋点①
       ├─ subscription.synced  → 同步 status/quantity/currentPeriodEnd + canceled 降级分支 → （无埋点）
       ├─ payment.failed       → past_due → 埋点②
       ├─ invoice.paid(cycle)  → 埋点③（新增 case，见 §5.3）
       └─ subscription.canceled → canceled 降级 → 埋点④
```

分发器持有现状 L49–206 的全部落库逻辑（switch 体逐行平移，包括 workspace 存在性防御 L60–70、asString 语义并入映射层、`runWithAuthOp("webhook", ...)` 写库上下文不变）。Stripe 路由瘦身为约 40 行的协议壳。

### 5.2 路径兼容性决策（D2 正式结论）

**结论：保留 `POST /api/v1/billing/webhook` 作为 Stripe 专用端点，不迁移、不改名、不加版本后缀。**

论证：

1. **丢事件风险不对称**。已部署环境的 Stripe Dashboard webhook endpoint URL 若变更，存在配置窗口期：Dashboard 修改即时生效，而多套环境（生产/预览/本地 `stripe listen --forward-to`，ADR-005 L26）逐一更新期间到达旧 URL 的事件直接丢失。Stripe 对投递失败有重试（指数退避最长约 3 天），但前提是旧 endpoint 还挂在 Dashboard 上——一旦删除旧 endpoint 再建新的，窗口期内事件永久丢失。订阅开通/扣款失败属于资金敏感事件，任何丢失都直接转化为客诉（开了会员没生效 / 扣款失败没标记 past_due）。
2. **收益为零**。ADR §5 落地要点 3（L173）本身规定的就是「每通道独立子路径」：Stripe 占据现路径，新通道加 `/api/v1/billing/webhook/wechat`、`/api/v1/billing/webhook/alipay` 子路径即可满足「各自验签后进入统一事件总线」，不存在共用单一路由做 header 嗅探的串扰问题——串扰风险的原始语境就是反对单路径多通道，而非要求 Stripe 让出现路径。
3. **契约成本最低**。SPEC.md L105 端点清单、ADR-005 本地联调命令、现有运维手册/告警规则全部无需变更。
4. 否决的备选：「迁到 `/api/v1/billing/webhook/stripe` 保持命名对称」——对称性收益纯属审美，代价是上述 1–3 全额支付。否决。

### 5.3 invoice.paid 新增监听（subscription_renewed 前提）

FUNNEL-METRICS §4.1 #8 要求监听 `invoice.paid` 且过滤 `billing_reason === "subscription_cycle"`（周期续费成功；首次开通的 invoice.billing_reason 为 `subscription_create`，不计入续费漏斗，避免与 subscription_activated 双记）。落库动作：**无**（续费不改变订阅行状态，quantity/currentPeriodEnd 已由 customer.subscription.updated 覆盖），仅打点。该事件同样纳入幂等表（同一 evt_xxx 只处理一次）。

### 5.4 Stripe 事件 → UnifiedBillingEvent 映射表

表：Stripe 事件归一化映射表

| Stripe event.type | UnifiedBillingEvent | 字段来源（现状行号） | 备注 |
|------|---------------------|----------------------|------|
| `checkout.session.completed`（mode==="subscription"，其余忽略） | `checkout.completed` | workspaceId←session.metadata.workspaceId；customerId/subId←asString(s.customer/s.subscription)（L56–57）；seats←**session.metadata.seats（新增）**，缺失 fallback `subscriptions.retrieve`（L73–79 原路径保留）；period←session.metadata.period ?? "monthly" | metadata 缺关键键时现状走 console.error 分支（L103–107），映射层保持：返回 null 由分发器跳过并记日志 |
| `customer.subscription.updated` | `subscription.synced` | status←sub.status；quantity←items.data[0].quantity ?? 1；currentPeriodEnd←(sub as …).current_period_end 断言（L130–135 注释随迁） | status==="canceled" 的降级语义由分发器在同一 case 内处理（现状 L146–158 平移） |
| `invoice.payment_failed` | `payment.failed` | subId←asString(inv.subscription)；attempt←inv.attempt_count | |
| `invoice.paid`（billing_reason==="subscription_cycle"） | **新增第五变体** `payment.succeeded`：`{ type: "payment.succeeded"; providerEventId; providerOrderId; quantity?; amountMinor }`；分发器对该 type **只打点、不落库** | amountMinor←inv.amount_paid（最小货币单位整数，规格原文）；quantity←inv.lines.data[0].quantity | 设计取舍：不复用 `subscription.synced` 承载，因其分发器分支必然执行 updateMany 落库，对续费场景是无害却多余的写放大，且 status 无干净来源；独立变体使「只打点不落库」的意图在类型层面自解释。此为对 ADR 草案四变体的第三处扩展（另两处见 §1.2 差异 #6/#7） |
| `customer.subscription.deleted` | `subscription.canceled` | subId←asString(sub.id)；reason←sub.cancellation_details?.reason | 降级逻辑现状 L183–200 平移（含「未回落 seatLimit」的现状行为，见 §5.6 行为保全清单） |
| 其余全部事件 | 映射为 null → 跳过（但仍先过幂等占位再判断，与现状 default break 行为一致） | — | |


### 5.5 四个埋点插入点（FUNNEL-METRICS §4.1 #6–#9）

统一约定：全部使用 `trackServerEvent`（自带 provision 逃生口 + 失败静默，analytics-server.ts L17–32）；**打点必须在主事务提交之后调用**（放在 `runWithAuthOp("webhook", ...)` 回调 resolve 之后），避免外层事务回滚产生幽灵开通事件；userId 传 null（见下方配套改动）；任一埋点失败绝不影响 Stripe 应答。

表：webhook 侧埋点插入点对照表

| 事件名 | 插入点（精确位置） | props | userId/workspaceId |
|--------|--------------------|-------|--------------------|
| `subscription_activated`（P0） | checkout.completed 分支：upsert 订阅 + workspace.update(plan=pro, seatLimit=quantity) 事务成功后（对应现状 L98–101 之后） | `{ plan: "pro", quantity }`（quantity=最终写入值） | userId=null；workspaceId=事件中的 wid |
| `payment_failed`（P1） | payment.failed 分支：updateMany(status=past_due) 之后（现状 L117–122 后） | `{ attempt: inv.attempt_count }`（undefined 时省略键） | userId=null；workspaceId=先 findFirst({where:{stripeSubId}}) 取得，取不到则跳过打点 |
| `subscription_renewed`（P1） | 新增 invoice.paid(cycle) 分支尾部 | `{ quantity: lines[0].quantity, amountMinor: inv.amount_paid }` | 同上经 providerOrderId 反查；查不到跳过 |
| `subscription_churned`（P1） | subscription.canceled 分支：置 canceled + plan=free 事务成功后（现状 L183–200 后） | `{ reason: sub.cancellation_details?.reason }` | 同上反查 |

**配套改动（P3-3 / P3-5 / 裁决二，放行条件 #6，改为消费声明）**：

> 归属声明：`analytics-server.ts` 与 `events/route.ts` 白名单的改造由**埋点线独占**（埋点线阶段 1 一次成型）。本线 webhook 四埋点只**消费**埋点线交付的终态签名与白名单，不得并行修改这两个文件。排期规则：本线实现排在埋点线阶段 1 之后；若排期倒挂，本线可按下列载明的终态契约自行落地最小实现，合流时以埋点线版本为准（签名/白名单一致即无合并冲突）。

1. **`trackServerEvent` 签名终态契约（消费声明）**：埋点线交付目标签名为
   ```ts
   trackServerEvent(data: {
     userId?: string | null;   // 放宽：webhook 场景传 null
     workspaceId: string | null;
     sessionId?: string;        // 埋点线新增
     name: string;
     props?: Record<string, unknown>;
   }): Promise<unknown>
   ```
   内部实现约定（埋点线负责，本线仅消费）：
   - 入库 `userId` 写 `data.userId ?? null`（`AnalyticsEvent.user_id` 列为 uuid nullable，schema.prisma L327）；
   - **`runWithAuthOp` 第三参改传 `data.userId ?? undefined`**（P3-5：auth.ts L119–125 签名 `userId?: string` 不变，`null` 传给 `setGucs` 的 `user_id` 会被 `value === undefined` 跳过判断漏放，须显式 `?? undefined`，否则 TS 编译不过且 GUC 注入语义错误）；
   - 失败静默 `.catch(() => {})` 保留。

   理由：现状签名 `userId: string` 必填导致 webhook 场景只能传空串——空串会被 PostgreSQL 以 invalid uuid 拒绝、又被 `.catch` 静默吞掉，四个埋点将全军覆没且无任何报错。FUNNEL-METRICS L230「userId 或留空」的规格因此必须以签名放宽兑现。本线 webhook 四埋点统一传 `userId: null`。

2. **白名单终态契约（消费声明）**：埋点线一次性将 `ALLOWED_EVENT_NAMES`（events/route.ts L21–46）扩齐至 16 名并抽出 `lib/analytics-whitelist.ts` 单一事实源。16 = FUNNEL-METRICS 9 ＋ spec §8 三事件（`view_pricing`/`select_billing_period`/`click_upgrade`）3 ＋ 本线 webhook 四事件（`subscription_activated`/`payment_failed`/`subscription_renewed`/`subscription_churned`）4。本线不再单独改 `events/route.ts`；服务端 `trackServerEvent` 虽不走该白名单校验路径，但白名单是单一事实源，漏配会导致 overview 聚合口径缺事件名。若本线排期倒挂需临时自扩 4 名，合流时以埋点线版本为准。

3. 归因增强（可选，非阻塞）：现状 checkout session metadata 仅含 workspaceId（checkout/route.ts L93），故四埋点 userId 恒为 NULL（符合 FUNNEL-METRICS L230「留空」规格）。若未来需要按用户维度归因 Revenue 漏斗，可在 createCheckout 时向 metadata 增写 ownerUserId（路由层 ctx.payload.sub 现成可得），映射层透传为事件 userId；本设计不强制。

### 5.6 行为保全清单（重构验收红线）

以下现状行为逐条冻结，重构 PR 自查与评审以此清单为准：

1. 幂等命中返回 `{ code: 200, data: { received: true, duplicate: true } }`；
2. checkout.completed 中 workspace 不存在 → console.error + 跳过（不抛 500，L65–70）；
3. updated 分支 canceled 时 seatLimit 回落 FREE_SEAT_LIMIT，而 deleted 分支只降 plan 不回落 seatLimit（现状不对称，L156 vs L195–198——**本次不顺手修**，修正是行为变更须单独走缺陷流程；仅在代码注释标注）；
4. current_period_end 断言及 SDK v18 注释随迁；
5. 所有异常兜底 500 `{ code: 500, message: "Handler error" }`（L207–210）；
6. 非 subscription 模式的 checkout session 一律忽略（L54）。

---

## 6. 数据模型增量与 Migration 全文草案

### 6.1 Prisma schema 变更

代码示例：schema.prisma 两模型目标态（TypeScript/Prisma）

```prisma
model Subscription {
  id               String    @id @default(uuid()) @db.Uuid
  workspaceId      String    @map("workspace_id") @db.Uuid
  stripeCustomerId String?   @map("stripe_customer_id") @db.VarChar(255) // 保留列名避免破坏性迁移；语义=通道客户 ID（Phase 2 评估改名）
  stripeSubId      String?   @map("stripe_sub_id") @db.VarChar(255)   // 同上；新代码读写请用 providerOrderId
  provider         String?   @map("provider") @db.VarChar(20)          // 'stripe' | 'wechatpay-native' | 'alipay-page'；NULL=存量回填前的历史行
  providerOrderId  String?   @map("provider_order_id") @db.VarChar(255) // 通道侧订阅号（Stripe=sub_xxx）
  quantity         Int       @default(1)
  status           String    @default("active") @db.VarChar(20)
  currentPeriodEnd DateTime? @map("current_period_end") @db.Timestamptz
  canceledAt       DateTime? @map("canceled_at") @db.Timestamptz
  createdAt        DateTime  @default(now()) @db.Timestamptz @map("created_at")
  updatedAt        DateTime  @updatedAt @db.Timestamptz @map("updated_at")

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([workspaceId])
  @@index([stripeCustomerId])
  @@map("subscriptions")
}

// ─── Webhook 幂等（T2.7 泛化：多通道重复事件检测）──

model ProcessedPaymentEvent {
  provider   String   @db.VarChar(20) // 与 ProviderId 对齐
  eventId    String   @map("event_id") @db.VarChar(255) // 通道侧事件 ID（evt_xxx 等）
  receivedAt DateTime @default(now()) @db.Timestamptz @map("received_at")

  @@id([provider, eventId])
  @@map("processed_payment_events")
}
```

关于 `stripe_customer_id` / `stripe_sub_id` 列名去留：**Phase 1 保留原名不改**。理由：改列名牵动 members/[uid]、invite、status、webhook 全部读写点，违背「包一层不改行为」的落地要点 1；`provider_order_id` 作为规范字段并行存在，Phase 2 启动时再评估一次性改名（届时才有第二个通道的真实命名需求）。读取兼容公式：`const provider = row.provider ?? "stripe"`。

### 6.2 db/schema.sql 同步变更（AR-3）

`db/schema.sql` 为 pg_dump 产物，操作流程：`prisma migrate dev` 应用 migration.sql 到本地库 → `pg_dump --schema-only` 重新生成 → diff 审查确认仅有本节声明的变化。两张表的目标态定义：

代码示例：subscriptions 表目标态（SQL）

```sql
CREATE TABLE public.subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    stripe_customer_id character varying(255),
    stripe_sub_id character varying(255),
    provider character varying(20),              -- 新增
    provider_order_id character varying(255),    -- 新增
    quantity integer DEFAULT 1 NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    current_period_end timestamp with time zone,
    canceled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT subscriptions_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'past_due'::character varying, 'canceled'::character varying, 'trialing'::character varying, 'incomplete'::character varying])::text[])))
);
```

（UNIQUE `subscriptions_workspace_id_key` 与 INDEX `subscriptions_stripe_customer_id_idx` 定义不变。）

代码示例：processed_payment_events 表目标态（SQL）

```sql
CREATE TABLE public.processed_payment_events (
    provider character varying(20) NOT NULL,
    event_id character varying(255) NOT NULL,
    received_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT processed_payment_events_pkey PRIMARY KEY (provider, event_id)
);
```

关于 provider 列是否加 CHECK IN ('stripe','wechat-native',…)：**不加**。理由：status 枚举稳定所以有 CHECK 先例，而 ProviderId 枚举将随通道接入演进，CHECK 会使每次扩通道都多一个双源维护点；应用层 `ProviderId` 类型守卫 + 幂等表复合主键已足够防脏值。

### 6.3 Migration 全文草案

文件：`web/prisma/migrations/20260829000000_payment_provider_refactor/migration.sql`
（时间戳顺延现有最大值 20260828000000_add_account_issuer；命名沿用蛇形描述风格。）

代码示例：payment_provider_refactor up migration（SQL）

```sql
-- PaymentProvider 抽象落地（ADR-003 §5 落地要点 2）：
-- 1) subscriptions 增加通道归属两列，nullable 起步（down 直接删列，符合 Spec §10 可回滚约束）；
-- 2) 存量全量回填 'stripe'——MVP 全链路只有 Stripe，任何 subscription 行都来自 Stripe checkout
--    （该表仅在 webhook checkout.session.completed 分支 upsert，见 ADR-003 现状核对表）；
-- 3) 幂等表泛化：processed_stripe_events -> processed_payment_events，
--    主键从 (id) 改为 (provider, event_id)，历史数据原样迁入，不丢弃
--    （丢弃的代价只是极老 Stripe 事件可能被重复处理一次，但保留成本近零，选择保守）。
--
-- 【P3-1 BLOCKER 修复】DROP TABLE "processed_stripe_events" 移出本批 migration！
--   旧表保留至下一次清理迁移（见 §6.5）。理由：本批 migration 与应用代码同批滚动发布期间，
--   滚动排水期内存活的旧 webhook 实例仍向 processed_stripe_events 写入；若 up 已 DROP 旧表，
--   旧实例的 prisma.processedStripeEvent.create(...) 会抛「表不存在」异常，被 .catch(()=>null)
--   吞成幂等命中并返回 200——Stripe 收到 200 即停止重试，事件被静默永久丢失
--   （证据：webhook/route.ts L38–47）。保留旧表使旧实例写入正常成功，过渡期幂等事实源为
--   「两表之并集」，副作用由落库逻辑的 upsert/updateMany 幂等性兜底（见 §9.5 取舍断言）。

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN "provider" VARCHAR(20);
ALTER TABLE "subscriptions" ADD COLUMN "provider_order_id" VARCHAR(255);

-- Backfill
UPDATE "subscriptions" SET "provider" = 'stripe';

-- 泛化幂等表：新建 + 迁移（不 DROP 旧表）
CREATE TABLE "processed_payment_events" (
    "provider" VARCHAR(20) NOT NULL,
    "event_id" VARCHAR(255) NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "processed_payment_events_pkey" PRIMARY KEY ("provider", "event_id")
);

INSERT INTO "processed_payment_events" ("provider", "event_id", "received_at")
SELECT 'stripe', "id", "received_at"
FROM "processed_stripe_events"
ON CONFLICT DO NOTHING;
```

代码示例：payment_provider_refactor down migration（SQL）

```sql
-- Down migration（Spec §10 可回滚约束）：恢复旧幂等表结构与 subscriptions 原始形态。
-- 注意：down 后多通道数据（provider != 'stripe'）会被丢弃，仅适用于 Phase 1 单 Stripe 时期回滚。
-- 【P3-1】up 未 DROP 旧表，故 down 时 processed_stripe_events 仍存在；
--   将新表中 stripe 行搬回旧表（ON CONFLICT 跳过旧表已有行），再删新表、删两列。

INSERT INTO "processed_stripe_events" ("id", "received_at")
SELECT "event_id", "received_at"
FROM "processed_payment_events"
WHERE "provider" = 'stripe'
ON CONFLICT ("id") DO NOTHING;

DROP TABLE "processed_payment_events";

ALTER TABLE "subscriptions" DROP COLUMN "provider_order_id";
ALTER TABLE "subscriptions" DROP COLUMN "provider";
```

### 6.4 旧表名兼容策略论证（重命名 vs 新建+视图 vs 直接改）+ 上线硬性约束

三个候选：

1. **`ALTER TABLE RENAME`**：一步到位，但 pg_dump 的 RENAME 无法同时改主键结构（需另发 ALTER），实际仍是多条语句；且 Prisma migrate diff 生成的就是「新建+搬数据+删旧」序列。
2. **新建 `processed_payment_events` + 旧表改建视图**：视图会让 Prisma 元数据混乱（Prisma 对视图支持有限且 model 不能同时映射表和视图），还要长期维护两个对象，违背最小迁移原则。
3. **新建+搬数据+保留旧表（选定，P3-1 修复后）**：与 Prisma migrate 的自然产出一致；旧表名 `processed_stripe_events` 的代码引用点经 grep 全库确认**仅 webhook 路由一处**（`prisma.processedStripeEvent.create`，route.ts L38），该处恰是被重写的代码，不存在遗留引用；历史数据完整迁入不丢失。**DROP 旧表不在本批 migration 执行**（见 §6.3 注释与 §6.5）。

结论：采用方案 3，配合 §6.3 的 down migration 保证可回滚（Spec §10）。

#### 上线硬性约束（P3-1 / 裁决五，放行条件 #1）

> ⚠️ 本节为发布检查单硬性条目，非可选建议。

1. **migrate job 与 web 服务必须同批滚动发布，且 migrate 先于应用启动完成**。发布编排须保证：新镜像滚动启动前，migrate deploy 已对全量库执行完毕。禁止「先 migrate、隔一段时间再滚应用」或「先滚应用、再 migrate」两种错序。
2. **本批 up migration 不 DROP 旧表 `processed_stripe_events`**（§6.3 已落实）。旧表保留至 §6.5 清理迁移。
3. **滚动排水期行为断言**：新旧 webhook 实例并存期间，旧实例写 `processed_stripe_events`、新实例写 `processed_payment_events`，同一 Stripe 事件可能被两类实例各处理一次。**此重复处理的安全性依赖落库逻辑的幂等性**（`subscription.upsert` by `workspaceId`、`workspace.update` by id、`subscription.updateMany` by `stripeSubId` 均为幂等操作），副作用≈0；该取舍写入 §9.5 集成用例锁定。
4. **原 §6.4 错误论述已删除**：旧版「migration 单独生效期间 webhook 会短暂 500，Stripe 会自动重试补投，影响可控」——此论断错误。旧代码 `.catch(()=>null)` 会把「表不存在」异常吞成幂等命中返回 200（webhook/route.ts L38–47），Stripe 收到 200 即停止重试，事件**被静默永久丢失**，不存在「自动重试补投」。本批通过保留旧表 + 同批滚动约束从根上消除该窗口。

### 6.5 旧表清理迁移（后续独立批次）

`DROP TABLE "processed_stripe_events"` 编入下一次清理 migration（建议命名 `YYYYMMDDHHMMSS_drop_legacy_processed_stripe_events`），执行前置条件：

1. 全量 webhook 实例已切换为新代码（写 `processed_payment_events`），可通过观测确认 `processed_stripe_events` 写入 QPS 降为 0 持续 N 天；
2. `processed_payment_events` 中 `provider='stripe'` 行已覆盖所有近期事件（与旧表 recent 行对齐）。

清理 migration 的 down 不需要重建旧表（回滚到旧代码的窗口已过，若需回滚应整批回滚至本批 migration 之前）。该迁移不在本次设计交付范围内，仅在此登记预留。

---

## 7. getPaymentProvider 注册表工厂设计

落位 `web/lib/payments/index.ts`。

代码示例：注册表工厂（TypeScript）

```ts
import type { PaymentProvider, ProviderId } from "./types";
import { StripeProvider } from "./stripe-provider";

/**
 * 通道注册表：id -> 惰性构造器。
 * Phase 1 仅注册 stripe；wechatpay-native / alipay-page 条目 Phase 2 接入时追加，
 * 业务层与本文件之外的一切代码不需要为此改动。
 */
const registry = new Map<ProviderId, () => PaymentProvider>([
  ["stripe", () => new StripeProvider()],
]);

/** 进程内单例缓存：同一通道复用同一实例（Stripe SDK client 复用连接池） */
const instances = new Map<ProviderId, PaymentProvider>();

/**
 * 获取支付通道实例。
 * @param id 显式指定通道；缺省读 PAYMENT_PROVIDER 环境变量（默认 "stripe"）。
 * @throws Error 未知通道 id（fail fast，防止拼写错误静默落到错误通道）。
 */
export function getPaymentProvider(id?: ProviderId): PaymentProvider {
  const resolved = id ?? readConfiguredProviderId();
  const cached = instances.get(resolved);
  if (cached) return cached;
  const factory = registry.get(resolved);
  if (!factory) {
    throw new Error(`未知支付通道: ${resolved}（已注册: ${[...registry.keys()].join(", ")}）`);
  }
  const instance = factory();
  instances.set(resolved, instance);
  return instance;
}

/** 读取部署级通道配置。惰性调用时机 = 首次 getPaymentProvider()，不在模块顶层求值。 */
function readConfiguredProviderId(): ProviderId {
  const raw = process.env.PAYMENT_PROVIDER?.trim();
  if (!raw) return "stripe";
  if (!isProviderId(raw)) {
    throw new Error(`PAYMENT_PROVIDER 配置非法: "${raw}"`);
  }
  return raw;
}

function isProviderId(v: string): v is ProviderId {
  return v === "stripe" || v === "wechatpay-native" || v === "alipay-page";
}

/** 测试专用：清空单例缓存（vitest beforeEach 调用），生产代码禁用 */
export function __resetPaymentProviderForTests(): void {
  instances.clear();
}
```

设计要点论证：

1. **读取时机＝惰性（首次调用）而非模块顶层**。三个理由：(a) Next.js Route Handler 模块可能在构建期被求值，顶层读 env 会把构建机环境变量固化进产物；(b) 现状 `web/lib/stripe.ts` 顶层构造 Stripe client 的做法使「未配置密钥」只能在运行时靠 `stripe === null` 判断，惰性工厂把配置检查收敛到首次使用点，错误信息更聚焦；(c) 测试可以在 import 之后、调用之前设置 `process.env.PAYMENT_PROVIDER`。
2. **单例缓存 keyed by resolved id**：显式传参与 env 解析出的同 id 共享缓存，避免同进程出现两个 Stripe client。
3. **registry 存惰性构造器而非实例**：StripeProvider 构造函数轻量（不拨网络），但保持构造惰性使未来重量级通道（SDK 初始化、证书加载）无需改工厂结构。
4. **status 路由的特殊需求**：`stripeReady` 语义要求「配置不就绪时不抛错而是返回 false」。提供伴随导出 `getPaymentProviderSafe(): PaymentProvider | null`（内部 try/catch 包装 getPaymentProvider，仅吞 not_configured 类错误），status 使用 Safe 版本，其余路由使用严格版本。两出口共享同一缓存。**P3-4 补充约定**：`getPaymentProviderSafe` 内部除捕获 `not_configured` 外，须对返回的 `StripeProvider` 实例额外探测 `STRIPE_SECRET_KEY` 就绪性——`StripeProvider` 导出 `isConfigured: boolean` 属性（构造时不抛错，延迟到 `requireClient()` 才检查 secret），`getPaymentProviderSafe` 在拿到实例后若 `!instance.isConfigured` 则返回 `null`。此约定保持现状 `stripeReady = Boolean(stripe && STRIPE_PRICE_ID)`（status/route.ts L37）的语义：**secret 或价格缺失 ⇒ `getPaymentProviderSafe()` 返回 null ⇒ `stripeReady=false`**，前端隐藏升级入口而非误显后点击得 400。`isConfigured` 判定式：`Boolean(STRIPE_SECRET_KEY && STRIPE_PRICE_ID)`（价格变量由 provider 内部读取，secret 由实例装配状态决定）。
5. **`.env.example` 增补**：`PAYMENT_PROVIDER=stripe`（默认值注释）与 `STRIPE_PRICE_ID_YEARLY=`（留空注释说明年付未启用；portal return_url 依赖 `NEXT_PUBLIC_APP_URL`，生产必配，见附录 B）。

---

## 8. 非目标清单（Scope 边界）

| # | 非目标 | 边界内的替代动作 | 后续去向 |
|---|--------|------------------|----------|
| 1 | **续费编排定时任务**（扫描 `currentPeriodEnd` T-7/T-1 发送续付邮件，ADR-003 L174） | 仅预留：`supportsAutoRenewal` 属性已入接口；`UnifiedBillingEvent.subscription.synced.currentPeriodEnd` 已携带到期时间；subscriptions 表已有 current_period_end 列，未来任务可直接扫描 | 独立后续项（建议挂 roadmap M3+，与邮件基建同批） |
| 2 | Phase 2 微信 Native / 支付宝电脑网站支付的 Provider 实现 | 注册表预留两个 ProviderId 条目位；CheckoutResult.qrCodeUrl 字段已预留扫码形态 | Phase 2（GA 后、资质齐备，ADR-003 §4） |
| 3 | 日终对账拉取（微信/支付宝账单下载 API，ADR-003 L175） | 无 | Phase 2 随双通道接入 |
| 4 | `stripe_customer_id`/`stripe_sub_id` 列改名 | 新增 provider_order_id 规范列并行，读取兼容公式 `provider ?? "stripe"` | Phase 2 二次评估 |
| 5 | webhook deleted 分支不回落 seatLimit 的现状不对称（§5.6 第 3 条） | 注释标注，不顺手修复 | 单独缺陷流程 |
| 6 | 国内支付合规/备案推进、定价页 UI 改造 | 无 | 商业线（pricing-page-spec） |
| 7 | invite 路由 402 拦截、members 移除同步的**业务逻辑**变更 | members/[uid] 的 Stripe 调用点切换为 `getPaymentProvider().syncSubscription(...)`（仅换调用方式，AC-08 口径与触发时机不变） | — |

---

## 9. 测试计划

### 9.1 单元测试（vitest，mock stripe SDK）

新增 `web/tests/unit/payments/*.test.ts`，`vi.mock("stripe")` 注入 fake client：

表：单测用例规划表

| 文件 | 用例组 | 关键断言 |
|------|--------|----------|
| `stripe-provider.test.ts` | createCheckout | monthly 用 STRIPE_PRICE_ID；yearly 用 STRIPE_PRICE_ID_YEARLY；yearly 未配置 → PaymentProviderError("unsupported_period")；priceOverride 优先级最高；seats 原样透传给 line_items（clamp 已在路由层）；metadata 含 workspaceId/seats/period；customer 透传已存订阅 ID |
| 同上 | createPortal | 有 customer → 返回 url；无订阅/无 customer → PaymentProviderError("no_customer") 且文案与现状一致；secret 未配置 → not_configured |
| 同上 | syncSubscription | retrieve→update 参数形状（items[{id,quantity}]）与现状 L124–126 等价；retrieve 抛错的容错分支 |
| 同上 | parseWebhook | 非法签名 → PaymentWebhookError；四类 Stripe 事件 + invoice.paid(cycle/非 cycle) 的归一化结果逐字段断言；metadata.seats 存在时不触发 retrieve（spy 断言）、缺失时 fallback；未知事件类型 → null |
| `registry.test.ts` | getPaymentProvider | 默认返回 StripeProvider 单例（两次调用同引用）；`PAYMENT_PROVIDER=stripe` 显式一致；非法值抛错；未知显式 id 抛错；`__resetPaymentProviderForTests` 后重建 |
| `handle-billing-event.test.ts`（mock prisma） | 分发器 | 四+一分支的落库参数快照；checkout.completed workspace 不存在时静默跳过；updated+canceled 的 seatLimit 回落 FREE_SEAT_LIMIT；deleted 不回落 seatLimit（§5.6 冻结行为回归锁定）；幂等占位冲突短路 |

### 9.2 Webhook 集成测试（验签与幂等）

沿用 `web/tests/integration/` 既有模式（真实 PG + supertest 式 fetch）：

1. **验签**：合法 `Stripe-Signature`（用测试 secret 现场构造）→ 200；缺失 header → 400 `Missing stripe-signature`；篡改 payload → 400 前缀 `Webhook Error:`；
2. **幂等**：同一 evt_xxx 连投两次 → 第二次 `{ received: true, duplicate: true }` 且订阅行只写一次；不同 provider 相同 event_id 不互斥（复合主键验证）；
3. **四分支落库**：checkout.completed 后 workspace.plan=pro 且 seatLimit=quantity；payment_failed 后 status=past_due；updated 数量变更后 seatLimit 同步；deleted 后 plan=free；
4. **四埋点**：每分支后 `analytics_events` 出现对应 name 行、props 键符合 §5.5 规格、userId 为 NULL；人为令 trackServerEvent 抛错（mock）时主流程仍 200（失败静默红线）。

### 9.3 既有测试回归清单（grep tests/ 引用 billing 的文件）

`rg -l -i "billing|stripe|subscription" web/tests` 命中且涉及计费端点的文件：

表：billing 相关既有测试回归清单

| 测试文件 | 引用位置 | 断言内容 | 重构影响预判 |
|----------|----------|----------|--------------|
| `web/tests/integration/rbac.test.ts` | L247、L256 | member/admin 调 checkout 必须 403 | 403 在鉴权层短路，未触达 provider；**应原样通过**，作为「鉴权位置未移动」的证据 |
| `web/tests/integration/workspace.test.ts` | L217 | member 调 checkout 必须 403 | 同上 |
| 其余 17 个测试文件（auth/invitation/tasks/search 等） | 无 billing 引用 | — | 不受影响；其中 invitation.test.ts 未覆盖席位满 402 场景，列入 §9.4 补充建议 |

回归命令约定：`npx vitest run tests/integration/rbac.test.ts tests/integration/workspace.test.ts` + 全量 `npx vitest run`（以 package.json 实际 script 为准）。

### 9.4 建议新增（非阻塞）

- invitation 集成测试补一条「seatLimit 打满 → 402」用例，锁定 F-11 拦截口径在重构后不回归；
- migration 在临时库执行 up → 断言表结构 → 执行 down → 断言与原始 schema 一致（可用 CI 里的 disposable Postgres 容器，docker-compose.yml 已有基础设施）。

### 9.5 迁移窗口行为集成用例（P3-1 / 裁决五，放行条件 #1，阻塞项）

> 本节为 P3-1 BLOCKER 修复的配套测试，须随实现 PR 一并落地。

表：迁移窗口行为集成用例对照表

| # | 用例 | 前置 | 步骤 | 断言 |
|---|------|------|------|------|
| 1 | up 不 DROP 旧表 | 干净库 | 执行本批 up migration | `processed_stripe_events` 表仍存在且可写入；`processed_payment_events` 表已创建且复合主键 (provider, event_id) 生效；旧表历史行已搬入新表（provider='stripe'） |
| 2 | down 可回滚 | 已执行 up | 执行 down migration | `processed_payment_events` 已删除；`processed_stripe_events` 仍存在且含原历史行 + up 期间新写入行；`subscriptions` 的 `provider`/`provider_order_id` 两列已删除 |
| 3 | 跨表重复处理幂等性 | workspace W 已有 stripe 订阅；旧表与新表均无 evt_xxx | 模拟旧实例处理 evt_xxx（写 processed_stripe_events + 落库 upsert/updateMany）→ 新实例处理同一 evt_xxx（写 processed_payment_events + 同样落库） | 两次落库均成功；workspace.plan / seatLimit / subscription.status 最终值与单次处理一致（幂等）；无重复创建订阅行（`@@unique([workspaceId])` 兜底） |
| 4 | 旧实例写旧表不报错 | up 已执行，旧表保留 | 用旧代码 Prisma client 执行 `processedStripeEvent.create({ data: { id: "evt_test" } })` | 写入成功，不抛「表不存在」异常（验证 P3-1 修复点：旧版若 DROP 旧表则此处抛错被 .catch 吞成 200 导致事件丢失） |
| 5 | 新实例写新表 | up 已执行 | 用新代码 Prisma client 执行 `processedPaymentEvent.create({ data: { provider: "stripe", eventId: "evt_test2" } })` | 写入成功；复合主键生效（同 provider+eventId 二次写入抛唯一冲突） |

取舍声明（写入测试注释）：跨表重复处理时，新表无记录的重投会重复执行落库逻辑一次，因 `subscription.upsert`（by workspaceId）、`workspace.update`（by id）、`subscription.updateMany`（by stripeSubId）均为幂等操作，副作用≈0；这是为换取「旧表保留、旧实例不报错」而接受的代价，优于旧版「事件静默永久丢失」的资损风险。

---

## 附录 A：改造文件清单汇总

表：本次重构涉及文件一览表

| 操作 | 文件 |
|------|------|
| 新增 | `web/lib/payments/types.ts`、`web/lib/payments/stripe-provider.ts`、`web/lib/payments/handle-billing-event.ts`、`web/lib/payments/index.ts`、`web/lib/payments/constants.ts`、`web/prisma/migrations/20260829000000_payment_provider_refactor/migration.sql`、`web/tests/unit/payments/*` |
| 重写（瘦身） | `web/app/api/v1/billing/webhook/route.ts`、`web/app/api/v1/workspaces/[wid]/billing/checkout/route.ts`、`web/app/api/v1/workspaces/[wid]/billing/portal/route.ts` |
| 小改 | `web/app/api/v1/workspaces/[wid]/billing/status/route.ts`（portalReady/canManage/stripeReady 判定）、`web/app/api/v1/workspaces/[wid]/members/[uid]/route.ts`（换用 syncSubscription）、`web/prisma/schema.prisma`（两模型）、`db/schema.sql`（pg_dump 重新生成）、`.env.example`（`PAYMENT_PROVIDER` / `STRIPE_PRICE_ID_YEARLY` 两个变量） |
| 不改（消费声明，P3-3） | `web/lib/analytics-server.ts`（签名放宽归埋点线独占，本线 webhook 四埋点只消费终态签名）、`web/app/api/v1/events/route.ts`（白名单扩齐归埋点线独占） |
| 删除/私有化 | `web/lib/stripe.ts` 导出面收敛（并入 payments 包内部） |

## 附录 B：遗留勘误建议（不在本设计权限内）

1. ADR-003 正文 L25 与 §5 L139–153 的方法集矛盾，建议在 ADR 追加一行勘误注记指向本文档 §1.3①；
2. ADR-003 L172「幂等表泛化为 processed_payment_event」为单数表述，实际表名遵循项目复数惯例定为 `processed_payment_events`（与 processed_stripe_events 一致）；
3. **P3-7**：新增环境变量 `STRIPE_PRICE_ID_YEARLY` 属配置增量（非变更），ADR-003 §6 L181 宣布的「`STRIPE_PRICE_ID` 配置自即日起冻结」不构成违反（新增非修改）。建议随 ADR-003 勘误注记一并登记该年付变量增量，明确「`STRIPE_PRICE_ID` 语义固化为缺省档=monthly，`STRIPE_PRICE_ID_YEARLY` 为年付档可选变量」。同时在 `.env.example` 注释标注：portal `return_url` 依赖 `NEXT_PUBLIC_APP_URL`，生产环境必配（否则退化为相对路径，Stripe 校验可能拒绝）。