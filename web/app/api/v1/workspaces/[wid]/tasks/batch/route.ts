import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";

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
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });

  try {
    const body = batchSchema.parse(await req.json());

    // 改 assignee 需要 admin/owner 权限（与单条 PATCH 对齐）
    if (body.action === "update" && body.assigneeId !== undefined) {
      if (ctx.member.role !== "owner" && ctx.member.role !== "admin") {
        return NextResponse.json(
          { code: 403, message: "仅管理员可批量指派任务" },
          { status: 403 },
        );
      }
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
          return { updated: 0, deleted: 0, skipped };
        }

        // 2) 校验 assigneeId 是当前工作区成员
        if (body.action === "update" && body.assigneeId) {
          const member = await tx.member.findUnique({
            where: { userId_workspaceId: { userId: body.assigneeId, workspaceId: wid } },
            select: { userId: true },
          });
          if (!member) {
            return { error: "被指派人必须是当前工作区成员" as const };
          }
        }

        // 3) 执行批量操作
        if (body.action === "delete") {
          const deleted = await tx.task.deleteMany({
            where: { id: { in: Array.from(validIds) }, workspaceId: wid },
          });
          return { updated: 0, deleted: deleted.count, skipped };
        }

        // update：构造 patch data（仅含传入字段）
        const patchData: Record<string, unknown> = {};
        if (body.status !== undefined) patchData.status = body.status;
        if (body.priority !== undefined) patchData.priority = body.priority;
        if (body.assigneeId !== undefined) patchData.assigneeId = body.assigneeId;
        if (body.dueDate !== undefined) patchData.dueDate = body.dueDate;

        if (Object.keys(patchData).length === 0) {
          return { updated: 0, deleted: 0, skipped };
        }

        const updated = await tx.task.updateMany({
          where: { id: { in: Array.from(validIds) }, workspaceId: wid },
          data: patchData,
        });
        return { updated: updated.count, deleted: 0, skipped };
      },
      ctx.payload.sub,
    );

    if ("error" in result) {
      return NextResponse.json({ code: 400, message: result.error }, { status: 400 });
    }

    return NextResponse.json({ code: 200, data: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: "Validation error", errors: error.errors },
        { status: 400 },
      );
    }
    console.error("[POST tasks/batch] error:", error);
    return NextResponse.json({ code: 500, message: "Internal server error" }, { status: 500 });
  }
}