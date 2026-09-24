import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { apiMsg } from "@/lib/api-messages";
import { executeWorkflow } from "@/lib/workflow/executor";
import { logger } from "@/lib/logger";

/**
 * GET /v1/workspaces/{wid}/workflows/{wfid}/executions — 执行历史
 * Query: ?take=&skip= 分页
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string; wfid: string }> }) {
  const { wid, wfid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const url = new URL(req.url);
    const parsed = listSchema.safeParse({
      take: url.searchParams.get("take") ?? undefined,
      skip: url.searchParams.get("skip") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "validationFailed"), errors: parsed.error.errors, data: null },
        { status: 400 },
      );
    }
    const { take, skip } = parsed.data;

    // 确认工作流存在且属于该工作区
    const wf = await runWithWorkspace(
      wid,
      (tx) => tx.workflow.findUnique({ where: { id: wfid }, select: { workspaceId: true } }),
      ctx.payload.sub,
    );
    if (!wf || wf.workspaceId !== wid) {
      return NextResponse.json({ code: 404, data: null, message: apiMsg(req, "workflowNotFound") }, { status: 404 });
    }

    const where = { workflowId: wfid, workspaceId: wid };
    const [items, total] = await runWithWorkspace(wid, (tx) =>
      Promise.all([
        tx.workflowExecution.findMany({
          where,
          orderBy: [{ createdAt: "desc" }],
          skip,
          take,
        }),
        tx.workflowExecution.count({ where }),
      ]),
    );

    return NextResponse.json({ code: 0, data: { items, total, skip, take } });
  } catch (error) {
    console.error("[GET workflow executions] error:", error);
    return NextResponse.json({ code: 500, data: null, message: apiMsg(req, "internalError") }, { status: 500 });
  }
}

const listSchema = z.object({
  take: z.coerce.number().int().min(1).max(100).default(20),
  skip: z.coerce.number().int().min(0).default(0),
});

const triggerSchema = z.object({
  triggerData: z.record(z.unknown()).optional(),
});

/**
 * POST /v1/workspaces/{wid}/workflows/{wfid}/executions — 手动触发执行
 * 创建 WorkflowExecution 记录，status 设为 "pending"
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string; wfid: string }> }) {
  const { wid, wfid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const validated = triggerSchema.parse(body);

    // 确认工作流存在且属于该工作区
    const wf = await runWithWorkspace(
      wid,
      (tx) => tx.workflow.findUnique({ where: { id: wfid }, select: { workspaceId: true, trigger: true } }),
      ctx.payload.sub,
    );
    if (!wf || wf.workspaceId !== wid) {
      return NextResponse.json({ code: 404, data: null, message: apiMsg(req, "workflowNotFound") }, { status: 404 });
    }

    const execution = await runWithWorkspace(
      wid,
      (tx) =>
        tx.workflowExecution.create({
          data: {
            workflowId: wfid,
            workspaceId: wid,
            triggerData: (validated.triggerData ?? {}) as Prisma.InputJsonValue,
            status: "pending",
          },
        }),
      ctx.payload.sub,
    );

    // 同步执行工作流（executeWorkflow 内部已 try-catch，不会抛异常影响响应）
    // 执行引擎用裸 prisma client 直接操作（不在 runWithWorkspace 事务上下文中）
    const triggerData = (validated.triggerData ?? {}) as Record<string, unknown>;
    await executeWorkflow(wid, wfid, execution.id, triggerData).catch((err) => {
      // 兜底：executeWorkflow 内部已 try-catch，此处仅防御性记录
      logger.error("[POST workflow execution] executeWorkflow unexpected error", {
        executionId: execution.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    // 重新查询执行记录，返回最新状态（completed/failed）给客户端
    const latest = await runWithWorkspace(
      wid,
      (tx) => tx.workflowExecution.findUnique({ where: { id: execution.id } }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 0, data: latest ?? execution }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"), data: null, errors: error.errors },
        { status: 400 },
      );
    }
    console.error("[POST workflow execution] error:", error);
    return NextResponse.json({ code: 500, data: null, message: apiMsg(req, "internalError") }, { status: 500 });
  }
}