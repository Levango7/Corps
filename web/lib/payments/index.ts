import type { PaymentProvider, ProviderId } from "./types";
import { StripeProvider } from "./stripe-provider";

export { FREE_SEAT_LIMIT } from "./stripe-provider";
export type {
  BillingPeriod,
  CheckoutRequest,
  CheckoutResult,
  PaymentPortalResult,
  PaymentProvider,
  PaymentProviderCapabilities,
  PortalContext,
  ProviderId,
  SyncSubscriptionContext,
  SubscriptionStatus,
  UnifiedBillingEvent,
} from "./types";
// PaymentProviderError / PaymentWebhookError 是 class（值），用 export 导出而非 export type
export { PaymentProviderError, PaymentWebhookError } from "./types";

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

/**
 * 安全获取支付通道实例：配置不就绪时返回 null 而非抛错。
 *
 * P3-4：除捕获构造期错误外，对返回的实例额外探测 isConfigured（secret + 价格就绪性），
 * 保持现状 `stripeReady = Boolean(stripe && STRIPE_PRICE_ID)` 语义：
 * secret 或价格缺失 ⇒ 返回 null ⇒ status 路由 stripeReady=false，前端隐藏升级入口。
 *
 * status 路由使用本出口；checkout/portal/webhook 使用严格版 getPaymentProvider。
 * 两出口共享同一缓存。
 */
export function getPaymentProviderSafe(id?: ProviderId): PaymentProvider | null {
  try {
    const instance = getPaymentProvider(id);
    if (!instance.isConfigured) return null;
    return instance;
  } catch {
    return null;
  }
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
