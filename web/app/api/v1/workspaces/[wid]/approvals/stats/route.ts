import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";

/** 审批节点类型（nodes JSON 快照中的单节点，与 instances route 一致） */
interface ApprovalNode {
  approverRole?: string;
  approverUserId?: string;
  name: string;
  order: number;
  mode?: "sequential" | "parallel" | "countersign";
  requiredCount?: number;
}

/** 判断用户是否是当前节点的审批人（与 instances route 逻辑一致） */
function isCurrentApprover(
  nodes: ApprovalNode[],
  currentNode: number,
  userId: string,
  userRole: string,
): boolean {
  const node = nodes[currentNode];
  if (!node) return false;
  return (
    node.approverUserId === userId ||
    (node.approverRole !== undefined && node.approverRole === userRole)
  );
}

/** 查询参数校验 */
const statsQuerySchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  templateId: z.string().uuid().optional(),
});

/**
 * GET /v1/workspaces/{wid}/approvals/stats — 审批统计仪表盘
 * Query: ?startDate=...&endDate=...&templateId=...
 * 默认时间范围：最近30天
 * 返回：总数、按状态/优先级/模板分组统计、平均处理时长、当前用户待审批数
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  try {
    const url = new URL(req.url);
    const parsed = statsQuerySchema.safeParse({
      startDate: url.searchParams.get("startDate") ?? undefined,
      endDate: url.searchParams.get("endDate") ?? undefined,
      templateId: url.searchParams.get("templateId") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "validationFailed"), errors: parsed.error.errors, data: null },
        { status: 400 },
      );
    }
    const { startDate, endDate, templateId } = parsed.data;

    // 默认最近30天
    const now = new Date();
    const start = startDate ? new Date(startDate) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : now;

    // 构建 where 条件
    const where = {
      workspaceId: wid,
      createdAt: { gte: start, lte: end },
      ...(templateId ? { templateId } : {}),
    };

    // 并行执行所有统计查询
    const [total, statusGroups, priorityGroups, templateGroups, completedInstances, pendingInstances] =
      await runWithWorkspace(wid, (tx) =>
        Promise.all([
          // 总数
          tx.approvalInstance.count({ where }),

          // 按状态分组
          tx.approvalInstance.groupBy({
            by: ["status"],
            where,
            _count: { _all: true },
          }),

          // 按优先级分组
          tx.approvalInstance.groupBy({
            by: ["priority"],
            where,
            _count: { _all: true },
          }),

          // 按模板分组（仅 templateId 非 null 的）
          tx.approvalInstance.groupBy({
            by: ["templateId"],
            where: { ...where, templateId: { not: null } },
            _count: { _all: true },
          }),

          // 已完成的审批实例（用于计算平均处理时长）
          tx.approvalInstance.findMany({
            where: {
              ...where,
              status: { in: ["approved", "rejected", "withdrawn"] },
              completedAt: { not: null },
            },
            select: { createdAt: true, completedAt: true },
          }),

          // pending 实例（用于计算 pendingMine）
          tx.approvalInstance.findMany({
            where: { ...where, status: "pending" },
            select: { nodes: true, currentNode: true },
          }),
        ]),
      );

    // 组装 byStatus
    const byStatus: Record<string, number> = { pending: 0, approved: 0, rejected: 0, withdrawn: 0 };
    for (const g of statusGroups) {
      byStatus[g.status] = g._count._all;
    }

    // 组装 byPriority
    const byPriority: Record<string, number> = { normal: 0, urgent: 0, critical: 0 };
    for (const g of priorityGroups) {
      byPriority[g.priority] = g._count._all;
    }

    // 组装 byTemplate — 需要查询模板名称
    const templateIds = templateGroups.map((g) => g.templateId!).filter(Boolean);
    const templates =
      templateIds.length > 0
        ? await runWithWorkspace(wid, (tx) =>
            tx.approvalTemplate.findMany({
              where: { id: { in: templateIds } },
              select: { id: true, name: true },
            }),
          )
        : [];

    const templateNameMap = new Map(templates.map((t) => [t.id, t.name]));
    const byTemplate = templateGroups.map((g) => ({
      templateId: g.templateId!,
      templateName: templateNameMap.get(g.templateId!) ?? "未知模板",
      count: g._count._all,
    }));

    // 计算 avgProcessingHours
    let avgProcessingHours = 0;
    if (completedInstances.length > 0) {
      const totalHours = completedInstances.reduce((sum, inst) => {
        const diff = inst.completedAt!.getTime() - inst.createdAt.getTime();
        return sum + diff / (1000 * 60 * 60); // 毫秒 → 小时
      }, 0);
      avgProcessingHours = Math.round((totalHours / completedInstances.length) * 10) / 10; // 保留1位小数
    }

    // 计算 pendingMine — 当前用户是当前节点审批人的 pending 实例数
    let pendingMine = 0;
    if (ctx.payload.sub) {
      const userId = ctx.payload.sub;
      const userRole = ctx.member.role;
      pendingMine = pendingInstances.filter((inst) => {
        const nodes = inst.nodes as unknown as ApprovalNode[];
        return isCurrentApprover(nodes, inst.currentNode, userId, userRole);
      }).length;
    }

    return NextResponse.json({
      code: 200,
      data: {
        total,
        byStatus,
        byPriority,
        byTemplate,
        avgProcessingHours,
        pendingMine,
      },
    });
  } catch (error) {
    console.error("[GET approval-stats] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}