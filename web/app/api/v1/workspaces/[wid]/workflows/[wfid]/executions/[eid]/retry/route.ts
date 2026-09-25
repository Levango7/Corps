import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { apiMsg } from "@/lib/api-messages";
import { Prisma } from "@prisma/client";
import { executeWorkflow } from "@/lib/workflow/executor";
import { logger } from "@/lib/logger";

/**
 * POST /v1/workspaces/{wid}/workflows/{wfid}/executions/{eid}/retry — 重试执行
 *
 * 将 status 从 failed 改为 running，并重新调用执行引擎。
 * 校验：执行存在 + 属于该工作区 + workflowId 匹配 + status 为 failed。
 *
 * 设计说明：
 *  - 重试复用原执行记录的 triggerData（用相同触发数据重新执行）
 *  - 重置 startedAt/completedAt/result，状态先置 pending，执行引擎内部会
 *    立即 update 为 running
 *  - executeWorkflow 内部已 try-catch，不会抛异常影响响应；调用方额外
 *    兜底 catch 仅做日志记录
 *  - 执行引擎用裸 prisma client（不在 runWithWorkspace 事务上下文中），
 *    与 executions/route.ts POST 触发逻辑保持一致
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; wfid: string; eid: string }> },
) {
  const { wid, wfid, eid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    // 1. 查询执行记录，确认存在且属于该工作区 + workflowId 匹配
    const existing = await runWithWorkspace(
      wid,
      (tx) =>
        tx.workflowExecution.findUnique({
          where: { id: eid },
          select: { workflowId: true, workspaceId: true, status: true, triggerData: true },
        }),
      ctx.payload.sub,
    );

    if (!existing || existing.workspaceId !== wid || existing.workflowId !== wfid) {
      return NextResponse.json(
        { code: 404, data: null, message: apiMsg(req, "executionNotFound") },
        { status: 404 },
      );
    }

    // 2. 校验 status 为 failed 才能重试
    if (existing.status !== "failed") {
      return NextResponse.json(
        { code: 409, data: null, message: apiMsg(req, "executionCannotRetry") },
        { status: 409 },
      );
    }

    // 3. 重置执行记录：status → pending，清空 startedAt/completedAt/result
    //    result 用 Prisma.DbNull 表示数据库 NULL（区别于 Prisma.JsonNull 的 JSON null 值）
    await runWithWorkspace(
      wid,
      (tx) =>
        tx.workflowExecution.update({
          where: { id: eid },
          data: {
            status: "pending",
            startedAt: null,
            completedAt: null,
            result: Prisma.DbNull,
          },
        }),
      ctx.payload.sub,
    );

    // 4. 重新调用执行引擎（用原 triggerData）
    //    executeWorkflow 内部已 try-catch，此处仅防御性记录
    const triggerData = (existing.triggerData ?? {}) as Record<string, unknown>;
    await executeWorkflow(wid, wfid, eid, triggerData).catch((err) => {
      logger.error("[POST workflow execution retry] executeWorkflow unexpected error", {
        executionId: eid,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    // 5. 重新查询执行记录，返回最新状态（completed/failed）给客户端
    const updated = await runWithWorkspace(
      wid,
      (tx) => tx.workflowExecution.findUnique({ where: { id: eid } }),
      ctx.payload.sub,
    );

    return NextResponse.json({
      code: 0,
      data: updated,
      message: apiMsg(req, "executionRetried"),
    });
  } catch (error) {
    // P2025：记录不存在（并发删除等竞态）
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json(
        { code: 404, data: null, message: apiMsg(req, "executionNotFound") },
        { status: 404 },
      );
    }
    console.error("[POST workflow execution retry] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
