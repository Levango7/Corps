import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";

/** POST 撤回审批 body 校验 */
const withdrawSchema = z.object({
  comment: z.string().optional(),
});

/**
 * POST /v1/workspaces/{wid}/approvals/instances/{aid}/withdraw — 撤回审批
 * Body: { comment? }
 * 只有申请人可操作，status 必须为 pending，
 * 创建 ApprovalOperation(action="withdraw")，设 status="withdrawn", completedAt=now
 */
export async function POST(
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
    const body = await req.json().catch(() => ({}));
    const validated = withdrawSchema.parse(body);

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        const instance = await tx.approvalInstance.findUnique({ where: { id: aid } });
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

        // 创建操作记录
        await tx.approvalOperation.create({
          data: {
            instanceId: aid,
            workspaceId: wid,
            operatorId: ctx.payload.sub,
            action: "withdraw",
            nodeIndex: instance.currentNode,
            comment: validated.comment,
          },
        });

        // 撤回：设 status="withdrawn", completedAt=now
        const updated = await tx.approvalInstance.update({
          where: { id: aid },
          data: { status: "withdrawn", completedAt: new Date() },
          include: {
            applicant: { select: { id: true, name: true, email: true } },
            operations: {
              orderBy: [{ createdAt: "asc" }],
              include: { operator: { select: { id: true, name: true, email: true } } },
            },
          },
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
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          code: 400,
          message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"),
          data: null,
          errors: error.errors,
        },
        { status: 400 },
      );
    }
    console.error("[POST withdraw] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
