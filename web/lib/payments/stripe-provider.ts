import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import {
  BillingPeriod,
  CheckoutRequest,
  CheckoutResult,
  PaymentPortalResult,
  PaymentProvider,
  PaymentProviderCapabilities,
  PaymentProviderError,
  PaymentWebhookError,
  PortalContext,
  ProviderId,
  SyncSubscriptionContext,
  SubscriptionStatus,
  UnifiedBillingEvent,
} from "./types";

/**
 * StripeProvider —— PaymentProvider 的 Stripe 实现。
 *
 * 平移自现有 billing 路由的 Stripe 调用，行为逐行等价搬迁（见设计文档 §3 映射表）。
 * 构造时不抛错（延迟到 requireClient 才检查 secret），isConfigured 暴露就绪状态供
 * getPaymentProviderSafe 探测（P3-4）。
 */

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID;
const STRIPE_PRICE_ID_YEARLY = process.env.STRIPE_PRICE_ID_YEARLY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

/** free 档席位上限（审计 F-11 订阅取消时回落到此档；从 stripe.ts 上移，值 10 不变） */
export const FREE_SEAT_LIMIT = 10;

function asString(v: string | { id: string } | null | undefined): string | undefined {
  if (!v) return undefined;
  return typeof v === "string" ? v : v.id;
}

export class StripeProvider implements PaymentProvider {
  readonly id: ProviderId = "stripe";
  readonly supportsAutoRenewal = true;
  readonly capabilities: PaymentProviderCapabilities = { portal: true };

  private client: Stripe | null = null;

  constructor() {
    // 惰性装配：构造时不拨网络，仅记录 secret 是否存在
    if (STRIPE_SECRET_KEY) {
      this.client = new Stripe(STRIPE_SECRET_KEY, {
        appInfo: { name: "corps", version: "0.1.0" },
      });
    }
  }

  /**
   * 是否已配置就绪：secret + 缺省月付价格齐备。
   * P3-4：getPaymentProviderSafe 据此返回 null，保持现状 stripeReady 语义
   * （secret 或价格缺失 ⇒ stripeReady=false）。
   */
  get isConfigured(): boolean {
    return Boolean(this.client && STRIPE_PRICE_ID);
  }

  /** 获取已装配的 Stripe client，未配置 secret 时抛 not_configured */
  private requireClient(): Stripe {
    if (!this.client) {
      throw new PaymentProviderError(
        "STRIPE_SECRET_KEY 未配置：请在环境变量中填入 Stripe 测试密钥",
        "not_configured",
      );
    }
    return this.client;
  }

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    const stripe = this.requireClient();

    // 价格解析：priceOverride 优先 > period 决定 > 缺省月付
    const period: BillingPeriod = req.period ?? "monthly";
    let priceId: string | undefined;
    if (req.priceOverride) {
      priceId = req.priceOverride;
    } else if (period === "yearly") {
      if (!STRIPE_PRICE_ID_YEARLY) {
        // yearly 未配置年付价格 → 显式报错，路由层映射 400，绝不静默降级（D1-④）
        throw new PaymentProviderError(
          "年付价格未配置（请在环境变量设置 STRIPE_PRICE_ID_YEARLY）",
          "unsupported_period",
        );
      }
      priceId = STRIPE_PRICE_ID_YEARLY;
    } else {
      if (!STRIPE_PRICE_ID) {
        throw new PaymentProviderError(
          "STRIPE_PRICE_ID 未配置（请在环境变量设置测试价格 ID）",
          "not_configured",
        );
      }
      priceId = STRIPE_PRICE_ID;
    }

    try {
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: req.providerCustomerId ?? undefined,
        line_items: [{ price: priceId, quantity: req.seats }],
        success_url: req.successUrl,
        cancel_url: req.cancelUrl,
        // metadata 扩展：seats 供 webhook 优先读取免 retrieve；period 供 webhook 归一化
        metadata: {
          workspaceId: req.workspaceId,
          seats: String(req.seats),
          period,
        },
      });
      return {
        redirectUrl: session.url ?? undefined,
        providerOrderId: session.id,
        providerId: "stripe",
      };
    } catch (err) {
      throw new PaymentProviderError(
        err instanceof Error ? err.message : "Stripe checkout 创建失败",
        "channel_error",
      );
    }
  }

  async createPortal(ctx: PortalContext): Promise<PaymentPortalResult | null> {
    const stripe = this.requireClient();
    const { workspaceId } = ctx;

    // customer 查询平移进 provider（原 portal/route.ts L16–26）
    const subscription = await prisma.subscription.findUnique({
      where: { workspaceId },
      select: { stripeCustomerId: true },
    });
    const customerId = subscription?.stripeCustomerId;
    if (!customerId) {
      throw new PaymentProviderError("尚无 Stripe 客户，请先通过升级完成订阅", "no_customer");
    }

    // return_url 组装：NEXT_PUBLIC_APP_URL 兜底，未配置时退化为相对路径
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    const returnUrlBase = appUrl
      ? `${new URL(appUrl).origin}/w/${workspaceId}/billing`
      : `/w/${workspaceId}/billing`;

    try {
      const portal = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrlBase,
      });
      return { url: portal.url };
    } catch (err) {
      throw new PaymentProviderError(
        err instanceof Error ? err.message : "Stripe portal 创建失败",
        "channel_error",
      );
    }
  }

  async syncSubscription(ctx: SyncSubscriptionContext): Promise<void> {
    const stripe = this.requireClient();
    // 平移自 members/[uid]/route.ts L118–127：retrieve → update items[0].quantity
    try {
      const sub = await stripe.subscriptions.retrieve(ctx.providerOrderId);
      const itemId = sub.items.data[0]?.id;
      if (itemId) {
        await stripe.subscriptions.update(ctx.providerOrderId, {
          items: [{ id: itemId, quantity: ctx.seats }],
        });
      }
    } catch (err) {
      // 容错分支平移：Stripe 同步失败不阻断本地操作，仅 console.error
      console.error(`[stripe-provider] syncSubscription 失败 subId=${ctx.providerOrderId}:`, err);
    }
  }

  async parseWebhook(
    rawBody: string,
    headers: Record<string, string>,
  ): Promise<UnifiedBillingEvent | null> {
    if (!STRIPE_WEBHOOK_SECRET) {
      // secret 未配置 → 路由映射 500 拒收（现状 webhook/route.ts L13–18 语义不变）
      throw new PaymentProviderError(
        "STRIPE_WEBHOOK_SECRET 未配置，webhook 拒绝接收",
        "not_configured",
      );
    }

    const sig = headers["stripe-signature"];
    if (!sig) {
      throw new PaymentWebhookError("Missing stripe-signature");
    }

    const stripe = this.requireClient();
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid signature";
      throw new PaymentWebhookError(message);
    }

    return this.normalizeEvent(event, stripe);
  }

  /**
   * Stripe event → UnifiedBillingEvent 归一化（设计文档 §5.4 映射表）。
   * 未知事件类型返回 null（路由跳过，但先过幂等占位，与现状 default break 一致）。
   */
  private async normalizeEvent(
    event: Stripe.Event,
    stripe: Stripe,
  ): Promise<UnifiedBillingEvent | null> {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object;
        // 仅处理订阅模式会话，其他模式（一次性支付等）不属于本产品计费流
        if (s.mode !== "subscription") return null;
        const wid = s.metadata?.workspaceId;
        const customerId = asString(s.customer);
        const subId = asString(s.subscription);
        if (!wid || !customerId || !subId) {
          console.error(
            `[stripe-webhook] checkout.session.completed 缺失关键 metadata，无法激活订阅: event=${event.id}`,
          );
          return null;
        }
        // seats 优先读 metadata.seats（新会话必有），缺失 fallback subscriptions.retrieve（兼容迁移窗口期旧 session）
        let seats = 1;
        const metadataSeats = s.metadata?.seats;
        if (metadataSeats) {
          const parsed = Number(metadataSeats);
          if (Number.isFinite(parsed) && parsed >= 1) seats = parsed;
        } else {
          try {
            const full = await stripe.subscriptions.retrieve(subId);
            seats = full.items?.data?.[0]?.quantity ?? 1;
          } catch (e) {
            console.error(`[stripe-webhook] 订阅详情拉取失败 event=${event.id}:`, e);
          }
        }
        const period: BillingPeriod = s.metadata?.period === "yearly" ? "yearly" : "monthly";
        return {
          type: "checkout.completed",
          providerEventId: event.id,
          workspaceId: wid,
          providerCustomerId: customerId,
          providerOrderId: subId,
          seats,
          period,
        };
      }
      case "customer.subscription.updated": {
        const sub = event.data.object;
        const subId = asString(sub.id);
        if (!subId) return null;
        // Stripe SDK v18+ 类型已移除 current_period_end，但 API 响应仍包含此字段
        const periodEnd = (sub as Stripe.Subscription & { current_period_end?: number })
          .current_period_end;
        return {
          type: "subscription.synced",
          providerEventId: event.id,
          providerOrderId: subId,
          status: (sub.status ?? "active") as SubscriptionStatus,
          quantity: sub.items?.data?.[0]?.quantity ?? 1,
          currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : undefined,
        };
      }
      case "invoice.payment_failed": {
        const inv = event.data.object as Stripe.Invoice & {
          subscription?: string | { id: string } | null;
        };
        const subId = asString(inv.subscription);
        if (!subId) return null;
        return {
          type: "payment.failed",
          providerEventId: event.id,
          providerOrderId: subId,
          attempt: inv.attempt_count,
        };
      }
      case "invoice.paid": {
        const inv = event.data.object;
        // FUNNEL-METRICS §4.1 #8：仅周期续费成功（subscription_cycle）；
        // 首次开通的 billing_reason 为 subscription_create，不计入续费漏斗（避免与 subscription_activated 双记）
        const billingReason = (inv as Stripe.Invoice & { billing_reason?: string }).billing_reason;
        if (billingReason !== "subscription_cycle") return null;
        // Stripe SDK v18+ Invoice 类型已移除 subscription 字段，但 API 响应仍包含
        const subId = asString(
          (inv as Stripe.Invoice & { subscription?: string | { id: string } | null }).subscription,
        );
        if (!subId) return null;
        return {
          type: "payment.succeeded",
          providerEventId: event.id,
          providerOrderId: subId,
          // quantity 在 Stripe 类型中为 number | null，统一转 undefined 适配 UnifiedBillingEvent
          quantity: inv.lines?.data?.[0]?.quantity ?? undefined,
          amountMinor: inv.amount_paid,
        };
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const subId = asString(sub.id);
        if (!subId) return null;
        const reason = (
          sub as Stripe.Subscription & {
            cancellation_details?: { reason?: string };
          }
        ).cancellation_details?.reason;
        return {
          type: "subscription.canceled",
          providerEventId: event.id,
          providerOrderId: subId,
          reason,
        };
      }
      default:
        return null;
    }
  }
}
