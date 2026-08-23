import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { requireStripe, STRIPE_PRICE_ID } from "@/lib/stripe";
import { z } from "zod";

const checkoutSchema = z.object({
  priceId: z.string().optional(),
  successUrl: z.string().optional(),
  cancelUrl: z.string().optional(),
});

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

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: subscription?.stripeCustomerId ?? undefined,
      line_items: [{ price: priceId, quantity: Math.max(workspace?.seatLimit ?? 1, 1) }],
      success_url:
        body.successUrl ?? `${origin}/w/${wid}/billing?success=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: body.cancelUrl ?? `${origin}/w/${wid}/billing?canceled=1`,
      metadata: { workspaceId: wid },
    });

    return NextResponse.json({ code: 200, data: { url: session.url } });
  } catch (error) {
    console.error("Billing checkout error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ code: 500, message }, { status: 500 });
  }
}
