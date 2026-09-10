import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { getPaymentProvider, PaymentProviderError } from "@/lib/payments";
import { apiMsg } from "@/lib/api-messages";

export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });
  if (ctx.member.role !== "owner") {
    return NextResponse.json(
      { code: 403, message: apiMsg(req, "onlyOwnerManageBilling"), data: null },
      { status: 403 },
    );
  }

  try {
    // M-1 修复（TC-RLS-07 同类）：subscriptions 表在加固模式下带 RLS + FORCE，
    // DB 操作必须携带工作区 GUC 上下文。subscription 查询在此包裹 runWithWorkspace
    // （与 checkout/route.ts 先例同款），customerId 查得后传入 provider；
    // provider 内部不再直连 prisma（无上下文直连在 RLS_ACTIVATE=true 下恒空 → 恒 400）。
    const subscription = await runWithWorkspace(
      wid,
      (tx) =>
        tx.subscription.findUnique({
          where: { workspaceId: wid },
          select: { stripeCustomerId: true },
        }),
      ctx.payload.sub,
    );
    const provider = getPaymentProvider();
    const result = await provider.createPortal({
      workspaceId: wid,
      providerCustomerId: subscription?.stripeCustomerId ?? undefined,
    });
    // D5：通道整体不支持 portal 时返回 null → 501
    // Phase 1 StripeProvider 恒返回 portal URL，该分支实际不可达；
    // 它是为 PAYMENT_PROVIDER 切换后的部署形态准备的。
    if (result === null) {
      return NextResponse.json(
        { code: 501, message: apiMsg(req, "portalNotSupported"), data: null },
        { status: 501 },
      );
    }
    return NextResponse.json({ code: 200, data: { url: result.url } });
  } catch (error) {
    if (error instanceof PaymentProviderError) {
      if (error.code === "no_customer") {
        console.error("[billing portal] no_customer:", error.message);
        return NextResponse.json({ code: 400, message: apiMsg(req, "noCustomerAccount"), data: null }, { status: 400 });
      }
      if (error.code === "not_configured") {
        console.error("[billing portal] not_configured:", error.message);
        return NextResponse.json({ code: 501, message: apiMsg(req, "portalNotSupported"), data: null }, { status: 501 });
      }
    }
    console.error("Billing portal error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "billingUnavailable"), data: null },
      { status: 500 },
    );
  }
}
