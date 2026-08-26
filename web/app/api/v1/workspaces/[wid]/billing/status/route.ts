import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { getPaymentProviderSafe } from "@/lib/payments";

/** GET /v1/workspaces/{wid}/billing/status — 当前套餐、席位占用与订阅状态 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });

  try {
    // P3-4：getPaymentProviderSafe 探测 secret + 价格就绪性，
    // 保持现状 stripeReady = Boolean(stripe && STRIPE_PRICE_ID) 语义
    const provider = getPaymentProviderSafe();
    const stripeReady = provider !== null;
    // D5：portalReady = 通道支持 portal 且 stripeReady（前端据此隐藏「管理订阅」按钮）
    const portalReady = Boolean(provider?.capabilities.portal && stripeReady);

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
      ctx.payload.sub,
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
        stripeReady,
        // 新增 portalReady：createPortal=null 语义在前端的静态预判（D5）
        portalReady,
        subscription: subscription
          ? {
              status: subscription.status,
              quantity: subscription.quantity,
              currentPeriodEnd: subscription.currentPeriodEnd,
              // 通道无关化：有通道侧订单号且 portalReady 时可管理（字段名不变，语义泛化）
              canManage: Boolean(subscription.providerOrderId) && portalReady,
            }
          : null,
      },
    });
  } catch (error) {
    console.error("[GET billing/status] error:", error);
    return NextResponse.json({ code: 500, data: null, message: "服务器内部错误" }, { status: 500 });
  }
}
