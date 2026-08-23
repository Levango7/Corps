import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { requireStripe, STRIPE_PRICE_ID } from "@/lib/stripe";
import { z } from "zod";

const checkoutSchema = z.object({
  priceId: z.string().optional(),
  successUrl: z.string().optional(),
  cancelUrl: z.string().optional(),
});

/**
 * A-4 开放重定向防护：仅允许同源 URL（origin 匹配本应用）。
 * 非法/跨域 URL 一律回退到默认值，避免钓鱼重定向。
 * 允许的 origin 来源：
 *   1. NEXT_PUBLIC_APP_URL（生产/预览部署域名）
 *   2. 当前请求的 origin（覆盖 localhost、内网预览等环境）
 */
function safeRedirectUrl(input: string | undefined, fallback: string, requestOrigin: string): string {
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

  const body = checkoutSchema.parse(await req.json().catch(() => ({})));
  const priceId = body.priceId ?? STRIPE_PRICE_ID;
  if (!priceId) {
    return NextResponse.json(
      { code: 400, message: "STRIPE_PRICE_ID 未配置（请在环境变量设置测试价格 ID）" },
      { status: 400 },
    );
  }

  try {
    const stripe = requireStripe();
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

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: subscription?.stripeCustomerId ?? undefined,
      line_items: [{ price: priceId, quantity: Math.max(workspace?.seatLimit ?? 1, 1) }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { workspaceId: wid },
    });

    return NextResponse.json({ code: 200, data: { url: session.url } });
  } catch (error) {
    console.error("Billing checkout error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ code: 500, message }, { status: 500 });
  }
}
