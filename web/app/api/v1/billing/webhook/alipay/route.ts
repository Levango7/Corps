import { NextRequest, NextResponse } from "next/server";
import { getPaymentProvider, PaymentProviderError, PaymentWebhookError } from "@/lib/payments";
import { handleBillingEvent } from "@/lib/billing/webhook-handler";

/**
 * POST /api/v1/billing/webhook/alipay — 支付宝异步回调（ADR-003 §5 落地要点 3）。
 *
 * 分层：
 *  - provider.parseWebhook：RSA2 验签 + 事件归一化
 *  - handleBillingEvent：幂等占位 + 通道无关落库 + 埋点
 *
 * 支付宝回调特性：
 *  - 以 application/x-www-form-urlencoded 形式发送
 *  - sign 字段在 body 中（非 header）
 *  - 验签失败必须返回非 200（否则支付宝认为通知已处理，不再重试）
 *  - 处理成功返回 200 纯文本 "success"（支付宝要求，非 JSON）
 *
 * 幂等：processed_payment_events (provider='alipay-page', event_id=notify_id)
 */
export async function POST(req: NextRequest) {
  const provider = getPaymentProvider("alipay-page");

  let event;
  try {
    // 支付宝以 form-urlencoded 发送，req.text() 获取原始键值对字符串
    const rawBody = await req.text();
    event = await provider.parseWebhook(rawBody, {});
  } catch (err) {
    // 验签失败 → 400（支付宝会重试）
    if (err instanceof PaymentWebhookError) {
      console.error("[alipay-webhook] signature error:", err.message);
      return new NextResponse("fail", { status: 400 });
    }
    // not_configured → 500 拒收
    if (err instanceof PaymentProviderError && err.code === "not_configured") {
      return new NextResponse("fail", { status: 500 });
    }
    console.error("[alipay-webhook] parse error:", err);
    return new NextResponse("fail", { status: 500 });
  }

  // 未知/忽略事件 → 应答 success（支付宝要求处理成功返回 "success"）
  if (!event) {
    return new NextResponse("success", { status: 200 });
  }

  // 统一事件处理（幂等 + 落库 + 埋点）
  const result = await handleBillingEvent(event, "alipay-page");
  // handleBillingEvent 返回 JSON NextResponse；支付宝要求纯文本 "success"
  // 检查 HTTP status：成功则应答 "success"，失败保持原响应
  if (result.status === 200) {
    return new NextResponse("success", { status: 200 });
  }
  return result;
}
