import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { STRIPE_PRICE_ID, stripe } from "@/lib/stripe";

/** GET /v1/workspaces/{wid}/billing/status — 当前套餐、席位占用与订阅状态 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string }> }
) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });

  const result = await runWithWorkspace(
    wid,
    async (tx) => {
      const workspace = await tx.workspace.findUnique({
        where: { id: wid },
        select: { plan: true, seatLimit: true },
      });
      const memberCount = await tx.member.count({ where: { workspaceId: wid } });
      const subscription = await tx.subscription.findUnique({ where: { workspaceId: wid } });
      return { workspace, memberCount, subscription };
    },
    ctx.payload.sub
  );

  const { workspace, memberCount, subscription } = result;

  return NextResponse.json({
    code: 200,
    data: {
      plan: workspace?.plan ?? "free",
      seatLimit: workspace?.seatLimit ?? 0,
      memberCount,
      seatsUsed: memberCount,
      role: ctx.member.role,
      // 未配置 Stripe 密钥/价格时，前端隐藏升级入口而不是抛错（本地开发友好）
      stripeReady: Boolean(stripe && STRIPE_PRICE_ID),
      subscription: subscription
        ? {
            status: subscription.status,
            quantity: subscription.quantity,
            currentPeriodEnd: subscription.currentPeriodEnd,
            canManage: Boolean(subscription.stripeCustomerId),
          }
        : null,
    },
  });
}
