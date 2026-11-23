// POST /api/v1/ai/deliverables/<id>/approve?wid=xxx — 交付后审批（通过/驳回）
//
// 认证模式：getUserId → checkRateLimit → getWorkspaceContextV2（进墙）→ runWithWorkspace（RLS）
// 语义：corps 自含的交付后审批层（用户验收动作），与 sidecar 的 DAG 人审节点不同——
//       sidecar 的 approve/reject 只受理「审批等待中」的任务（docgen 无审批节点），
//       交付后的质量确认记在本表 approvalStatus/approvedBy/approvedAt/approvalNote。
// 只受理已完成任务；重复审批返回 409（幂等，不产生第二次决策）。

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { getWorkspaceContextV2, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";
import { authFailure } from "@/lib/auth-response";
import { withRed } from "@/lib/red-metrics";

const actionSchema = z.object({
  action: z.enum(["approve", "reject"]),
  note: z.string().max(2000).optional(),
});

async function postApproval(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  const limited = await checkRateLimit(req, "ai-deliverables-approve", {
    windowMs: 60_000,
    max: 30,
  });
  if (limited) return limited;

  const wid = new URL(req.url).searchParams.get("wid") ?? "";
  if (!wid) {
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "invalidParams"), data: null },
      { status: 400 },
    );
  }

  let body: z.infer<typeof actionSchema>;
  try {
    body = actionSchema.parse(await req.json());
  } catch {
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "invalidBody"), data: null },
      { status: 400 },
    );
  }
  // 驳回必须给原因（审计可追溯）
  if (body.action === "reject" && !body.note?.trim()) {
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "aiApprovalNoteRequired"), data: null },
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
        const row = await tx.deliverable.findFirst({
          where: { id, workspaceId: wid },
          select: { id: true, status: true, approvalStatus: true },
        });
        if (!row) return { kind: "notFound" as const };
        if (row.status !== "done") return { kind: "notDone" as const };
        if (row.approvalStatus) return { kind: "already" as const, status: row.approvalStatus };
        return {
          kind: "ok" as const,
          row: await tx.deliverable.update({
            where: { id: row.id },
            data: {
              approvalStatus: body.action === "approve" ? "approved" : "rejected",
              approvalNote: body.note ?? null,
              approvedBy: ctx.payload.sub,
              approvedAt: new Date(),
            },
            select: { id: true, approvalStatus: true, approvedAt: true },
          }),
        };
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
    if (result.kind === "already") {
      return NextResponse.json(
        { code: 409, message: apiMsg(req, "aiApprovalAlready"), data: { status: result.status } },
        { status: 409 },
      );
    }

    return NextResponse.json({
      code: 200,
      data: result.row,
      message: apiMsg(req, "ok"),
    });
  } catch (error) {
    console.error("[POST ai/deliverables/:id/approve] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}

export const POST = withRed(postApproval);
