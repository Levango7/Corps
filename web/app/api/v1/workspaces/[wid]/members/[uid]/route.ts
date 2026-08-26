import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";

const roleSchema = z.object({ role: z.enum(["admin", "member"]) });

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; uid: string }> },
) {
  const { wid, uid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });
  if (!["owner", "admin"].includes(ctx.member.role)) {
    return NextResponse.json(
      { code: 403, message: "Only owner/admin can change roles" },
      { status: 403 },
    );
  }

  const parsedRole = roleSchema.safeParse(await req.json());
  if (!parsedRole.success) {
    return NextResponse.json(
      { code: 400, message: "Validation error", errors: parsedRole.error.errors },
      { status: 400 },
    );
  }
  const { role } = parsedRole.data;

  const outcome = await runWithWorkspace(
    wid,
    async (tx) => {
      const target = await tx.member.findUnique({
        where: { userId_workspaceId: { userId: uid, workspaceId: wid } },
      });
      if (!target) return { notFound: true as const };
      if (target.role === "owner") return { isOwner: true as const };

      await tx.member.update({
        where: { userId_workspaceId: { userId: uid, workspaceId: wid } },
        data: { role },
      });
      return { notFound: false as const, isOwner: false as const };
    },
    ctx.payload.sub,
  );

  if (outcome.notFound)
    return NextResponse.json({ code: 404, message: "成员不存在" }, { status: 404 });
  if (outcome.isOwner) {
    return NextResponse.json({ code: 403, message: "不能修改拥有者角色" }, { status: 403 });
  }

  return NextResponse.json({ code: 200, data: { id: uid, role } });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; uid: string }> },
) {
  const { wid, uid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });
  if (!["owner", "admin"].includes(ctx.member.role)) {
    return NextResponse.json(
      { code: 403, message: "Only owner/admin can remove members" },
      { status: 403 },
    );
  }
  if (uid === ctx.payload.sub) {
    return NextResponse.json({ code: 400, message: "不能移除自己" }, { status: 400 });
  }

  const outcome = await runWithWorkspace(
    wid,
    async (tx) => {
      const target = await tx.member.findUnique({
        where: { userId_workspaceId: { userId: uid, workspaceId: wid } },
      });
      if (!target) return { notFound: true as const };
      if (target.role === "owner") return { isOwner: true as const };

      await tx.member.delete({ where: { userId_workspaceId: { userId: uid, workspaceId: wid } } });

      // 席位变化同步 Stripe subscription quantity（AC-08）
      const subscription = await tx.subscription.findUnique({ where: { workspaceId: wid } });
      let stripeCustomerId: string | null = null;
      let stripeSubId: string | null = null;
      if (subscription?.stripeCustomerId && subscription?.stripeSubId) {
        stripeCustomerId = subscription.stripeCustomerId;
        stripeSubId = subscription.stripeSubId;
      }
      const remain = await tx.member.count({ where: { workspaceId: wid } });
      // 审计 F-11：Stripe quantity 同步口径为"购买的席位数"(seatLimit)，而非当前人数——
      // 移除成员不应缩水已购买的席位
      const ws = await tx.workspace.findUnique({
        where: { id: wid },
        select: { seatLimit: true },
      });
      return {
        notFound: false as const,
        isOwner: false as const,
        stripeCustomerId,
        stripeSubId,
        remain,
        seatLimit: ws?.seatLimit ?? null,
      };
    },
    ctx.payload.sub,
  );

  if (outcome.notFound)
    return NextResponse.json({ code: 404, message: "成员不存在" }, { status: 404 });
  if (outcome.isOwner) {
    return NextResponse.json({ code: 403, message: "不能移除工作区拥有者" }, { status: 403 });
  }

  if (outcome.stripeCustomerId && outcome.stripeSubId && outcome.seatLimit != null) {
    try {
      // AC-08：席位变化同步通道侧订阅 quantity（经 PaymentProvider 抽象，ADR-003 §5）
      // 审计 F-11：同步口径为"购买的席位数"(seatLimit)，而非当前人数——
      // 移除成员不应缩水已购买的席位
      const { getPaymentProvider } = await import("@/lib/payments");
      const provider = getPaymentProvider();
      await provider.syncSubscription({
        providerOrderId: outcome.stripeSubId,
        seats: outcome.seatLimit,
      });
    } catch {
      /* 通道同步失败不阻断本地移除 */
    }
  }

  return NextResponse.json({ code: 200, data: null });
}
