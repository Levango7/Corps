import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { apiMsg } from "@/lib/api-messages";
import { isAiConfigured } from "@/lib/ai/shared";

/** 审批节点类型（nodes JSON 快照中的单节点） */
interface ApprovalNode {
  approverRole?: string;
  approverUserId?: string;
  name: string;
  order: number;
  // M1: 审批模式
  mode?: "sequential" | "parallel" | "countersign";
  /** countersign 模式下需要通过的最少审批人数 */
  requiredCount?: number;
}

/**
 * GET /v1/workspaces/{wid}/approvals/instances/{aid} — 审批详情
 * 含 operations 操作记录（按 createdAt 正序）
 * 返回字段：
 *  - applicant: { id, name, email } 嵌套对象
 *  - operations[].operator: { id, name, email } 嵌套对象
 *  - templateName: 关联模板名称（无模板时为 null）
 *  - currentApproverIds: 当前审批节点的审批人用户 ID 数组（status !== pending 时为 []）
 *  - aiSuggestion: AI 审批建议（M4，未配置 AI 时为 null）
 *  - entityType / entityId: 审批关联的实体类型和 ID（M6，从 content JSON 提取）
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; aid: string }> },
) {
  const { wid, aid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

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
    const { template: _template, ...instanceRest } = result.instance;

    // M6: 从 content JSON 中提取 entityType / entityId（支持审批关联到任务/文档/自定义实体）
    const contentObj = result.instance.content as Record<string, unknown> | null;
    const entityType =
      contentObj && typeof contentObj.entityType === "string" ? contentObj.entityType : null;
    const entityId =
      contentObj && typeof contentObj.entityId === "string" ? contentObj.entityId : null;

    // M4: AI 审批建议 — 使用 isAiConfigured() 检查，未配置时返回 null
    // 配置时返回 { available: true }，前端可调用 /api/v1/ai/approval-advice 流式获取实际建议
    const aiSuggestion = isAiConfigured() ? { available: true as const } : null;

    return NextResponse.json({
      code: 200,
      data: {
        ...instanceRest,
        templateName: result.templateName,
        currentApproverIds: result.currentApproverIds,
        // M4: AI 审批建议
        aiSuggestion,
        // M6: content 无强关联 — 提取 entityType / entityId
        entityType,
        entityId,
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
/**
 * DELETE /v1/workspaces/{wid}/approvals/instances/{aid} — 撤销审批实例（L4）
 * 仅允许申请人撤销 pending 状态的实例
 * 创建 ApprovalOperation(action="withdraw")，设 status="withdrawn", completedAt=now
 * 保留审计记录，不实际删除行
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; aid: string }> },
) {
  const { wid, aid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        const instance = await tx.approvalInstance.findUnique({
          where: { id: aid },
        });
        if (!instance || instance.workspaceId !== wid) {
          return { kind: "notFound" as const };
        }
        // 只有申请人可操作
        if (instance.applicantId !== ctx.payload.sub) {
          return { kind: "notApplicant" as const };
        }
        // status 必须为 pending
        if (instance.status !== "pending") {
          return { kind: "notPending" as const };
        }

        // 创建撤回操作记录
        await tx.approvalOperation.create({
          data: {
            instanceId: aid,
            workspaceId: wid,
            operatorId: ctx.payload.sub,
            action: "withdraw",
            nodeIndex: instance.currentNode,
          },
        });

        // 撤销：设 status="withdrawn", completedAt=now（保留审计记录）
        const updated = await tx.approvalInstance.update({
          where: { id: aid },
          data: { status: "withdrawn", completedAt: new Date() },
        });

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
    if (result.kind === "notApplicant") {
      return NextResponse.json(
        { code: 403, message: apiMsg(req, "notApplicant"), data: null },
        { status: 403 },
      );
    }
    if (result.kind === "notPending") {
      return NextResponse.json(
        { code: 409, message: apiMsg(req, "approvalNotPending"), data: null },
        { status: 409 },
      );
    }

    return NextResponse.json({ code: 200, data: result.data });
  } catch (error) {
    console.error("[DELETE approval-instance] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
