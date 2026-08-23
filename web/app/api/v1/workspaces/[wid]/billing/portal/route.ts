import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { requireStripe } from "@/lib/stripe";

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

  const subscription = await runWithWorkspace(
    wid,
    (tx) => tx.subscription.findUnique({ where: { workspaceId: wid } }),
    ctx.payload.sub,
  );
  if (!subscription?.stripeCustomerId) {
    return NextResponse.json(
      { code: 400, message: "尚无 Stripe 客户，请先通过升级完成订阅" },
      { status: 400 },
    );
  }

  try {
    const stripe = requireStripe();
    const origin = new URL(req.url).origin;
    const portal = await stripe.billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: `${origin}/w/${wid}/billing`,
    });
    return NextResponse.json({ code: 200, data: { url: portal.url } });
  } catch (error) {
    console.error("Billing portal error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ code: 500, message }, { status: 500 });
  }
}
