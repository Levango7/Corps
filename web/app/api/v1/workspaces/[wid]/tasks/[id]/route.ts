import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";

const updateTaskSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  status: z.enum(["todo", "in_progress", "review", "done"]).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  sortOrder: z.number().optional(),
});

/** GET /v1/workspaces/{wid}/tasks/{id} — 任务详情（详情页首屏） */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string }> },
) {
  const { wid, id } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });

  try {
    const task = await runWithWorkspace(wid, (tx) =>
      tx.task.findFirst({
        where: { id, workspaceId: wid },
        include: {
          assignee: { select: { id: true, name: true, email: true, image: true } },
          creator: { select: { id: true, name: true, email: true } },
        },
      }),
    );

    if (!task) return NextResponse.json({ code: 404, message: "任务不存在" }, { status: 404 });

    return NextResponse.json({ code: 200, data: task });
  } catch (error) {
    console.error("[GET task] error:", error);
    return NextResponse.json({ code: 500, data: null, message: "服务器内部错误" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string }> },
) {
  const { wid, id } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const validated = updateTaskSchema.parse(body);

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        // 先检查任务存在且属于该工作区（防跨租户写入）
        const existing = await tx.task.findFirst({
          where: { id, workspaceId: wid },
          select: { id: true, assigneeId: true, title: true },
        });
        if (!existing) return { kind: "notFound" as const };

        // 被指派人必须属于当前工作区（assignee_id 是跨表引用，RLS 不覆盖 users）
        if (validated.assigneeId) {
          const member = await tx.member.findUnique({
            where: { userId_workspaceId: { userId: validated.assigneeId, workspaceId: wid } },
            select: { userId: true },
          });
          if (!member) return { kind: "invalidAssignee" as const };
        }

        const task = await tx.task.update({
          where: { id },
          data: validated,
          include: { assignee: { select: { id: true, name: true, email: true } } },
        });

        // A-3: assignee 变更且新 assignee 不是操作者时，创建 task_assigned 通知
        if (
          validated.assigneeId !== undefined &&
          validated.assigneeId !== existing.assigneeId &&
          validated.assigneeId !== null &&
          validated.assigneeId !== ctx.payload.sub
        ) {
          await tx.notification.create({
            data: {
              userId: validated.assigneeId,
              workspaceId: wid,
              type: "task_assigned",
              entityId: id,
              entityTitle: task.title,
            },
          });
        }

        return { kind: "ok" as const, task };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound") {
      return NextResponse.json({ code: 404, message: "任务不存在" }, { status: 404 });
    }
    if (result.kind === "invalidAssignee") {
      return NextResponse.json(
        { code: 400, message: "被指派人必须是当前工作区成员" },
        { status: 400 },
      );
    }

    return NextResponse.json({ code: 200, data: result.task });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: "Validation error", errors: error.errors },
        { status: 400 },
      );
    }
    // P2025: 记录不存在（并发删除场景）
    if ((error as { code?: string }).code === "P2025") {
      return NextResponse.json({ code: 404, message: "任务不存在" }, { status: 404 });
    }
    console.error("Update task error:", error);
    return NextResponse.json({ code: 500, message: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string }> },
) {
  const { wid, id } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });

  try {
    // 先检查任务存在且属于该工作区（防跨租户删除），不存在返回 404 而非 500
    const existing = await runWithWorkspace(
      wid,
      (tx) => tx.task.findFirst({ where: { id, workspaceId: wid }, select: { id: true } }),
      ctx.payload.sub,
    );
    if (!existing) {
      return NextResponse.json({ code: 404, message: "任务不存在" }, { status: 404 });
    }

    await runWithWorkspace(wid, (tx) => tx.task.delete({ where: { id } }), ctx.payload.sub);

    return NextResponse.json({ code: 200, data: null });
  } catch (error) {
    // P2025: 记录不存在（并发删除场景）
    if ((error as { code?: string }).code === "P2025") {
      return NextResponse.json({ code: 404, message: "任务不存在" }, { status: 404 });
    }
    console.error("[DELETE task] error:", error);
    return NextResponse.json({ code: 500, data: null, message: "服务器内部错误" }, { status: 500 });
  }
}
