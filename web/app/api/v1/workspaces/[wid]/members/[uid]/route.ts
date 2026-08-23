import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWorkspaceContext } from "@/lib/auth";
import { z } from "zod";

const roleSchema = z.object({ role: z.enum(["admin", "member"]) });

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; uid: string }> }
) {
  const { wid, uid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });
  if (!["owner", "admin"].includes(ctx.member.role)) {
    return NextResponse.json({ code: 403, message: "Only owner/admin can change roles" }, { status: 403 });
  }

  const { role } = roleSchema.parse(await req.json());

  const target = await prisma.member.findUnique({
    where: { userId_workspaceId: { userId: uid, workspaceId: wid } },
  });
  if (!target) return NextResponse.json({ code: 404, message: "成员不存在" }, { status: 404 });
  if (target.role === "owner") {
    return NextResponse.json({ code: 403, message: "不能修改拥有者角色" }, { status: 403 });
  }

  await prisma.member.update({
    where: { userId_workspaceId: { userId: uid, workspaceId: wid } },
    data: { role },
  });

  return NextResponse.json({ code: 200, data: { id: uid, role } });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; uid: string }> }
) {
  const { wid, uid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });
  if (!["owner", "admin"].includes(ctx.member.role)) {
    return NextResponse.json({ code: 403, message: "Only owner/admin can remove members" }, { status: 403 });
  }
  if (uid === ctx.payload.sub) {
    return NextResponse.json({ code: 400, message: "不能移除自己" }, { status: 400 });
  }

  const target = await prisma.member.findUnique({
    where: { userId_workspaceId: { userId: uid, workspaceId: wid } },
  });
  if (!target) return NextResponse.json({ code: 404, message: "成员不存在" }, { status: 404 });
  if (target.role === "owner") {
    return NextResponse.json({ code: 403, message: "不能移除工作区拥有者" }, { status: 403 });
  }

  await prisma.member.delete({ where: { userId_workspaceId: { userId: uid, workspaceId: wid } } });

  const subscription = await prisma.subscription.findUnique({ where: { workspaceId: wid } });
  if (subscription?.stripeCustomerId && subscription?.stripeSubId) {
    const remain = await prisma.member.count({ where: { workspaceId: wid } });
    try {
      const { requireStripe } = await import("@/lib/stripe");
      const stripe = requireStripe();
      const sub = await stripe.subscriptions.retrieve(subscription.stripeSubId);
      await stripe.subscriptions.update(subscription.stripeSubId, {
        items: [{ id: sub.items.data[0].id, quantity: remain }],
      });
    } catch {
      /* Stripe 同步失败不阻断本地移除 */
    }
  }

  return NextResponse.json({ code: 200, data: null });
}
