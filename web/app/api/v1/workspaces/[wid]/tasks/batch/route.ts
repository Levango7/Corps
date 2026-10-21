import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContextV2, runWithWorkspace } from "@/lib/auth";
import { authFailure } from "@/lib/auth-response";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";
import { requirePermission } from "@/lib/permissions";
import { deleteTaskFiles } from "@/lib/uploads-cleanup";
import { trackServerEvent } from "@/lib/analytics-server";

/**
 * POST /api/v1/workspaces/:wid/tasks/batch — 任务批量操作。
 *
 * P2 功能：批量改状态/优先级/负责人 + 批量删除。
 *
 * 设计：
 *  - 单次最多 100 条（防止超大批量打满事务）
 *  - 所有 id 必须属于当前工作区（RLS 兜底，但显式校验返回 skipped）
 *  - 部分成功：返回 { updated, deleted, skipped }，skipped 为不属于当前工作区的 id
 *  - assigneeId 校验同单条：必须是当前工作区成员
 *  - 删除模式：action=delete，其余字段忽略
 *  - 批量改 status 由服务端**逐条**发 task_status_change（props {taskId, to, via:"batch"}），
 *    与单条 PATCH 同口径。board 页原先那条客户端聚合事件（`{batch:true, count}`，无 taskId）
 *    在同一次提交里撤掉：同一动作留两个真源，批量路径的计数会翻倍；而客户端那条既给不出
 *    taskId（"任务何时进入 done"的闭环推导要用），也不算权威（页面在 flush 前关掉就丢）。
 *    事件 id 取自 update 后**读回**的落库结果，不按 validIds 发（理由见下方注释）。
 *
 * 权限：所有成员可批量改状态/优先级；改 assignee 需要 admin/owner（与单条 PATCH 对齐）。
 */

const batchSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
  action: z.enum(["update", "delete"]),
  // update 模式下的字段（全部 optional，仅传需要改的字段）
  status: z.enum(["todo", "in_progress", "review", "done"]).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
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
    const body = batchSchema.parse(await req.json());

    // 改 assignee 需要 tasks:update 权限（与单条 PATCH 对齐）
    if (body.action === "update" && body.assigneeId !== undefined) {
      const denied = await requirePermission(ctx, "tasks", "update", req);
      if (denied) return denied;
    }

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        // 1) 校验所有 id 属于当前工作区（RLS 兜底，但显式校验返回 skipped）
        const existing = await tx.task.findMany({
          where: { id: { in: body.ids }, workspaceId: wid },
          select: { id: true },
        });
        const validIds = new Set(existing.map((t) => t.id));
        const skipped = body.ids.filter((id) => !validIds.has(id));

        if (validIds.size === 0) {
          return { updated: 0, deleted: 0, skipped, statusLandedIds: [] as string[] };
        }

        // 2) 校验 assigneeId 是当前工作区成员
        if (body.action === "update" && body.assigneeId) {
          const member = await tx.member.findUnique({
            where: { userId_workspaceId: { userId: body.assigneeId, workspaceId: wid } },
            select: { userId: true },
          });
          if (!member) {
            return { error: apiMsg(req, "assigneeNotMember") };
          }
        }

        // 3) 执行批量操作
        if (body.action === "delete") {
          // 清理附件磁盘文件（与单条 DELETE 对齐；尽力而为，失败不阻断删除）
          for (const taskId of validIds) {
            await deleteTaskFiles(taskId);
          }
          const deleted = await tx.task.deleteMany({
            where: { id: { in: Array.from(validIds) }, workspaceId: wid },
          });
          return {
            updated: 0,
            deleted: deleted.count,
            skipped,
            statusLandedIds: [] as string[],
          };
        }

        // update：构造 patch data（仅含传入字段）
        const patchData: Record<string, unknown> = {};
        if (body.status !== undefined) patchData.status = body.status;
        if (body.priority !== undefined) patchData.priority = body.priority;
        if (body.assigneeId !== undefined) patchData.assigneeId = body.assigneeId;
        if (body.dueDate !== undefined)
          patchData.dueDate = body.dueDate ? new Date(body.dueDate) : null;

        if (Object.keys(patchData).length === 0) {
          return { updated: 0, deleted: 0, skipped, statusLandedIds: [] as string[] };
        }

        const updated = await tx.task.updateMany({
          where: { id: { in: Array.from(validIds) }, workspaceId: wid },
          data: patchData,
        });

        // 埋点要用**读回**的结果，不能用 validIds 或 updated.count：
        // 批量改状态是「一条 UPDATE 打 N 个 id」，count 只给总数、给不出"具体哪些任务真的
        // 落到了这个状态"。若直接按 validIds 发事件，一旦 RLS 或并发把某些行挡掉，
        // 就会给 analytics 造出**没发生过的完成记录**——而这类虚高的完成事件正好会被
        // 闭环率/留存这类派生指标当真数用（见 docs/design/PRODUCT-DESIGN-2026Q4.md §9.2）。
        const statusLandedIds: string[] = [];
        if (body.status !== undefined && updated.count > 0) {
          const landed = await tx.task.findMany({
            where: { id: { in: Array.from(validIds) }, workspaceId: wid, status: body.status },
            select: { id: true },
          });
          statusLandedIds.push(...landed.map((t) => t.id));
        }

        return { updated: updated.count, deleted: 0, skipped, statusLandedIds };
      },
      ctx.payload.sub,
    );

    if ("error" in result) {
      return NextResponse.json({ code: 400, message: result.error, data: null }, { status: 400 });
    }

    // 事务提交后才发事件（与单条 PATCH 同口径：task_status_change + props {taskId, to}，
    // 额外带 via:"batch" 便于区分来源）。响应体保持原形状，不把 statusLandedIds 漏出去。
    const { statusLandedIds, ...data } = result;
    if (statusLandedIds.length > 0 && body.status !== undefined) {
      const to = body.status;
      await Promise.all(
        statusLandedIds.map((taskId) =>
          trackServerEvent({
            userId: ctx.payload.sub,
            workspaceId: wid,
            name: "task_status_change",
            props: { taskId, to, via: "batch" },
          }),
        ),
      );
    }

    return NextResponse.json({ code: 200, data });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "validationError"), errors: error.issues, data: null },
        { status: 400 },
      );
    }
    console.error("[POST tasks/batch] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}
