// POST /api/v1/ai/deliverables/<id>/submit-approval?wid=xxx — 交付物送审到 corps approvals 引擎
//
// 认证模式：getUserId → checkRateLimit → getWorkspaceContextV2（进墙）→ runWithWorkspace（RLS）
// 语义：把已完成的交付物送入 corps 审批流（ApprovalInstance），审批人在 approvals 页
//       走标准 approve/reject；审批结果由 approval-linkage 回写 Deliverable.approvalStatus。
// 模板：deliverable_review（每工作区惰性创建，审批人=owner，单节点顺序审批）。
// 只受理已完成且未送审的交付物；重复送审返回 409。

import { NextRequest, NextResponse } from "next/server";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { getWorkspaceContextV2, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";
import { authFailure } from "@/lib/auth-response";
import { withRed } from "@/lib/red-metrics";

async function postSubmitApproval(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  const limited = await checkRateLimit(req, "ai-deliverables-submit-approval", {
    windowMs: 60_000,
    max: 20,
  });
  if (limited) return limited;

  const wid = new URL(req.url).searchParams.get("wid") ?? "";
  if (!wid) {
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "invalidParams"), data: null },
      { status: 400 },
    );
  }

  try {
    const ctx = await getWorkspaceContextV2(req, wid);
    if (!ctx)
      return NextResponse.json(
        { code: 500, message: apiMsg(req, "internalError"), data: null },
        { status: 500 },
      );
    if (!ctx.ok) return authFailure(ctx, req);

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        // 双击/并发送审串行化：后到事务必须读到前者写入的 approvalInstanceId，
        // 否则同一交付物会在审批中心出现两条待办。void 锁走 executeRaw。
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`deliverable-submit:${id}`}))`;
        const row = await tx.deliverable.findFirst({
          where: { id, workspaceId: wid },
          select: {
            id: true,
            taskId: true,
            title: true,
            pipeline: true,
            status: true,
            approvalStatus: true,
            approvalInstanceId: true,
            outputPath: true,
            outputSummary: true,
          },
        });
        if (!row) return { kind: "notFound" as const };
        if (row.status !== "done") return { kind: "notDone" as const };
        if (row.approvalStatus) {
          return { kind: "decided" as const, status: row.approvalStatus };
        }
        if (row.approvalInstanceId) {
          return { kind: "already" as const, instanceId: row.approvalInstanceId };
        }

        // 模板：deliverable_review（每工作区惰性创建；审批人=owner，单节点顺序审批）
        let template = await tx.approvalTemplate.findFirst({
          where: { workspaceId: wid, name: "deliverable_review", active: true },
          select: { id: true },
        });
        if (!template) {
          template = await tx.approvalTemplate.create({
            data: {
              workspaceId: wid,
              name: "deliverable_review",
              description: "AI 交付物的质量验收（通过/驳回，单节点）",
              nodes: [{ approverRole: "owner", name: "交付验收", order: 0 }],
              flowType: "sequential",
              category: "deliverable",
              isBuiltin: false,
              createdBy: ctx.payload.sub,
            },
            select: { id: true },
          });
        }

        const instance = await tx.approvalInstance.create({
          data: {
            workspaceId: wid,
            templateId: template.id,
            title: `交付验收：${row.title}`,
            description: `AI 交付物（pipeline=${row.pipeline}，task=${row.taskId}）`,
            // 审批节点快照（与模板同形；单节点 owner 顺序审批）
            nodes: [{ approverRole: "owner", name: "交付验收", order: 0 }],
            content: {
              deliverableId: row.id,
              taskId: row.taskId,
              outputPath: row.outputPath,
              summary: (row.outputSummary ?? "").slice(0, 500),
            },
            applicantId: ctx.payload.sub,
            status: "pending",
            entityType: "deliverable",
            entityId: row.id,
          },
          select: { id: true, status: true },
        });

        await tx.deliverable.update({
          where: { id: row.id },
          data: { approvalInstanceId: instance.id },
        });

        return { kind: "ok" as const, instanceId: instance.id, status: instance.status };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "aiDeliveryTaskNotFound"), data: null },
        { status: 404 },
      );
    }
    if (result.kind === "notDone") {
      return NextResponse.json(
        { code: 409, message: apiMsg(req, "aiApprovalNotDone"), data: null },
        { status: 409 },
      );
    }
    if (result.kind === "decided") {
      return NextResponse.json(
        { code: 409, message: apiMsg(req, "aiApprovalAlready"), data: { status: result.status } },
        { status: 409 },
      );
    }
    if (result.kind === "already") {
      return NextResponse.json(
        { code: 409, message: apiMsg(req, "aiApprovalAlready"), data: { instanceId: result.instanceId } },
        { status: 409 },
      );
    }

    return NextResponse.json({
      code: 200,
      data: result,
      message: apiMsg(req, "ok"),
    });
  } catch (error) {
    console.error("[POST ai/deliverables/:id/submit-approval] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}

export const POST = withRed(postSubmitApproval);
