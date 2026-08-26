import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { trackServerEvent } from "@/lib/analytics-server";
import { getPaymentProvider, PaymentProviderError } from "@/lib/payments";
import { z } from "zod";

// P3-2 / 裁决三：checkout/route.ts 归支付线独占。period 字段并入本线交付。
const checkoutSchema = z.object({
  priceId: z.string().optional(),
  successUrl: z.string().optional(),
  cancelUrl: z.string().optional(),
  // 计费周期：缺省 monthly（保持存量客户端行为不变）；非法值由 zod 400 兜底（契约③）
  period: z.enum(["monthly", "yearly"]).optional(),
});

/**
 * A-4 开放重定向防护：仅允许同源 URL（origin 匹配本应用）。
 * 非法/跨域 URL 一律回退到默认值，避免钓鱼重定向。
 * 允许的 origin 来源：
 *   1. NEXT_PUBLIC_APP_URL（生产/预览部署域名）
 *   2. 当前请求的 origin（覆盖 localhost、内网预览等环境）
 */
function safeRedirectUrl(
  input: string | undefined,
  fallback: string,
  requestOrigin: string,
): string {
  if (!input) return fallback;
  try {
    const parsed = new URL(input);
    const allowedOrigins = new Set<string>([requestOrigin]);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (appUrl) {
      try {
        allowedOrigins.add(new URL(appUrl).origin);
      } catch {
        /* NEXT_PUBLIC_APP_URL 配置异常时忽略，不影响请求 origin 比对 */
      }
    }
    if (allowedOrigins.has(parsed.origin)) {
      return parsed.toString();
    }
  } catch {
    /* 非法 URL 直接回退 */
  }
  return fallback;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });
  if (ctx.member.role !== "owner") {
    return NextResponse.json(
      { code: 403, message: "Only owner can manage billing" },
      { status: 403 },
    );
  }

  try {
    const body = checkoutSchema.parse(await req.json().catch(() => ({})));
    const { workspace, subscription } = await runWithWorkspace(
      wid,
      async (tx) => ({
        workspace: await tx.workspace.findUnique({ where: { id: wid } }),
        subscription: await tx.subscription.findUnique({ where: { workspaceId: wid } }),
      }),
      ctx.payload.sub,
    );
    if (!workspace) {
      return NextResponse.json({ code: 404, message: "工作区不存在" }, { status: 404 });
    }
    const origin = new URL(req.url).origin;
    const defaultSuccessUrl = `${origin}/w/${wid}/billing?success=1&session_id={CHECKOUT_SESSION_ID}`;
    const defaultCancelUrl = `${origin}/w/${wid}/billing?canceled=1`;
    // A-4: 校验 successUrl / cancelUrl 必须同源，防止开放重定向到恶意站点
    const successUrl = safeRedirectUrl(body.successUrl, defaultSuccessUrl, origin);
    const cancelUrl = safeRedirectUrl(body.cancelUrl, defaultCancelUrl, origin);

    const seats = Math.max(workspace.seatLimit ?? 1, 1);
    const provider = getPaymentProvider();
    const result = await provider.createCheckout({
      workspaceId: wid,
      seats,
      period: body.period,
      priceOverride: body.priceId,
      successUrl,
      cancelUrl,
      providerCustomerId: subscription?.stripeCustomerId ?? undefined,
    });

    // P2 数据埋点：billing_checkout 事件（不阻塞主流程）
    // P3-2：props 扩 period（契约⑥，缺省 monthly 时键仍写出以稳定下游聚合口径）
    await trackServerEvent({
      userId: ctx.payload.sub,
      workspaceId: wid,
      name: "billing_checkout",
      props: { seatLimit: seats, period: body.period ?? "monthly" },
    });

    return NextResponse.json({ code: 200, data: { url: result.redirectUrl } });
  } catch (error) {
    // 错误映射：not_configured/unsupported_period → 400；其余 → 500
    if (error instanceof PaymentProviderError) {
      if (error.code === "unsupported_period") {
        return NextResponse.json({ code: 400, message: "年付价格未配置" }, { status: 400 });
      }
      if (error.code === "not_configured") {
        return NextResponse.json({ code: 400, message: error.message }, { status: 400 });
      }
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: "Validation error", errors: error.errors },
        { status: 400 },
      );
    }
    console.error("Billing checkout error:", error);
    return NextResponse.json(
      { code: 500, message: "计费服务暂时不可用，请稍后重试" },
      { status: 500 },
    );
  }
}
