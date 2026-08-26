/**
 * PaymentProvider 统一支付通道接口（ADR-003 §5 定稿版）。
 *
 * 设计约束：
 *  - 路由层只依赖本模块，禁止 import "stripe" SDK（注册表工厂见 lib/payments/index.ts）；
 *  - 实现不得抛出未分类异常：验签/解析失败抛 PaymentWebhookError，
 *    其余失败以 Result 形式返回或抛 PaymentProviderError，保证路由可统一应答；
 *  - 本文件不得包含任何通道专属类型（Stripe.Invoice 等），
 *    通道细节一律在各 Provider 实现内部消化。
 *
 * 落位：web/lib/payments/types.ts（命名沿用项目 camelCase/PascalCase 约定，对齐 ADR §5 L102）。
 */

/** 支付通道标识（Phase 1 仅 stripe 有实现；后两个为 Phase 2 直连预留） */
export type ProviderId = "stripe" | "wechatpay-native" | "alipay-page";

export type BillingPeriod = "monthly" | "yearly";

/** 与 subscriptions.status 列 CHECK 约束（db/schema.sql subscriptions_status_check）严格一致 */
export type SubscriptionStatus = "active" | "trialing" | "past_due" | "canceled" | "incomplete";

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
   * 未配置时实现抛 PaymentProviderError("unsupported_period")，路由层映射 400，绝不静默降级。
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
  /** 已存订阅的通道客户 ID（路由层查 subscription 后传入，避免 provider 内部重复查询） */
  providerCustomerId?: string;
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
   * false = 到期邮件提醒 + 一键续付链接（国内扫码通道，续费编排定时任务为非目标）。
   */
  readonly supportsAutoRenewal: boolean;
  readonly capabilities: PaymentProviderCapabilities;
  /** 是否已配置就绪（secret + 价格变量齐备）。getPaymentProviderSafe 据此返回 null。 */
  readonly isConfigured: boolean;

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
  ): Promise<UnifiedBillingEvent | null>;
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
    }
  | {
      // invoice.paid(billing_reason="subscription_cycle")：续费成功，只打点不落库
      type: "payment.succeeded";
      providerEventId: string;
      providerOrderId: string;
      quantity?: number;
      amountMinor: number; // 最小货币单位整数（inv.amount_paid）
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
