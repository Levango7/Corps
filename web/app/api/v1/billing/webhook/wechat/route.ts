import { NextRequest, NextResponse } from "next/server";
import { getPaymentProvider, PaymentProviderError, PaymentWebhookError } from "@/lib/payments";
import { handleBillingEvent } from "@/lib/billing/webhook-handler";

/**
 * POST /api/v1/billing/webhook/wechat — 微信支付回调（ADR-003 §5 落地要点 3）。
 *
 * 分层：
 *  - provider.parseWebhook：HMAC-SHA256 验签 + AES-256-GCM 解密 + 事件归一化
 *  - handleBillingEvent：幂等占位 + 通道无关落库 + 埋点
 *
 * 微信回调特性：
 *  - 以 JSON 形式发送，Content-Type: application/json
 *  - 验签头：Wechatpay-Timestamp / Wechatpay-Nonce / Wechatpay-Signature
 *  - 验签失败必须返回 4xx（否则微信会持续重试）
 *  - 处理成功返回 200 { code: 0 }（微信要求 code=0 表示成功）
 *
 * 幂等：processed_payment_events (provider='wechatpay-native', event_id=通知ID)
 */
export async function POST(req: NextRequest) {
  const provider = getPaymentProvider("wechatpay-native");

  let event;
  try {
    const rawBody = await req.text();
    // 微信 V3 回调头（Node fetch Headers 规范化为小写）
    const headers: Record<string, string> = {
      "wechatpay-timestamp": req.headers.get("wechatpay-timestamp") ?? "",
      "wechatpay-nonce": req.headers.get("wechatpay-nonce") ?? "",
      "wechatpay-signature": req.headers.get("wechatpay-signature") ?? "",
      "wechatpay-serial": req.headers.get("wechatpay-serial") ?? "",
    };
    event = await provider.parseWebhook(rawBody, headers);
  } catch (err) {
    // 验签失败 → 400
    if (err instanceof PaymentWebhookError) {
      console.error("[wechat-webhook] signature error:", err.message);
      return NextResponse.json(
        { code: 400, message: `Webhook Error: ${err.message}` },
        { status: 400 },
      );
    }
    // not_configured → 500 拒收
    if (err instanceof PaymentProviderError && err.code === "not_configured") {
      return NextResponse.json({ code: 500, message: err.message }, { status: 500 });
    }
    console.error("[wechat-webhook] parse error:", err);
    return NextResponse.json({ code: 500, message: "Handler error" }, { status: 500 });
  }

  // 未知/忽略事件 → 应答 received
  if (!event) {
    return NextResponse.json({ code: 200, data: { received: true } });
  }

  // 统一事件处理（幂等 + 落库 + 埋点）
  return handleBillingEvent(event, "wechatpay-native");
}
