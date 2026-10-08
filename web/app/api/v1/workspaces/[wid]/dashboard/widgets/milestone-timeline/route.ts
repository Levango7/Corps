import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { getWorkspaceContextV2, runWithWorkspace } from "@/lib/auth";
import { apiMsg } from "@/lib/api-messages";
import { handlePrismaError } from "@/lib/prisma-error";
import { authFailure } from "@/lib/auth-response";

type Tx = Prisma.TransactionClient;

/**
 * F3 Widget 仪表盘 — 里程碑时间线数据。
 *
 * GET /api/v1/workspaces/:wid/dashboard/widgets/milestone-timeline
 *   → 返回里程碑时间线数据（id, name, dueDate, status, taskCount）
 *
 * 里程碑状态推断（Milestone 模型无独立 status 字段）：
 *  - 关联任务全部 done → "done"
 *  - 存在 in_progress/review 任务 → "in_progress"
 *  - 否则（全部 todo 或无任务）→ "pending"
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
    const data = await runWithWorkspace(
      wid,
      (tx) => loadMilestoneTimeline(tx, wid),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 200, data });
  } catch (error) {
    console.error("[GET dashboard/widgets/milestone-timeline] error:", error);
    return handlePrismaError(error, req);
  }
}

/** 加载里程碑时间线数据：所有里程碑按 dueDate 排序，附状态与任务数 */
async function loadMilestoneTimeline(tx: Tx, wid: string) {
  const milestones = await tx.milestone.findMany({
    where: { workspaceId: wid },
    select: {
      id: true,
      name: true,
      dueDate: true,
      tasks: { select: { status: true } },
    },
    orderBy: { dueDate: "asc" },
  });

  const items = milestones.map((m) => {
    const taskCount = m.tasks.length;
    const statuses = m.tasks.map((t) => t.status);
    const allDone = taskCount > 0 && statuses.every((s) => s === "done");
    const hasInProgress = statuses.some((s) => s === "in_progress" || s === "review");
    const status: "done" | "in_progress" | "pending" = allDone
      ? "done"
      : hasInProgress
        ? "in_progress"
        : "pending";
    return {
      id: m.id,
      name: m.name,
      dueDate: m.dueDate?.toISOString() ?? null,
      status,
      taskCount,
    };
  });

  return { items };
}
