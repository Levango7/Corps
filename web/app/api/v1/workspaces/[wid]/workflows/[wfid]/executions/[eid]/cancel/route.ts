import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { apiMsg } from "@/lib/api-messages";
import { Prisma } from "@prisma/client";

/**
 * POST /v1/workspaces/{wid}/workflows/{wfid}/executions/{eid}/cancel — 取消执行
 *
 * 将 status 从 running/pending 改为 cancelled，并记录 completedAt。
 * 校验：执行存在 + 属于该工作区 + workflowId 匹配 + status 为 running/pending。
 *
 * 设计说明：
 *  - WorkflowExecution.status 为 String（非 enum），可扩展 "cancelled" 状态
 *  - 取消是终态操作，设置 completedAt 以便前端按结束时间排序/展示
 *  - 不调用执行引擎：本端点仅做状态机转移，运行中的同步执行引擎
 *    会在后续动作执行前读取 status 判断是否已取消（防御性检查由调用方保证）
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; wfid: string; eid: string }> },
) {
  const { wid, wfid, eid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    // 1. 查询执行记录，确认存在且属于该工作区 + workflowId 匹配
    const existing = await runWithWorkspace(
      wid,
      (tx) =>
        tx.workflowExecution.findUnique({
          where: { id: eid },
          select: { workflowId: true, workspaceId: true, status: true },
        }),
      ctx.payload.sub,
    );

    if (!existing || existing.workspaceId !== wid || existing.workflowId !== wfid) {
      return NextResponse.json(
        { code: 404, data: null, message: apiMsg(req, "executionNotFound") },
        { status: 404 },
      );
    }

    // 2. 校验 status 为 running/pending 才能取消
    if (existing.status !== "running" && existing.status !== "pending") {
      return NextResponse.json(
        { code: 409, data: null, message: apiMsg(req, "executionCannotCancel") },
        { status: 409 },
      );
    }

    // 3. 更新 status 为 cancelled，记录 completedAt
    const updated = await runWithWorkspace(
      wid,
      (tx) =>
        tx.workflowExecution.update({
          where: { id: eid },
          data: {
            status: "cancelled",
            completedAt: new Date(),
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({
      code: 0,
      data: updated,
      message: apiMsg(req, "executionCancelled"),
    });
  } catch (error) {
    // P2025：记录不存在（并发删除等竞态）
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json(
        { code: 404, data: null, message: apiMsg(req, "executionNotFound") },
        { status: 404 },
      );
    }
    console.error("[POST workflow execution cancel] error:", error);
    return NextResponse.json({ code: 500, data: null, message: apiMsg(req, "internalError") }, { status: 500 });
  }
}