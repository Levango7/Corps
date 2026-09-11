import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { apiMsg } from "@/lib/api-messages";
import { handlePrismaError } from "@/lib/prisma-error";

type Tx = Prisma.TransactionClient;

/**
 * F3 Widget 仪表盘 — 甘特图数据。
 *
 * GET /api/v1/workspaces/:wid/dashboard/widgets/gantt-chart
 *   → 返回任务的甘特图数据（id, title, startDate, dueDate, status, assignee）
 *
 * 说明：Task 模型无独立 startDate 字段，以 createdAt 近似作为甘特图起点，
 * dueDate 作为结束日期。仅查询有 dueDate 的顶层任务，按 createdAt 排序，
 * 限制最多 20 条记录。
 *
 * 认证：getWorkspaceContext 校验成员身份 + 注入 RLS。
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string }> },
) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const data = await runWithWorkspace(wid, (tx) => loadGantt(tx, wid), ctx.payload.sub);

    return NextResponse.json({ code: 200, data });
  } catch (error) {
    console.error("[GET dashboard/widgets/gantt-chart] error:", error);
    return handlePrismaError(error, req);
  }
}

/** 加载甘特图数据：有 dueDate 的顶层任务，按 createdAt 排序，最多 20 条 */
async function loadGantt(tx: Tx, wid: string) {
  const tasks = await tx.task.findMany({
    where: {
      workspaceId: wid,
      parentId: null,
      dueDate: { not: null },
    },
    select: {
      id: true,
      title: true,
      createdAt: true,
      dueDate: true,
      status: true,
      assignee: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 20,
  });

  const items = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    startDate: t.createdAt.toISOString(),
    dueDate: t.dueDate!.toISOString(),
    status: t.status,
    assignee: t.assignee?.name ?? null,
  }));

  return { items };
}