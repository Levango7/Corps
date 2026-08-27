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
 * AlipayPageProvider —— 支付宝电脑网站支付实现（ADR-003 §4 Phase 2）。
 *
 * 通道特性：
 *  - supportsAutoRenewal = false：支付宝周期扣款需签约审核，普通 SaaS 类目不可用；
 *    续费由定时任务扫描临期订阅发邮件提醒 + 一键续付链接。
 *  - capabilities.portal = false：无自助管理门户，前端隐藏「管理账单」按钮。
 *  - 跳转型通道：createCheckout 返回 redirectUrl，前端 window.location.href 跳转。
 *
 * 签名方案（RSA2 / SHA256withRSA，对齐支付宝官方）：
 *  - 请求签名：应用私钥对参数串做 SHA256withRSA，Base64 编码
 *  - 回调验签：支付宝公钥对参数串做 SHA256withRSA 验签
 *  - 参数串：所有非空参数按 key 字典序升序排列，以 key=value&key=value 拼接
 *
 * 环境变量：
 *  - ALIPAY_APP_ID：应用 ID
 *  - ALIPAY_PRIVATE_KEY：应用私钥（纯 base64 或 PEM 格式）
 *  - ALIPAY_PUBLIC_KEY：支付宝公钥（纯 base64 或 PEM 格式）
 *  - ALIPAY_PRICE_CENTS_MONTHLY：月付单价（分），默认 5900（¥59）
 *  - ALIPAY_PRICE_CENTS_YEARLY：年付单价（分），默认 59000（¥590）
 *  - ALIPAY_NOTIFY_URL：异步回调地址，缺省由 NEXT_PUBLIC_APP_URL 拼接
 *  - ALIPAY_GATEWAY：网关地址，缺省正式环境
 */

const ALIPAY_APP_ID = process.env.ALIPAY_APP_ID;
const ALIPAY_PRIVATE_KEY = process.env.ALIPAY_PRIVATE_KEY;
const ALIPAY_PUBLIC_KEY = process.env.ALIPAY_PUBLIC_KEY;
const ALIPAY_PRICE_CENTS_MONTHLY = process.env.ALIPAY_PRICE_CENTS_MONTHLY;
const ALIPAY_PRICE_CENTS_YEARLY = process.env.ALIPAY_PRICE_CENTS_YEARLY;
const ALIPAY_NOTIFY_URL = process.env.ALIPAY_NOTIFY_URL;

/** 支付宝网关。沙箱：https://openapi-sandbox.dl.alipaydev.com/gateway.do */
const ALIPAY_GATEWAY =
  process.env.ALIPAY_GATEWAY ?? "https://openapi.alipay.com/gateway.do";

/** 月付单价（分）：环境变量优先，缺省 5900 = ¥59（ADR-003 定价） */
const PRICE_MONTHLY_CENTS = Number(ALIPAY_PRICE_CENTS_MONTHLY ?? 5900);
/** 年付单价（分）：环境变量优先，缺省 59000 = ¥590（ADR-003 定价） */
const PRICE_YEARLY_CENTS = Number(ALIPAY_PRICE_CENTS_YEARLY ?? 59000);

/** 订单号前缀 */
const OUT_TRADE_NO_PREFIX = "corps_";

/**
 * 将纯 base64 密钥包装为 PEM 格式。
 * 支付宝开放平台导出的密钥通常为纯 base64（无 PEM 头尾），需手动包装。
 * 已是 PEM 格式则原样返回。
 */
function toPem(key: string, type: "PRIVATE" | "PUBLIC"): string {
  const trimmed = key.trim();
  if (trimmed.includes("-----BEGIN")) return trimmed;
  // 每 64 字符换行（PEM 规范）
  const lines = trimmed.match(/.{1,64}/g) ?? [trimmed];
  return `-----BEGIN ${type} KEY-----\n${lines.join("\n")}\n-----END ${type} KEY-----\n`;
}

/**
 * 构造签名参数串：所有非空参数按 key 字典序升序排列，以 key=value&key=value 拼接。
 * 对齐支付宝 SDK buildSignatureContent 逻辑。
 */
function buildSignContent(params: Record<string, string | undefined>): string {
  const sortedKeys = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== "")
    .sort();
  return sortedKeys.map((k) => `${k}=${params[k]}`).join("&");
}

/**
 * RSA2 签名（SHA256withRSA）。
 * 用应用私钥对参数串签名，返回 Base64 编码的签名值。
 */
function rsa2Sign(privateKeyPem: string, data: string): string {
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(data, "utf8");
  return sign.sign(privateKeyPem, "base64");
}

/**
 * RSA2 验签：用支付宝公钥验证签名。
 * 常量时间比较防时序攻击（crypto.verify 内部已做）。
 */
function rsa2Verify(
  publicKeyPem: string,
  data: string,
  signatureBase64: string,
): boolean {
  try {
    const verify = crypto.createVerify("RSA-SHA256");
    verify.update(data, "utf8");
    return verify.verify(publicKeyPem, signatureBase64, "base64");
  } catch {
    return false;
  }
}

/** 生成商户侧订单号 */
function generateOutTradeNo(): string {
  const ts = Date.now();
  const rand = crypto.randomBytes(8).toString("hex");
  return `${OUT_TRADE_NO_PREFIX}${ts}_${rand}`;
}

/** 支付宝时间戳格式：yyyy-MM-dd HH:mm:ss */
function alipayTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 金额分转元字符串（支付宝金额单位为元，保留两位小数） */
function centsToYuan(cents: number): string {
  return (cents / 100).toFixed(2);
}

export class AlipayPageProvider implements PaymentProvider {
  readonly id: ProviderId = "alipay-page";
  readonly supportsAutoRenewal = false;
  readonly capabilities: PaymentProviderCapabilities = { portal: false };

  private privateKeyPem: string | null = null;
  private publicKeyPem: string | null = null;

  constructor() {
    // 惰性装配：将纯 base64 密钥转 PEM
    if (ALIPAY_PRIVATE_KEY) {
      try {
        this.privateKeyPem = toPem(ALIPAY_PRIVATE_KEY, "PRIVATE");
      } catch {
        this.privateKeyPem = null;
      }
    }
    if (ALIPAY_PUBLIC_KEY) {
      try {
        this.publicKeyPem = toPem(ALIPAY_PUBLIC_KEY, "PUBLIC");
      } catch {
        this.publicKeyPem = null;
      }
    }
  }

  /**
   * 是否已配置就绪：APP_ID + 私钥 + 公钥齐备。
   */
  get isConfigured(): boolean {
    return Boolean(
      ALIPAY_APP_ID && this.privateKeyPem && this.publicKeyPem,
    );
  }

  /** 配置校验 */
  private requireConfig(): void {
    if (!this.isConfigured) {
      throw new PaymentProviderError(
        "支付宝配置不完整（需 ALIPAY_APP_ID / ALIPAY_PRIVATE_KEY / ALIPAY_PUBLIC_KEY）",
        "not_configured",
      );
    }
  }

  /** 解析回调地址 */
  private resolveNotifyUrl(): string {
    if (ALIPAY_NOTIFY_URL) return ALIPAY_NOTIFY_URL;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (!appUrl) {
      throw new PaymentProviderError(
        "ALIPAY_NOTIFY_URL 或 NEXT_PUBLIC_APP_URL 未配置，无法构造支付宝回调地址",
        "not_configured",
      );
    }
    return `${new URL(appUrl).origin}/api/v1/billing/webhook/alipay`;
  }

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    this.requireConfig();
    const period: BillingPeriod = req.period ?? "monthly";

    // 价格计算
    const unitCents = period === "yearly" ? PRICE_YEARLY_CENTS : PRICE_MONTHLY_CENTS;
    if (!Number.isFinite(unitCents) || unitCents <= 0) {
      throw new PaymentProviderError(
        period === "yearly"
          ? "年付价格未配置或非法（请设置 ALIPAY_PRICE_CENTS_YEARLY）"
          : "月付价格未配置或非法（请设置 ALIPAY_PRICE_CENTS_MONTHLY）",
        period === "yearly" ? "unsupported_period" : "not_configured",
      );
    }
    const totalCents = unitCents * req.seats;
    const totalYuan = centsToYuan(totalCents);

    const outTradeNo = generateOutTradeNo();
    // passback_params 透传业务上下文（回调时返回）；支付宝上限 512 字符
    // 使用 URL 编码避免特殊字符问题
    const passbackParams = encodeURIComponent(
      `${req.workspaceId}|${req.seats}|${period}`,
    );

    const notifyUrl = this.resolveNotifyUrl();
    // 支付宝要求 return_url 与 notify_url 同域名且已报备
    const returnUrlBase = process.env.NEXT_PUBLIC_APP_URL
      ? `${new URL(process.env.NEXT_PUBLIC_APP_URL).origin}/w/${req.workspaceId}/billing?success=1`
      : `/w/${req.workspaceId}/billing?success=1`;

    // 构造 biz_content（电脑网站支付 alipay.trade.page.pay）
    const bizContent = JSON.stringify({
      out_trade_no: outTradeNo,
      total_amount: totalYuan,
      subject: `Corps Pro 席位订阅 (${req.seats} 席 ${period === "yearly" ? "年付" : "月付"})`,
      product_code: "FAST_INSTANT_TRADE_PAY",
      passback_params: passbackParams,
      // timeout_express 缺省 15m，足够跳转支付
    });

    // 构造公共请求参数
    const params: Record<string, string | undefined> = {
      app_id: ALIPAY_APP_ID,
      method: "alipay.trade.page.pay",
      format: "JSON",
      charset: "utf-8",
      sign_type: "RSA2",
      timestamp: alipayTimestamp(),
      version: "1.0",
      biz_content: bizContent,
      notify_url: notifyUrl,
      return_url: returnUrlBase,
    };

    // 签名
    const signContent = buildSignContent(params);
    const sign = rsa2Sign(this.privateKeyPem!, signContent);
    params.sign = sign;

    // 构造跳转 URL：网关 + 查询参数
    const url = new URL(ALIPAY_GATEWAY);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, v);
    }

    return {
      redirectUrl: url.toString(),
      providerOrderId: outTradeNo,
      providerId: "alipay-page",
    };
  }

  async createPortal(_ctx: PortalContext): Promise<PaymentPortalResult | null> {
    // 支付宝电脑网站支付无自助管理门户
    return null;
  }

  async syncSubscription(ctx: SyncSubscriptionContext): Promise<void> {
    // 支付宝无自动续扣，席位数量变更在下一次付款时生效
    console.warn(
      `[alipay-provider] syncSubscription no-op（手动续费模式）order=${ctx.providerOrderId} seats=${ctx.seats}`,
    );
  }

  async parseWebhook(
    rawBody: string,
    _headers: Record<string, string>,
  ): Promise<UnifiedBillingEvent | null> {
    this.requireConfig();
    if (!this.publicKeyPem) {
      throw new PaymentProviderError(
        "ALIPAY_PUBLIC_KEY 未配置，webhook 拒绝接收",
        "not_configured",
      );
    }

    // 支付宝异步通知以 application/x-www-form-urlencoded 形式发送
    // rawBody 为原始文本；解析为 key=value 对
    const params = new URLSearchParams(rawBody);
    const sign = params.get("sign");
    const signType = params.get("sign_type");
    if (!sign || signType !== "RSA2") {
      throw new PaymentWebhookError("Missing or invalid alipay sign/sign_type");
    }

    // 验签：取除 sign 和 sign_type 外的所有参数，按字典序排列拼接
    const verifyParams: Record<string, string | undefined> = {};
    for (const [k, v] of params.entries()) {
      if (k !== "sign" && k !== "sign_type") {
        verifyParams[k] = v;
      }
    }
    const signContent = buildSignContent(verifyParams);
    if (!rsa2Verify(this.publicKeyPem, signContent, sign)) {
      throw new PaymentWebhookError("Alipay signature verification failed");
    }

    // 解析通知字段
    const tradeStatus = params.get("trade_status");
    const outTradeNo = params.get("out_trade_no");

    const notifyId = params.get("notify_id"); // 通知 ID（幂等用）
    if (!outTradeNo || !notifyId) {
      console.error(
        `[alipay-webhook] 缺失 out_trade_no 或 notify_id，无法处理`,
      );
      return null;
    }

    // 仅处理交易成功状态
    // TRADE_FINISHED（交易完成，不可退款）与 TRADE_SUCCESS（交易支付成功）均视为成功
    if (tradeStatus !== "TRADE_SUCCESS" && tradeStatus !== "TRADE_FINISHED") {
      console.warn(
        `[alipay-webhook] 非成功状态，跳过: status=${tradeStatus} order=${outTradeNo}`,
      );
      return null;
    }

    // 从 passback_params 恢复业务上下文
    const passbackParams = params.get("passback_params") ?? "";
    let workspaceId: string;
    let seats: number;
    let period: BillingPeriod;
    try {
      const decoded = decodeURIComponent(passbackParams);
      const parts = decoded.split("|");
      if (parts.length < 3) throw new Error("格式错误");
      workspaceId = parts[0];
      seats = Number(parts[1]);
      period = parts[2] === "yearly" ? "yearly" : "monthly";
      if (!workspaceId || !Number.isFinite(seats) || seats < 1) {
        throw new Error("字段非法");
      }
    } catch (err) {
      console.error(
        `[alipay-webhook] passback_params 解析失败: "${passbackParams}" err=${err instanceof Error ? err.message : "unknown"}`,
      );
      return null;
    }

    return {
      type: "checkout.completed",
      providerEventId: notifyId,
      workspaceId,
      // 支付宝无客户概念，用 buyer_user_id 或占位
      providerCustomerId: params.get("buyer_user_id") ?? "alipay_buyer",
      providerOrderId: outTradeNo,
      seats,
      period,
    };
  }

  /**
   * 查询交易状态（供前端轮询调用，非 PaymentProvider 接口方法）。
   * 调用 alipay.trade.query 接口。
   */
  async queryTrade(outTradeNo: string): Promise<{
    tradeStatus: string;
    outTradeNo: string;
    tradeNo?: string;
  }> {
    this.requireConfig();

    const bizContent = JSON.stringify({ out_trade_no: outTradeNo });
    const params: Record<string, string | undefined> = {
      app_id: ALIPAY_APP_ID,
      method: "alipay.trade.query",
      format: "JSON",
      charset: "utf-8",
      sign_type: "RSA2",
      timestamp: alipayTimestamp(),
      version: "1.0",
      biz_content: bizContent,
    };
    const signContent = buildSignContent(params);
    const sign = rsa2Sign(this.privateKeyPem!, signContent);
    params.sign = sign;

    const url = new URL(ALIPAY_GATEWAY);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, v);
    }

    try {
      const res = await fetch(url.toString(), {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        throw new PaymentProviderError(
          `支付宝查单 HTTP 失败: ${res.status}`,
          "channel_error",
        );
      }
      const resp = (await res.json()) as {
        alipay_trade_query_response: {
          trade_status?: string;
          out_trade_no?: string;
          trade_no?: string;
          code?: string;
          msg?: string;
        };
      };
      const inner = resp.alipay_trade_query_response;
      if (inner.code !== "10000") {
        throw new PaymentProviderError(
          `支付宝查单业务失败: ${inner.code} ${inner.msg ?? ""}`,
          "channel_error",
        );
      }
      return {
        tradeStatus: inner.trade_status ?? "UNKNOWN",
        outTradeNo: inner.out_trade_no ?? outTradeNo,
        tradeNo: inner.trade_no,
      };
    } catch (err) {
      if (err instanceof PaymentProviderError) throw err;
      throw new PaymentProviderError(
        err instanceof Error ? err.message : "支付宝查单失败",
        "channel_error",
      );
    }
  }
}