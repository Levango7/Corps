import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";

/** 审批节点类型（nodes JSON 快照中的单节点） */
interface ApprovalNode {
  approverRole?: string;
  approverUserId?: string;
  name: string;
  order: number;
  // M1: 审批模式
  // - sequential: 顺序审批（默认，一人审批即可进入下一节点）
  // - parallel: 并行审批（所有人同时审批，全部通过才进入下一节点）
  // - countersign: 会签（只需 requiredCount 数量的人通过即可）
  mode?: "sequential" | "parallel" | "countersign";
  /** countersign 模式下需要通过的最少审批人数 */
  requiredCount?: number;
}

/** POST 同意审批 body 校验 */
const approveSchema = z.object({
  comment: z.string().optional(),
});

/**
 * POST /v1/workspaces/{wid}/approvals/instances/{aid}/approve — 同意审批
 * Body: { comment? }
 * 检查当前用户是否是当前节点的审批人，创建 ApprovalOperation(action="approve")，
 * 推进 currentNode（最后一个节点则 status="approved", completedAt=now）
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; aid: string }> },
) {
  const { wid, aid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const validated = approveSchema.parse(body);

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        const instance = await tx.approvalInstance.findUnique({ where: { id: aid } });
        if (!instance || instance.workspaceId !== wid) {
          return { kind: "notFound" as const };
        }
        if (instance.status !== "pending") {
          return { kind: "notPending" as const };
        }

        // 检查当前用户是否是当前节点的审批人
        const nodes = instance.nodes as unknown as ApprovalNode[];
        const currentNode = nodes[instance.currentNode];
        if (!currentNode) {
          return { kind: "notApprover" as const };
        }
        const isApprover =
          currentNode.approverUserId === ctx.payload.sub ||
          (currentNode.approverRole !== undefined && currentNode.approverRole === ctx.member.role);
        if (!isApprover) {
          return { kind: "notApprover" as const };
        }

        // 创建操作记录
        await tx.approvalOperation.create({
          data: {
            instanceId: aid,
            workspaceId: wid,
            operatorId: ctx.payload.sub,
            action: "approve",
            nodeIndex: instance.currentNode,
            comment: validated.comment,
          },
        });

        // M1: 根据 mode 判断是否进入下一节点
        const nodeMode = currentNode.mode ?? "sequential";
        const isLastNode = instance.currentNode >= nodes.length - 1;
        let shouldAdvance = false;

        if (nodeMode === "sequential") {
          // 顺序审批：一人审批即可进入下一节点（当前行为）
          shouldAdvance = true;
        } else if (nodeMode === "parallel") {
          // 并行审批：所有人同时审批，全部通过才进入下一节点
          // 查询当前节点所有审批人
          const allApproverIds = new Set<string>();
          if (currentNode.approverUserId) {
            allApproverIds.add(currentNode.approverUserId);
          }
          if (currentNode.approverRole) {
            const roleMembers = await tx.member.findMany({
              where: { workspaceId: wid, role: currentNode.approverRole },
              select: { userId: true },
            });
            for (const m of roleMembers) allApproverIds.add(m.userId);
          }
          // 查询当前节点已 approve 的操作记录（不含当前用户，因为刚创建）
          const approvedOps = await tx.approvalOperation.findMany({
            where: {
              instanceId: aid,
              nodeIndex: instance.currentNode,
              action: "approve",
            },
            select: { operatorId: true },
          });
          const approvedSet = new Set(approvedOps.map((op) => op.operatorId));
          // 检查所有审批人是否都已 approve
          shouldAdvance = Array.from(allApproverIds).every((id) =>
            approvedSet.has(id),
          );
        } else if (nodeMode === "countersign") {
          // 会签：只需 requiredCount 数量的人通过即可
          const requiredCount = currentNode.requiredCount ?? 1;
          const approvedCount = await tx.approvalOperation.count({
            where: {
              instanceId: aid,
              nodeIndex: instance.currentNode,
              action: "approve",
            },
          });
          shouldAdvance = approvedCount >= requiredCount;
        }

        // 推进节点：如果 shouldAdvance 且是最后一个节点，设 status="approved"
        const updated = await tx.approvalInstance.update({
          where: { id: aid },
          data: {
            currentNode:
              shouldAdvance && !isLastNode
                ? instance.currentNode + 1
                : instance.currentNode,
            ...(shouldAdvance && isLastNode
              ? { status: "approved", completedAt: new Date() }
              : {}),
          },
          include: {
            applicant: { select: { id: true, name: true, email: true } },
            operations: {
              orderBy: [{ createdAt: "asc" }],
              include: { operator: { select: { id: true, name: true, email: true } } },
            },
          },
        });

        // 通知申请人审批结果（仅在审批最终通过时通知）
        if (shouldAdvance && isLastNode && instance.applicantId !== ctx.payload.sub) {
          await tx.notification.create({
            data: {
              userId: instance.applicantId,
              workspaceId: wid,
              type: "approval_result",
              entityId: aid,
              entityTitle: instance.title,
            },
          });
        }

        return { kind: "ok" as const, data: updated };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "approvalNotFound"), data: null },
        { status: 404 },
      );
    }
    if (result.kind === "notPending") {
      return NextResponse.json(
        { code: 409, message: apiMsg(req, "approvalNotPending"), data: null },
        { status: 409 },
      );
    }
    if (result.kind === "notApprover") {
      return NextResponse.json(
        { code: 403, message: apiMsg(req, "notApprover"), data: null },
        { status: 403 },
      );
    }

    return NextResponse.json({ code: 200, data: result.data });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"), data: null, errors: error.errors },
        { status: 400 },
      );
    }
    console.error("[POST approve] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}