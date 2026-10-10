import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContextV2, runWithWorkspace } from "@/lib/auth";
import { authFailure } from "@/lib/auth-response";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";
import { notifyUsers } from "@/lib/notification/record";
import type { Prisma } from "@prisma/client";

interface ApprovalNode {
  approverRole?: string;
  approverUserId?: string;
  name: string;
  order: number;
  mode?: "sequential" | "parallel" | "countersign";
  requiredCount?: number;
}

const delegateSchema = z.object({
  delegateToId: z.string().uuid(),
  comment: z.string().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; aid: string }> },
) {
  const { wid, aid } = await params;
  const ctx = await getWorkspaceContextV2(req, wid);
  if (!ctx)
    // V2 契约上从不返回 null（见 lib/auth.ts 的 WorkspaceContextV2 文档：
    // "调用方遇到 null 应按 500 处理（fail-closed，不可当作 401 重试）"）。
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  if (!ctx.ok) return authFailure(ctx, req);

  try {
    const body = await req.json().catch(() => ({}));
    const validated = delegateSchema.parse(body);

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        const instance = await tx.approvalInstance.findUnique({ where: { id: aid } });
        if (!instance || instance.workspaceId !== wid) return { kind: "notFound" as const };
        if (instance.status !== "pending") return { kind: "notPending" as const };

        const nodes = instance.nodes as unknown as ApprovalNode[];
        const currentNode = nodes[instance.currentNode];
        if (!currentNode) return { kind: "notApprover" as const };
        const isApprover =
          currentNode.approverUserId === ctx.payload.sub ||
          (currentNode.approverRole !== undefined && currentNode.approverRole === ctx.member.role);
        if (!isApprover) return { kind: "notApprover" as const };

        const targetMember = await tx.member.findFirst({
          where: { userId: validated.delegateToId, workspaceId: wid },
        });
        if (!targetMember) return { kind: "targetNotFound" as const };

        const updatedNodes = [...nodes];
        updatedNodes[instance.currentNode] = {
          ...currentNode,
          approverUserId: validated.delegateToId,
          approverRole: undefined,
        };

        const operation = await tx.approvalOperation.create({
          data: {
            instanceId: aid,
            workspaceId: wid,
            operatorId: ctx.payload.sub,
            action: "delegate",
            nodeIndex: instance.currentNode,
            comment: validated.comment,
            delegateToId: validated.delegateToId,
            nodeId: `node_${instance.currentNode}`,
          },
        });

        const updatedInstance = await tx.approvalInstance.update({
          where: { id: aid },
          data: { nodes: updatedNodes as unknown as Prisma.InputJsonValue },
          include: {
            applicant: { select: { id: true, name: true, email: true } },
            operations: {
              orderBy: [{ createdAt: "asc" }],
              include: { operator: { select: { id: true, name: true, email: true } } },
            },
          },
        });

        await notifyUsers(tx, [
          {
            userId: validated.delegateToId,
            workspaceId: wid,
            type: "approval_delegate",
            entityId: aid,
            entityTitle: instance.title,
          },
        ]);

        return { kind: "ok" as const, data: { instance: updatedInstance, operation } };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound")
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "approvalNotFound"), data: null },
        { status: 404 },
      );
    if (result.kind === "notPending")
      return NextResponse.json(
        { code: 409, message: apiMsg(req, "approvalNotPending"), data: null },
        { status: 409 },
      );
    if (result.kind === "notApprover")
      return NextResponse.json(
        { code: 403, message: apiMsg(req, "notApprover"), data: null },
        { status: 403 },
      );
    if (result.kind === "targetNotFound")
      return NextResponse.json(
        { code: 403, message: apiMsg(req, "approvalDelegateTargetNotFound"), data: null },
        { status: 403 },
      );

    return NextResponse.json({ code: 200, data: result.data });
  } catch (error) {
    if (error instanceof z.ZodError)
      return NextResponse.json(
        {
          code: 400,
          message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"),
          data: null,
          errors: error.issues,
        },
        { status: 400 },
      );
    console.error("[POST delegate] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
