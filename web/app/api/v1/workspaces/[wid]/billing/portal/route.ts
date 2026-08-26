import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext } from "@/lib/auth";
import { getPaymentProvider, PaymentProviderError } from "@/lib/payments";

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
    const provider = getPaymentProvider();
    const result = await provider.createPortal({ workspaceId: wid });
    // D5：通道整体不支持 portal 时返回 null → 501
    // Phase 1 StripeProvider 恒返回 portal URL，该分支实际不可达；
    // 它是为 PAYMENT_PROVIDER 切换后的部署形态准备的。
    if (result === null) {
      return NextResponse.json(
        { code: 501, message: "当前支付通道不支持自助管理" },
        { status: 501 },
      );
    }
    return NextResponse.json({ code: 200, data: { url: result.url } });
  } catch (error) {
    if (error instanceof PaymentProviderError) {
      if (error.code === "no_customer") {
        return NextResponse.json({ code: 400, message: error.message }, { status: 400 });
      }
      if (error.code === "not_configured") {
        return NextResponse.json({ code: 400, message: error.message }, { status: 400 });
      }
    }
    console.error("Billing portal error:", error);
    return NextResponse.json(
      { code: 500, message: "计费服务暂时不可用，请稍后重试" },
      { status: 500 },
    );
  }
}
