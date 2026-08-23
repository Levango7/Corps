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

  const { role } = roleSchema.parse(await req.json());

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
      return {
        notFound: false as const,
        isOwner: false as const,
        stripeCustomerId,
        stripeSubId,
        remain,
      };
    },
    ctx.payload.sub,
  );

  if (outcome.notFound)
    return NextResponse.json({ code: 404, message: "成员不存在" }, { status: 404 });
  if (outcome.isOwner) {
    return NextResponse.json({ code: 403, message: "不能移除工作区拥有者" }, { status: 403 });
  }

  if (outcome.stripeCustomerId && outcome.stripeSubId) {
    try {
      const { requireStripe } = await import("@/lib/stripe");
      const stripe = requireStripe();
      const sub = await stripe.subscriptions.retrieve(outcome.stripeSubId);
      await stripe.subscriptions.update(outcome.stripeSubId, {
        items: [{ id: sub.items.data[0].id, quantity: outcome.remain }],
      });
    } catch {
      /* Stripe 同步失败不阻断本地移除 */
    }
  }

  return NextResponse.json({ code: 200, data: null });
}
