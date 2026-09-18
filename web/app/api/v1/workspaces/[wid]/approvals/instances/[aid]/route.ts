import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { apiMsg } from "@/lib/api-messages";

/** 审批节点类型（nodes JSON 快照中的单节点） */
interface ApprovalNode {
  approverRole?: string;
  approverUserId?: string;
  name: string;
  order: number;
}

/**
 * GET /v1/workspaces/{wid}/approvals/instances/{aid} — 审批详情
 * 含 operations 操作记录（按 createdAt 正序）
 * 返回字段：
 *  - applicant: { id, name, email } 嵌套对象
 *  - operations[].operator: { id, name, email } 嵌套对象
 *  - templateName: 关联模板名称（无模板时为 null）
 *  - currentApproverIds: 当前审批节点的审批人用户 ID 数组（status !== pending 时为 []）
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; aid: string }> },
) {
  const { wid, aid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        const instance = await tx.approvalInstance.findUnique({
          where: { id: aid },
          include: {
            applicant: { select: { id: true, name: true, email: true } },
            template: { select: { id: true, name: true } },
            operations: {
              orderBy: [{ createdAt: "asc" }],
              include: {
                operator: { select: { id: true, name: true, email: true } },
              },
            },
          },
        });

        if (!instance || instance.workspaceId !== wid) {
          return { kind: "notFound" as const };
        }

        // 计算当前审批节点的审批人 ID 数组
        let currentApproverIds: string[] = [];
        if (instance.status === "pending") {
          const nodes = instance.nodes as unknown as ApprovalNode[];
          const currentNode = nodes[instance.currentNode];
          if (currentNode) {
            const approverIds = new Set<string>();
            // 节点直接指定的审批人
            if (currentNode.approverUserId) {
              approverIds.add(currentNode.approverUserId);
            }
            // 按角色指定的审批人：查询该工作区下该角色的所有成员
            if (currentNode.approverRole) {
              const roleMembers = await tx.member.findMany({
                where: { workspaceId: wid, role: currentNode.approverRole },
                select: { userId: true },
              });
              for (const m of roleMembers) approverIds.add(m.userId);
            }
            currentApproverIds = Array.from(approverIds);
          }
        }

        return {
          kind: "ok" as const,
          instance,
          currentApproverIds,
          templateName: instance.template?.name ?? null,
        };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "approvalNotFound"), data: null },
        { status: 404 },
      );
    }

    // 响应：扁平化 templateName + currentApproverIds，保留 applicant/operator 嵌套对象
    const { template, ...instanceRest } = result.instance;
    return NextResponse.json({
      code: 200,
      data: {
        ...instanceRest,
        templateName: result.templateName,
        currentApproverIds: result.currentApproverIds,
      },
    });
  } catch (error) {
    console.error("[GET approval-instance] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
