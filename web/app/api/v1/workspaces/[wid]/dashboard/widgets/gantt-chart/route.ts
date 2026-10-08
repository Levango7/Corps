import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { getWorkspaceContextV2, runWithWorkspace } from "@/lib/auth";
import { apiMsg } from "@/lib/api-messages";
import { handlePrismaError } from "@/lib/prisma-error";
import { authFailure } from "@/lib/auth-response";

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
 * 认证：getWorkspaceContextV2 校验成员身份 + 注入 RLS。
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContextV2(req, wid);
  if (!ctx)
    // V2 契约上从不返回 null（见 lib/auth.ts 的 WorkspaceContextV2 文档：
    // "调用方遇到 null 应按 500 处理（fail-closed，不可当作 401 重试）"）。
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  if (!ctx.ok) return authFailure(ctx, req);

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
