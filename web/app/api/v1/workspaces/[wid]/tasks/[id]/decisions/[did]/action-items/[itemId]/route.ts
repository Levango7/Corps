/**
 * PATCH /v1/workspaces/{wid}/tasks/{id}/decisions/{did}/action-items/{itemId}
 *
 * 勾选/取消勾选行动项（「执行追踪」面板的复选框）。
 * completed 与 JSON schema 里的布尔语义一致：true = 已完成。
 *
 * 角色门禁用 tasks:update 而非 decisions:update：矩阵里 decisions 对 member
 * 只有 cr（决策只追加、新版本走 create），而勾选是**执行态**变更——它改的是
 * DecisionActionItem.checked，且（未被用户手改时）同步到关联 Task 的 status，
 * 与 lib/decision-action-parser 里 `checked ? "done" : "todo"` 的口径一致。
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/permissions";
import { getWorkspaceContextV2, runWithWorkspace } from "@/lib/auth";
import { authFailure } from "@/lib/auth-response";
import { apiMsg } from "@/lib/api-messages";
import { withRed } from "@/lib/red-metrics";

const patchActionItemSchema = z.object({
  completed: z.boolean(),
});

async function patchTasksDecisionsActionItemByItemId(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string; did: string; itemId: string }> },
) {
  const { wid, id, did, itemId } = await params;
  const ctx = await getWorkspaceContextV2(req, wid);
  if (!ctx)
    // V2 契约上从不返回 null（见 lib/auth.ts 的 WorkspaceContextV2 文档：
    // "调用方遇到 null 应按 500 处理（fail-closed，不可当作 401 重试）"）。
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  if (!ctx.ok) return authFailure(ctx, req);

  const deniedRole = await requirePermission(ctx, "tasks", "update", req);
  if (deniedRole) return deniedRole;

  try {
    const validated = patchActionItemSchema.parse(await req.json());

    const result = await runWithWorkspace(wid, async (tx) => {
      const decision = await tx.decision.findFirst({
        where: { id: did, taskId: id, workspaceId: wid },
        select: { id: true },
      });
      if (!decision) return { decisionMissing: true as const };

      const item = await tx.decisionActionItem.findFirst({
        where: { id: itemId, decisionId: did, removed: false },
        select: { id: true, taskId: true, userModified: true },
      });
      if (!item) return { itemMissing: true as const };

      const updated = await tx.decisionActionItem.update({
        where: { id: item.id },
        data: { checked: validated.completed },
        include: { assignee: { select: { id: true, name: true, email: true } } },
      });

      // 与 syncActionItems 同口径：用户手改过关联任务（userModified）就不再回写状态
      if (item.taskId && !item.userModified) {
        await tx.task.update({
          where: { id: item.taskId },
          data: { status: validated.completed ? "done" : "todo" },
        });
      }

      return {
        updated: {
          id: updated.id,
          title: updated.title,
          completed: updated.checked,
          assignee: updated.assignee
            ? {
                id: updated.assignee.id,
                name: updated.assignee.name,
                email: updated.assignee.email,
              }
            : null,
          dueDate: updated.dueDate ? updated.dueDate.toISOString() : null,
          priority: updated.priority,
          taskId: updated.taskId,
        },
      };
    });

    if ("decisionMissing" in result) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "decisionNotFound"), data: null },
        { status: 404 },
      );
    }
    if ("itemMissing" in result) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "actionItemNotFound"), data: null },
        { status: 404 },
      );
    }

    return NextResponse.json({ code: 200, data: result.updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          code: 400,
          message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"),
          data: null,
          errors: error.issues,
        },
        { status: 400 },
      );
    }
    console.error("[PATCH decision action-item] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

// RED 指标接线：Rate/Duration 通过 withRed 包装器自动记录
export const PATCH = withRed(patchTasksDecisionsActionItemByItemId);
