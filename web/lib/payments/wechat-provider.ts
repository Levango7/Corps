import crypto from "node:crypto";

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
  UnifiedBillingEvent,
} from "./types";

/**
 * WeChatPayNativeProvider —— 微信支付 Native（扫码）实现（ADR-003 §4 Phase 2）。
 *
 * 通道特性：
 *  - supportsAutoRenewal = false：微信委托代扣权限审核极严，普通 SaaS 类目不可用；
 *    续费由定时任务扫描临期订阅发邮件提醒 + 一键续付链接（ADR-003 §5 落地要点 4）。
 *  - capabilities.portal = false：无自助管理门户，前端隐藏「管理账单」按钮。
 *  - 扫码型通道：createCheckout 返回 qrCodeUrl（code_url），前端渲染二维码并轮询。
 *
 * 签名方案（S8 修复：RSA-SHA256，符合微信支付 V3 规范）：
 *  请求签名使用商户 RSA 私钥（SHA256withRSA）对签名串做非对称签名，
 *  回调验签使用微信平台公钥（RSA-SHA256 verify）。
 *  私钥经 WECHAT_PRIVATE_KEY_PEM 环境变量传入（PEM 格式字符串），
 *  平台公钥经 WECHAT_PLATFORM_PUBLIC_KEY_PEM 环境变量传入。
 *  若未配置 RSA 密钥对，回退到 HMAC-SHA256（仅限沙箱/测试环境，
 *  生产环境必须配置 RSA 密钥，否则签名无法通过微信 V3 验签）。
 *  回调敏感字段解密使用 AES-256-GCM（APIv3 密钥 = WECHAT_API_KEY），与官方一致。
 *
 * 环境变量：
 *  - WECHAT_APP_ID：应用 ID
 *  - WECHAT_MCH_ID：商户号
 *  - WECHAT_API_KEY：APIv3 密钥（32 字节，用于 AES-256-GCM 解密；HMAC 回退时也用于签名）
 *  - WECHAT_CERT_SERIAL_NO：商户证书序列号
 *  - WECHAT_PRIVATE_KEY_PEM：商户 RSA 私钥（PEM 格式，S8 修复：用于请求 RSA-SHA256 签名）
 *  - WECHAT_PLATFORM_PUBLIC_KEY_PEM：微信平台公钥（PEM 格式，用于回调 RSA-SHA256 验签）
 *  - WECHAT_PRICE_CENTS_MONTHLY：月付单价（分），默认 5900（¥59，ADR-003 定价）
 *  - WECHAT_PRICE_CENTS_YEARLY：年付单价（分），默认 59000（¥590）
 *  - WECHAT_NOTIFY_URL：回调通知地址，缺省由 NEXT_PUBLIC_APP_URL 拼接
 */

const WECHAT_APP_ID = process.env.WECHAT_APP_ID;
const WECHAT_MCH_ID = process.env.WECHAT_MCH_ID;
const WECHAT_API_KEY = process.env.WECHAT_API_KEY;
const WECHAT_CERT_SERIAL_NO = process.env.WECHAT_CERT_SERIAL_NO;
const WECHAT_PRIVATE_KEY_PEM = process.env.WECHAT_PRIVATE_KEY_PEM;
const WECHAT_PLATFORM_PUBLIC_KEY_PEM = process.env.WECHAT_PLATFORM_PUBLIC_KEY_PEM;
const WECHAT_PRICE_CENTS_MONTHLY = process.env.WECHAT_PRICE_CENTS_MONTHLY;
const WECHAT_PRICE_CENTS_YEARLY = process.env.WECHAT_PRICE_CENTS_YEARLY;
const WECHAT_NOTIFY_URL = process.env.WECHAT_NOTIFY_URL;

/** 微信支付 V3 网关。沙箱可经 WECHAT_API_BASE 覆盖（环境隔离） */
const WECHAT_API_BASE = process.env.WECHAT_API_BASE ?? "https://api.mch.weixin.qq.com";

/** 月付单价（分）：环境变量优先，缺省 5900 = ¥59（ADR-003 定价） */
const PRICE_MONTHLY_CENTS = Number(WECHAT_PRICE_CENTS_MONTHLY ?? 5900);
/** 年付单价（分）：环境变量优先，缺省 59000 = ¥590（ADR-003 定价，10/11 折扣） */
const PRICE_YEARLY_CENTS = Number(WECHAT_PRICE_CENTS_YEARLY ?? 59000);

/** 订单号前缀，便于在通道侧对账时识别来源 */
const OUT_TRADE_NO_PREFIX = "corps_";

/**
 * HMAC-SHA256 签名（HMAC 回退模式，仅限沙箱/测试环境）。
 * 返回 Base64 编码的签名值。生产环境应使用 rsaSha256Sign。
 */
function hmacSha256Sign(key: string, data: string): string {
  const hmac = crypto.createHmac("sha256", key);
  hmac.update(data, "utf8");
  return hmac.digest("base64");
}

/**
 * HMAC-SHA256 验签：对签名串重算并常量时间比较，防时序攻击。
 */
function hmacSha256Verify(key: string, data: string, signature: string): boolean {
  const expected = hmacSha256Sign(key, data);
  // crypto.timingSafeEqual 要求等长 Buffer；不同长度直接判否
  const a = Buffer.from(expected, "base64");
  const b = Buffer.from(signature, "base64");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * S8 修复：RSA-SHA256 签名（微信支付 V3 规范）。
 * 使用商户 RSA 私钥对签名串做 SHA256withRSA 签名，返回 Base64 编码的签名值。
 *
 * @param privateKeyPem - 商户 RSA 私钥（PEM 格式字符串）
 * @param data - 签名串
 * @returns Base64 编码的签名值
 */
function rsaSha256Sign(privateKeyPem: string, data: string): string {
  const privateKey = crypto.createPrivateKey({
    key: privateKeyPem,
    format: "pem",
    type: "pkcs8",
  });
  const signature = crypto.sign("sha256", Buffer.from(data, "utf8"), privateKey);
  return signature.toString("base64");
}

/**
 * S8 修复：RSA-SHA256 验签（微信支付 V3 回调验签）。
 * 使用微信平台公钥验证签名，常量时间比较由 OpenSSL 内部保证。
 *
 * @param publicKeyPem - 微信平台公钥（PEM 格式字符串）
 * @param data - 签名串
 * @param signature - Base64 编码的签名值
 * @returns 验签是否通过
 */
function rsaSha256Verify(publicKeyPem: string, data: string, signature: string): boolean {
  try {
    const publicKey = crypto.createPublicKey({
      key: publicKeyPem,
      format: "pem",
      type: "spki",
    });
    const signatureBuf = Buffer.from(signature, "base64");
    return crypto.verify("sha256", Buffer.from(data, "utf8"), publicKey, signatureBuf);
  } catch {
    return false;
  }
}

// R9D-07 修复：HMAC 回退警告用模块级布尔标志去重，避免每次签名/验签都刷一条
// 相同的 warn 日志（高频回调场景下日志会被同一条警告淹没）。
let hmacFallbackSignWarned = false;
let hmacFallbackVerifyWarned = false;

/**
 * S8 修复：请求签名调度——有 RSA 私钥用 RSA-SHA256，否则回退 HMAC-SHA256。
 * 生产环境必须配置 WECHAT_PRIVATE_KEY_PEM，否则签名无法通过微信 V3 验签。
 */
function signRequest(data: string): string {
  if (WECHAT_PRIVATE_KEY_PEM) {
    return rsaSha256Sign(WECHAT_PRIVATE_KEY_PEM, data);
  }
  // HMAC 回退（仅沙箱/测试）：未配置 RSA 私钥时用 APIv3 密钥做 HMAC
  // R9D-07：模块级布尔标志去重，仅首次回退时警告一次
  if (!hmacFallbackSignWarned) {
    hmacFallbackSignWarned = true;
    console.warn(
      "[wechat] RSA private key not configured, falling back to HMAC. This is only safe for sandbox/testing.",
    );
  }
  if (!WECHAT_API_KEY) {
    throw new PaymentProviderError(
      "微信支付签名密钥未配置（需 WECHAT_PRIVATE_KEY_PEM 用于 RSA-SHA256，或 WECHAT_API_KEY 用于 HMAC 回退）",
      "not_configured",
    );
  }
  return hmacSha256Sign(WECHAT_API_KEY, data);
}

/**
 * S8 修复：回调验签调度——有平台公钥用 RSA-SHA256，否则回退 HMAC-SHA256。
 * 生产环境必须配置 WECHAT_PLATFORM_PUBLIC_KEY_PEM。
 */
function verifyCallback(data: string, signature: string): boolean {
  if (WECHAT_PLATFORM_PUBLIC_KEY_PEM) {
    return rsaSha256Verify(WECHAT_PLATFORM_PUBLIC_KEY_PEM, data, signature);
  }
  // HMAC 回退（仅沙箱/测试）
  // R9D-07：模块级布尔标志去重，仅首次回退时警告一次
  if (!hmacFallbackVerifyWarned) {
    hmacFallbackVerifyWarned = true;
    console.warn(
      "[wechat] RSA platform public key not configured, falling back to HMAC verify. This is only safe for sandbox/testing.",
    );
  }
  if (!WECHAT_API_KEY) return false;
  return hmacSha256Verify(WECHAT_API_KEY, data, signature);
}

/**
 * AES-256-GCM 解密（APIv3 密钥解密回调 resource.ciphertext）。
 * 与微信支付 V3 官方一致：key=APIv3 密钥，iv=nonce，aad=associated_data。
 */
function aesGcmDecrypt(
  key: string,
  ciphertextBase64: string,
  nonce: string,
  associatedData: string,
): string {
  const keyBuf = Buffer.from(key, "utf8");
  if (keyBuf.length !== 32) {
    throw new PaymentWebhookError("WECHAT_API_KEY 长度必须为 32 字节（APIv3 密钥）");
  }
  const ciphertext = Buffer.from(ciphertextBase64, "base64");
  // GCM 模式最后 16 字节为 authTag
  const authTag = ciphertext.subarray(ciphertext.length - 16);
  const encrypted = ciphertext.subarray(0, ciphertext.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyBuf, Buffer.from(nonce, "utf8"));
  decipher.setAuthTag(authTag);
  if (associatedData) {
    decipher.setAAD(Buffer.from(associatedData, "utf8"));
  }
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

/** 生成商户侧订单号：corps_{timestamp}_{random}，保证全局唯一 */
function generateOutTradeNo(): string {
  const ts = Date.now();
  const rand = crypto.randomBytes(8).toString("hex");
  return `${OUT_TRADE_NO_PREFIX}${ts}_${rand}`;
}

/** 生成随机串（nonce_str），用于签名串与请求头 */
function generateNonce(): string {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * 构造微信 V3 请求签名串并生成 Authorization 头。
 * 签名串格式：HTTP方法\nURL路径\n时间戳\n随机串\n请求体\n
 */
function buildAuthHeader(method: string, urlPath: string, body: string): string {
  if (!WECHAT_APP_ID || !WECHAT_MCH_ID || !WECHAT_API_KEY || !WECHAT_CERT_SERIAL_NO) {
    throw new PaymentProviderError(
      "微信支付配置不完整（需 WECHAT_APP_ID / WECHAT_MCH_ID / WECHAT_API_KEY / WECHAT_CERT_SERIAL_NO）",
      "not_configured",
    );
  }
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = generateNonce();
  // 签名串：method\nurl\ntimestamp\nnonce\nbody\n（V3 规范，末尾换行不可省略）
  const signString = `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${body}\n`;
  // S8 修复：使用 RSA-SHA256 签名（有私钥时），否则回退 HMAC-SHA256
  const signature = signRequest(signString);
  // Authorization 头格式对齐 V3（WECHATPAY2-SHA256-RSA2048）
  return `WECHATPAY2-SHA256-RSA2048 mchid="${WECHAT_MCH_ID}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${WECHAT_CERT_SERIAL_NO}",signature="${signature}"`;
}

/** 微信 V3 API 请求超时（M19 修复：30 秒，防止挂起请求占连接） */
const WECHAT_API_TIMEOUT_MS = 30_000;

/** 发送微信 V3 API 请求的统一封装 */
async function wechatApi<T>(
  method: "POST" | "GET",
  urlPath: string,
  bodyObj?: Record<string, unknown>,
): Promise<T> {
  const body = bodyObj ? JSON.stringify(bodyObj) : "";
  const authHeader = buildAuthHeader(method, urlPath, body);
  const url = `${WECHAT_API_BASE}${urlPath}`;
  // M19 修复：添加 AbortController 超时，防止网络挂起导致请求无限等待
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), WECHAT_API_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: method === "POST" ? body : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    // AbortError → 超时；其他 → 网络错误
    if (err instanceof Error && err.name === "AbortError") {
      throw new PaymentProviderError(
        `微信支付 API 请求超时（${WECHAT_API_TIMEOUT_MS}ms）: ${method} ${urlPath}`,
        "channel_error",
      );
    }
    throw new PaymentProviderError(
      `微信支付 API 网络错误: ${err instanceof Error ? err.message : "unknown"}`,
      "channel_error",
    );
  } finally {
    clearTimeout(timeoutId);
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new PaymentProviderError(
      `微信支付 API 调用失败: ${res.status} ${errText.slice(0, 200)}`,
      "channel_error",
    );
  }
  return (await res.json()) as T;
}

/** 微信 V3 Native 下单响应 */
interface WechatNativeResponse {
  code_url: string;
}

/** 微信 V3 查单响应（仅取需要的字段） */
interface WechatQueryResponse {
  trade_state: string;
  trade_state_desc?: string;
  out_trade_no?: string;
  transaction_id?: string;
  amount?: { total: number };
}

/** 微信 V3 回调通知外层结构 */
interface WechatNotifyEnvelope {
  id: string;
  create_time: string;
  event_type: string;
  resource: {
    algorithm: string;
    ciphertext: string;
    associated_data: string;
    nonce: string;
    original_type?: string;
  };
}

/** 回调解密后的支付结果 */
interface WechatPayResult {
  out_trade_no: string;
  transaction_id: string;
  trade_state: string;
  trade_state_desc?: string;
  success_time?: string;
  amount?: { total: number; payer_total?: number; currency?: string };
  attach?: string; // 商户附加数据（我们存 workspaceId|seats|period）
}

export class WeChatPayNativeProvider implements PaymentProvider {
  readonly id: ProviderId = "wechatpay-native";
  readonly supportsAutoRenewal = false;
  readonly capabilities: PaymentProviderCapabilities = { portal: false };

  /**
   * 是否已配置就绪：四项必填环境变量齐备。
   * getPaymentProviderSafe 据此返回 null，前端隐藏微信支付入口。
   */
  get isConfigured(): boolean {
    return Boolean(WECHAT_APP_ID && WECHAT_MCH_ID && WECHAT_API_KEY && WECHAT_CERT_SERIAL_NO);
  }

  /** 配置校验：未配置时抛 not_configured */
  private requireConfig(): void {
    if (!this.isConfigured) {
      throw new PaymentProviderError(
        "微信支付配置不完整（需 WECHAT_APP_ID / WECHAT_MCH_ID / WECHAT_API_KEY / WECHAT_CERT_SERIAL_NO）",
        "not_configured",
      );
    }
  }

  /** 解析回调地址：环境变量优先，缺省由 NEXT_PUBLIC_APP_URL 拼接 */
  private resolveNotifyUrl(): string {
    if (WECHAT_NOTIFY_URL) return WECHAT_NOTIFY_URL;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (!appUrl) {
      throw new PaymentProviderError(
        "WECHAT_NOTIFY_URL 或 NEXT_PUBLIC_APP_URL 未配置，无法构造微信回调地址",
        "not_configured",
      );
    }
    return `${new URL(appUrl).origin}/api/v1/billing/webhook/wechat`;
  }

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    this.requireConfig();
    const period: BillingPeriod = req.period ?? "monthly";

    // 价格计算：单价 × 席位数。年付为年单价，月付为月单价（均为分）
    const unitCents = period === "yearly" ? PRICE_YEARLY_CENTS : PRICE_MONTHLY_CENTS;
    if (!Number.isFinite(unitCents) || unitCents <= 0) {
      throw new PaymentProviderError(
        period === "yearly"
          ? "年付价格未配置或非法（请设置 WECHAT_PRICE_CENTS_YEARLY）"
          : "月付价格未配置或非法（请设置 WECHAT_PRICE_CENTS_MONTHLY）",
        period === "yearly" ? "unsupported_period" : "not_configured",
      );
    }
    const totalCents = unitCents * req.seats;

    const outTradeNo = generateOutTradeNo();
    // attach 透传业务上下文（回调时恢复 workspaceId/seats/period）；
    // 微信 attach 上限 127 字节，用 | 分隔紧凑编码
    const attach = `${req.workspaceId}|${req.seats}|${period}`;

    const notifyUrl = this.resolveNotifyUrl();

    try {
      const resp = await wechatApi<WechatNativeResponse>("POST", "/v3/pay/transactions/native", {
        appid: WECHAT_APP_ID,
        mchid: WECHAT_MCH_ID,
        description: `Corps Pro 席位订阅 (${req.seats} 席 ${period === "yearly" ? "年付" : "月付"})`,
        out_trade_no: outTradeNo,
        time_expire: undefined, // 缺省 2 小时，足够扫码
        attach,
        notify_url: notifyUrl,
        amount: {
          total: totalCents,
          currency: "CNY",
        },
      });

      return {
        qrCodeUrl: resp.code_url,
        providerOrderId: outTradeNo,
        providerId: "wechatpay-native",
      };
    } catch (err) {
      if (err instanceof PaymentProviderError) throw err;
      throw new PaymentProviderError(
        err instanceof Error ? err.message : "微信 Native 下单失败",
        "channel_error",
      );
    }
  }

  async createPortal(_ctx: PortalContext): Promise<PaymentPortalResult | null> {
    // 微信 Native 手动续费模式无自助管理门户
    return null;
  }

  async syncSubscription(ctx: SyncSubscriptionContext): Promise<void> {
    // 微信支付无自动续扣，席位数量变更在下一次付款时生效
    console.warn(
      `[wechat-provider] syncSubscription no-op（手动续费模式）order=${ctx.providerOrderId} seats=${ctx.seats}`,
    );
  }

  async parseWebhook(
    rawBody: string,
    headers: Record<string, string>,
  ): Promise<UnifiedBillingEvent | null> {
    this.requireConfig();
    if (!WECHAT_API_KEY) {
      throw new PaymentProviderError("WECHAT_API_KEY 未配置，webhook 拒绝接收", "not_configured");
    }

    // 微信 V3 回调验签头（键名小写，对齐 Node fetch Headers 规范化）
    const timestamp = headers["wechatpay-timestamp"];
    const nonce = headers["wechatpay-nonce"];
    const signature = headers["wechatpay-signature"];
    if (!timestamp || !nonce || !signature) {
      throw new PaymentWebhookError("Missing WechatPay signature headers");
    }

    // 验签：签名串 = timestamp\nnonce\nbody\n
    // S8 修复：使用 RSA-SHA256 验签（有平台公钥时），否则回退 HMAC-SHA256
    const signString = `${timestamp}\n${nonce}\n${rawBody}\n`;
    if (!verifyCallback(signString, signature)) {
      throw new PaymentWebhookError("WeChatPay signature verification failed");
    }

    // 解析外层通知
    let envelope: WechatNotifyEnvelope;
    try {
      envelope = JSON.parse(rawBody) as WechatNotifyEnvelope;
    } catch {
      throw new PaymentWebhookError("WeChatPay notify body is not valid JSON");
    }

    // 仅处理支付结果通知（pay.success）；其他类型（退款等）暂不处理
    if (envelope.event_type !== "pay.success" && envelope.event_type !== "TRANSACTION.SUCCESS") {
      console.warn(
        `[wechat-webhook] 跳过非支付成功事件: type=${envelope.event_type} id=${envelope.id}`,
      );
      return null;
    }

    // 解密 resource.ciphertext
    let payResult: WechatPayResult;
    try {
      const decrypted = aesGcmDecrypt(
        WECHAT_API_KEY,
        envelope.resource.ciphertext,
        envelope.resource.nonce,
        envelope.resource.associated_data,
      );
      payResult = JSON.parse(decrypted) as WechatPayResult;
    } catch (err) {
      throw new PaymentWebhookError(
        `WeChatPay resource decryption failed: ${err instanceof Error ? err.message : "unknown"}`,
      );
    }

    // 从 attach 恢复业务上下文
    const attach = payResult.attach ?? "";
    const parts = attach.split("|");
    if (parts.length < 3) {
      console.error(
        `[wechat-webhook] attach 缺失或格式错误，无法激活订阅: attach="${attach}" event=${envelope.id}`,
      );
      return null;
    }
    const workspaceId = parts[0];
    const seats = Number(parts[1]);
    const period: BillingPeriod = parts[2] === "yearly" ? "yearly" : "monthly";
    if (!workspaceId || !Number.isFinite(seats) || seats < 1) {
      console.error(
        `[wechat-webhook] attach 解析失败: workspaceId=${workspaceId} seats=${seats} event=${envelope.id}`,
      );
      return null;
    }

    // trade_state 映射
    // SUCCESS → checkout.completed（首次支付成功）
    // 其他状态暂不映射（退款/关闭等由对账任务处理）
    if (payResult.trade_state !== "SUCCESS") {
      console.warn(
        `[wechat-webhook] 非 SUCCESS 状态，跳过: state=${payResult.trade_state} order=${payResult.out_trade_no}`,
      );
      return null;
    }

    return {
      type: "checkout.completed",
      providerEventId: envelope.id,
      workspaceId,
      // 微信无客户概念，用 mchid 作为占位（后续如需退款对账用 transaction_id）
      providerCustomerId: WECHAT_MCH_ID ?? "wechat_mch",
      providerOrderId: payResult.out_trade_no,
      seats,
      period,
    };
  }

  /**
   * 查询订单状态（供前端轮询调用，非 PaymentProvider 接口方法）。
   * 路由层经 getPaymentProvider 拿到实例后可调用此方法。
   */
  async queryOrder(outTradeNo: string): Promise<WechatQueryResponse> {
    this.requireConfig();
    const urlPath = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}?mchid=${WECHAT_MCH_ID}`;
    try {
      return await wechatApi<WechatQueryResponse>("GET", urlPath);
    } catch (err) {
      if (err instanceof PaymentProviderError) throw err;
      throw new PaymentProviderError(
        err instanceof Error ? err.message : "微信查单失败",
        "channel_error",
      );
    }
  }
}
