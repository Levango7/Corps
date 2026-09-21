import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";
import type { Prisma } from "@prisma/client";

interface ApprovalNode {
  approverRole?: string;
  approverUserId?: string;
  name: string;
  order: number;
  mode?: "sequential" | "parallel" | "countersign";
  requiredCount?: number;
  additionalApprovers?: string[];
}

const addSignSchema = z.object({
  addSignToId: z.string().uuid(),
  comment: z.string().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; aid: string }> },
) {
  const { wid, aid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const validated = addSignSchema.parse(body);

    const result = await runWithWorkspace(wid, async (tx) => {
      const instance = await tx.approvalInstance.findUnique({ where: { id: aid } });
      if (!instance || instance.workspaceId !== wid) return { kind: "notFound" as const };
      if (instance.status !== "pending") return { kind: "notPending" as const };

      const nodes = instance.nodes as unknown as ApprovalNode[];
      const currentNode = nodes[instance.currentNode];
      if (!currentNode) return { kind: "notApprover" as const };
      const isApprover = currentNode.approverUserId === ctx.payload.sub || (currentNode.approverRole !== undefined && currentNode.approverRole === ctx.member.role);
      if (!isApprover) return { kind: "notApprover" as const };

      const targetMember = await tx.member.findFirst({ where: { userId: validated.addSignToId, workspaceId: wid } });
      if (!targetMember) return { kind: "targetNotFound" as const };

      const nodeMode = currentNode.mode ?? "sequential";
      const updatedNodes = [...nodes];

      if (nodeMode === "sequential") {
        const newNode: ApprovalNode = {
          name: "加签审批",
          approverUserId: validated.addSignToId,
          order: currentNode.order + 0.5,
        };
        updatedNodes.splice(instance.currentNode + 1, 0, newNode);
      } else {
        updatedNodes[instance.currentNode] = {
          ...currentNode,
          additionalApprovers: [...(currentNode.additionalApprovers ?? []), validated.addSignToId],
        };
      }

      const operation = await tx.approvalOperation.create({
        data: { instanceId: aid, workspaceId: wid, operatorId: ctx.payload.sub, action: "addSign", nodeIndex: instance.currentNode, comment: validated.comment, addSignToId: validated.addSignToId, nodeId: `node_${instance.currentNode}` },
      });

      const updatedInstance = await tx.approvalInstance.update({
        where: { id: aid },
        data: { nodes: updatedNodes as unknown as Prisma.InputJsonValue },
        include: { applicant: { select: { id: true, name: true, email: true } }, operations: { orderBy: [{ createdAt: "asc" }], include: { operator: { select: { id: true, name: true, email: true } } } } },
      });

      await tx.notification.create({ data: { userId: validated.addSignToId, workspaceId: wid, type: "approval_add_sign", entityId: aid, entityTitle: instance.title } });

      return { kind: "ok" as const, data: { instance: updatedInstance, operation } };
    }, ctx.payload.sub);

    if (result.kind === "notFound") return NextResponse.json({ code: 404, message: apiMsg(req, "approvalNotFound"), data: null }, { status: 404 });
    if (result.kind === "notPending") return NextResponse.json({ code: 409, message: apiMsg(req, "approvalNotPending"), data: null }, { status: 409 });
    if (result.kind === "notApprover") return NextResponse.json({ code: 403, message: apiMsg(req, "notApprover"), data: null }, { status: 403 });
    if (result.kind === "targetNotFound") return NextResponse.json({ code: 403, message: apiMsg(req, "approvalAddSignTargetNotFound"), data: null }, { status: 403 });

    return NextResponse.json({ code: 200, data: result.data });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ code: 400, message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"), data: null, errors: error.errors }, { status: 400 });
    console.error("[POST add-sign] error:", error);
    return NextResponse.json({ code: 500, data: null, message: apiMsg(req, "internalError") }, { status: 500 });
  }
}