import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { apiMsg } from "@/lib/api-messages";
import { handlePrismaError } from "@/lib/prisma-error";

type Tx = Prisma.TransactionClient;

/**
 * F3 Widget 仪表盘 — 自定义图表数据。
 *
 * GET /api/v1/workspaces/:wid/dashboard/widgets/custom-chart
 *   → 返回自定义图表数据（chartType, dataSource, labels, values, total）
 *
 * 默认返回任务状态分布（dataSource=taskStatus）：
 *   labels = ["todo", "in_progress", "review", "done"]
 *   values = [对应计数]
 *
 * 前端可通过 WidgetConfigPanel 配置 chartType（bar/line/pie）与 dataSource，
 * 配置由前端持有（widgetConfigs），API 当前返回默认状态分布数据；
 * 图表类型（chartType）由前端配置决定渲染方式，API 返回通用 labels/values 结构。
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
    const data = await runWithWorkspace(
      wid,
      (tx) => loadCustomChart(tx, wid),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 200, data });
  } catch (error) {
    console.error("[GET dashboard/widgets/custom-chart] error:", error);
    return handlePrismaError(error, req);
  }
}

/** 任务状态分布的标签顺序（与 TaskStatsWidget 对齐） */
const STATUS_LABELS = ["todo", "in_progress", "review", "done"] as const;

/** 加载自定义图表数据：默认任务状态分布 */
async function loadCustomChart(tx: Tx, wid: string) {
  const grouped = await tx.task.groupBy({
    by: ["status"],
    where: { workspaceId: wid, parentId: null },
    _count: { _all: true },
  });

  // 按状态标签顺序组装 values
  const counts: Record<string, number> = {
    todo: 0,
    in_progress: 0,
    review: 0,
    done: 0,
  };
  for (const g of grouped) {
    counts[g.status] = g._count._all;
  }
  const values = STATUS_LABELS.map((s) => counts[s]);
  const total = values.reduce((sum, v) => sum + v, 0);

  return {
    chartType: "bar" as const,
    dataSource: "taskStatus",
    labels: [...STATUS_LABELS],
    values,
    total,
  };
}