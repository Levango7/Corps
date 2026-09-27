import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";

/** POST 添加审批评论 body 校验（上限 1000：与 approval_operations.comment 的 Text 语义匹配，
 *  同时与 approve/reject 等操作的备注长度量级保持一致） */
const commentSchema = z.object({
  comment: z.string().trim().min(1).max(1000),
});

/**
 * POST /v1/workspaces/{wid}/approvals/instances/{aid}/comment — 添加审批评论
 * Body: { comment }
 *
 * 与 approve/reject/withdraw 的关键差异（这也是本路由独立存在的原因）：
 *  - **不校验当前用户是否为当前节点审批人**：评论对相关方开放（申请人/审批人/抄送人
 *    及工作区成员），仅由 `getWorkspaceContext` 保证工作区成员资格，数据层再由
 *    approval_operations 的 RLS（workspace 谓词）兜底；
 *  - **不推进 currentNode、不改变 instance.status、不发通知、不触发权限联动**：
 *    评论是纯记录操作，审批流状态不受影响（`action="comment"` 本就属"记录类"枚举，
 *    见 schema 中 action 的注释：approve | reject | withdraw | transfer | comment）；
 *  - **响应形态与 approve 保持一致**（返回含 operations 的 instance），使前端
 *    ApprovalDetail.tsx 可直接复用既有的"提交→重新拉取详情→关闭弹窗"流程，无需特判。
 *
 * @param nodeIndex 取 instance.currentNode：便于在时间线上把评论归到当时所处的节点
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
    const validated = commentSchema.parse(body);

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        const instance = await tx.approvalInstance.findUnique({ where: { id: aid } });
        if (!instance || instance.workspaceId !== wid) {
          return { kind: "notFound" as const };
        }

        // 创建操作记录（纯记录，不推进流程）
        await tx.approvalOperation.create({
          data: {
            instanceId: aid,
            workspaceId: wid,
            operatorId: ctx.payload.sub,
            action: "comment",
            nodeIndex: instance.currentNode,
            comment: validated.comment,
          },
        });

        // 返回更新后的实例（与 approve/reject 响应形态一致）
        const updated = await tx.approvalInstance.findUnique({
          where: { id: aid },
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
    console.error("[POST approval comment] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
