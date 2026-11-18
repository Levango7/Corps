/**
 * GET /v1/workspaces/{wid}/tasks/{id}/decisions/{did}/action-items
 *
 * 某条决策的行动项列表（含同步后的任务关联），供任务详情「执行追踪」面板渲染。
 * 数据真源是 DecisionActionItem（由 lib/decision-action-parser 在保存决策时同步产生），
 * removed=true 的是从 Markdown 中删掉的历史行，不出现在面板上。
 */
import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContextV2, runWithWorkspace } from "@/lib/auth";
import { authFailure } from "@/lib/auth-response";
import { apiMsg } from "@/lib/api-messages";
import { withRed } from "@/lib/red-metrics";

async function getTasksDecisionsActionItemsByIdByDid(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string; did: string }> },
) {
  const { wid, id, did } = await params;
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
    const items = await runWithWorkspace(wid, async (tx) => {
      // 校验决策确实属于该任务 + 工作区（防跨任务/跨租户读取）
      const decision = await tx.decision.findFirst({
        where: { id: did, taskId: id, workspaceId: wid },
        select: { id: true },
      });
      if (!decision) return null;

      const rows = await tx.decisionActionItem.findMany({
        where: { decisionId: did, removed: false },
        orderBy: { lineIndex: "asc" },
        include: { assignee: { select: { id: true, name: true, email: true } } },
      });
      return rows.map((it) => ({
        id: it.id,
        title: it.title,
        completed: it.checked,
        assignee: it.assignee
          ? { id: it.assignee.id, name: it.assignee.name, email: it.assignee.email }
          : null,
        dueDate: it.dueDate ? it.dueDate.toISOString() : null,
        priority: it.priority,
        taskId: it.taskId,
      }));
    });

    if (items === null) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "decisionNotFound"), data: null },
        { status: 404 },
      );
    }

    return NextResponse.json({ code: 200, data: { items } });
  } catch (error) {
    console.error("[GET decision action-items] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

// RED 指标接线：Rate/Duration 通过 withRed 包装器自动记录
export const GET = withRed(getTasksDecisionsActionItemsByIdByDid);
