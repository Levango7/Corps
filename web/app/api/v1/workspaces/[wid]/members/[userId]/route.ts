// PATCH /api/v1/workspaces/{wid}/members/{userId} — 改成员角色（owner/admin 都行）
// DELETE /api/v1/workspaces/{wid}/members/{userId} — 移除成员（owner/admin，不能移除自己/owner）
// 治理规则：
// - member 一律 403
// - admin 可改/删 member；admin 不能改/删 admin、不能动 owner
// - owner 可以改/删除自己以外的任何人；不能改/删自己
import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";

import { apiMsg } from "@/lib/api-messages";
import { handlePrismaError } from "@/lib/prisma-error";
import { requirePermission } from "@/lib/permissions";

const updateSchema = z.object({
  role: z.enum(["admin", "member"]),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; userId: string }> },
) {
  const { wid, userId } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });
  const denied = await requirePermission(ctx, "members", "update", req);
  if (denied) return denied;

  let body: z.infer<typeof updateSchema>;
  try {
    body = updateSchema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: e.issues[0]?.message ?? apiMsg(req, "validationFailed"), data: null },
        { status: 400 },
      );
    }
    return NextResponse.json({ code: 400, message: apiMsg(req, "invalidBody"), data: null }, { status: 400 });
  }

  try {
    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        const target = await tx.member.findUnique({
          where: { userId_workspaceId: { userId, workspaceId: wid } },
          select: { role: true, userId: true },
        });
        if (!target) return { kind: "notFound" as const };
        if (target.userId === ctx.payload.sub) {
          return { kind: "selfForbidden" as const };
        }
        if (target.role === "owner") {
          return { kind: "ownerImmutable" as const };
        }
        // admin 不能改 admin（互改），只有 owner 可以改 admin
        if (target.role === "admin" && ctx.member.role !== "owner") {
          return { kind: "notAdminPrivilege" as const };
        }
        const updated = await tx.member.update({
          where: { userId_workspaceId: { userId, workspaceId: wid } },
          data: { role: body.role },
          select: { userId: true, role: true },
        });
        return { kind: "ok" as const, updated };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "memberNotFound"), data: null },
        { status: 404 },
      );
    }
    if (result.kind === "ownerImmutable") {
      return NextResponse.json(
        { code: 403, message: apiMsg(req, "ownerRoleImmutable"), data: null },
        { status: 403 },
      );
    }
    if (result.kind === "selfForbidden") {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "cannotChangeOwnRole"), data: null },
        { status: 400 },
      );
    }
    if (result.kind === "notAdminPrivilege") {
      return NextResponse.json(
        { code: 403, message: apiMsg(req, "onlyOwnerChangeAdmin"), data: null },
        { status: 403 },
      );
    }
    return NextResponse.json({ code: 200, data: result.updated });
  } catch (error) {
    console.error("[PATCH member] error:", error);
    return handlePrismaError(error, req);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; userId: string }> },
) {
  const { wid, userId } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });
  const denied = await requirePermission(ctx, "members", "delete", req);
  if (denied) return denied;
  if (userId === ctx.payload.sub) {
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "cannotRemoveSelf"), data: null },
      { status: 400 },
    );
  }

  try {
    const outcome = await runWithWorkspace(
      wid,
      async (tx) => {
        const target = await tx.member.findUnique({
          where: { userId_workspaceId: { userId, workspaceId: wid } },
          select: { role: true },
        });
        if (!target) return { kind: "notFound" as const };
        if (target.role === "owner") return { kind: "isOwner" as const };
        if (target.role === "admin" && ctx.member.role !== "owner") {
          return { kind: "notAdminPrivilege" as const };
        }

        await tx.member.delete({
          where: { userId_workspaceId: { userId, workspaceId: wid } },
        });

        // AC-08 席位变更同步订阅侧 quantity
        const subscription = await tx.subscription.findUnique({ where: { workspaceId: wid } });
        let stripeCustomerId: string | null = null;
        let stripeSubId: string | null = null;
        if (subscription?.stripeCustomerId && subscription?.stripeSubId) {
          stripeCustomerId = subscription.stripeCustomerId;
          stripeSubId = subscription.stripeSubId;
        }
        const ws = await tx.workspace.findUnique({
          where: { id: wid },
          select: { seatLimit: true },
        });
        return {
          kind: "ok" as const,
          stripeCustomerId,
          stripeSubId,
          seatLimit: ws?.seatLimit ?? null,
        };
      },
      ctx.payload.sub,
    );

    if (outcome.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "memberNotFound"), data: null },
        { status: 404 },
      );
    }
    if (outcome.kind === "isOwner") {
      return NextResponse.json(
        { code: 403, message: apiMsg(req, "cannotRemoveOwner"), data: null },
        { status: 403 },
      );
    }
    if (outcome.kind === "notAdminPrivilege") {
      return NextResponse.json(
        { code: 403, message: apiMsg(req, "onlyOwnerRemoveAdmin"), data: null },
        { status: 403 },
      );
    }

    if (outcome.stripeCustomerId && outcome.stripeSubId && outcome.seatLimit != null) {
      try {
        const { getPaymentProvider } = await import("@/lib/payments");
        const provider = getPaymentProvider();
        await provider.syncSubscription({
          providerOrderId: outcome.stripeSubId,
          seats: outcome.seatLimit,
        });
      } catch {
        /* 侧通道同步失败不阻断本地移除 */
      }
    }

    return NextResponse.json({ code: 200, data: null });
  } catch (error) {
    console.error("[DELETE member] error:", error);
    return handlePrismaError(error, req);
  }
}
