import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { trackServerEvent } from "@/lib/analytics-server";
import { sendTaskAssignedEmail, isEmailConfigured } from "@/lib/email";
import { syncTaskToAllCalendars } from "@/lib/calendar/sync";
import { deleteTaskFiles } from "@/lib/uploads-cleanup";
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

    // 改 assignee 需要 admin/owner 权限（与 batch 对齐）
    if (validated.assigneeId !== undefined) {
      if (ctx.member.role !== "owner" && ctx.member.role !== "admin") {
        return NextResponse.json({ code: 403, message: "仅管理员可指派任务" }, { status: 403 });
      }
    }

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

        // prevAssigneeId = 更新前的负责人，供事务外邮件分支判定"是否真的改派"。
        // task 是更新后的行，其 assigneeId 恒等于 validated.assigneeId，不能作比较基准。
        return { kind: "ok" as const, task, prevAssigneeId: existing.assigneeId };
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

    // P2 数据埋点：task_status_change 事件（仅当 status 变更时）
    if (validated.status !== undefined) {
      await trackServerEvent({
        userId: ctx.payload.sub,
        workspaceId: wid,
        name: "task_status_change",
        props: { taskId: id, to: validated.status },
      });
    }

    // 任务指派邮件通知（assignee 变更且新 assignee 非操作者本人 + 邮件已配置时，失败不阻塞）
    if (
      validated.assigneeId !== undefined &&
      validated.assigneeId !== null &&
      validated.assigneeId !== result.prevAssigneeId &&
      validated.assigneeId !== ctx.payload.sub &&
      result.task.assignee?.email &&
      isEmailConfigured()
    ) {
      try {
        // workspaces 受 FORCE RLS：加固模式下裸查恒返 null，邮件会被静默跳过，
        // 故与主事务同样经 runWithWorkspace 注入租户上下文
        const [assigner, workspace] = await runWithWorkspace(
          wid,
          async (tx) =>
            await Promise.all([
              tx.user.findUnique({
                where: { id: ctx.payload.sub },
                select: { name: true, email: true },
              }),
              tx.workspace.findUnique({ where: { id: wid }, select: { name: true } }),
            ]),
          ctx.payload.sub,
        );
        if (assigner && workspace) {
          const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
          await sendTaskAssignedEmail({
            to: result.task.assignee.email,
            assigneeName: result.task.assignee.name ?? result.task.assignee.email,
            taskTitle: result.task.title,
            workspaceName: workspace.name,
            assignerName: assigner.name ?? assigner.email,
            taskUrl: `${appUrl}/w/${wid}/task/${id}`,
          });
        }
      } catch (err) {
        console.error("[PATCH task] notifyTaskAssigned failed (non-blocking):", err);
      }
    }

    // 日历集成：dueDate 变更时异步触发同步（不阻塞响应）
    // 同步目标：任务负责人（assignee）的日历连接；无 assignee 时回退到操作者
    if (validated.dueDate !== undefined) {
      const syncUserId = result.task.assigneeId ?? ctx.payload.sub;
      // fire-and-forget：不 await，失败仅记日志，不影响任务更新响应
      syncTaskToAllCalendars(id, syncUserId).catch((err) => {
        console.error("[PATCH task] calendar sync failed (non-blocking):", err);
      });
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
      (tx) =>
        tx.task.findFirst({
          where: { id, workspaceId: wid },
          select: { id: true, createdBy: true },
        }),
      ctx.payload.sub,
    );
    if (!existing) {
      return NextResponse.json({ code: 404, message: "任务不存在" }, { status: 404 });
    }
    // 删除权限：任务创建者或 owner/admin（普通成员不能删他人创建的任务）
    if (existing.createdBy !== ctx.payload.sub && !["owner", "admin"].includes(ctx.member.role)) {
      return NextResponse.json(
        { code: 403, message: "仅任务创建者或管理员可删除任务" },
        { status: 403 },
      );
    }

    // DB 级联删除前清理附件磁盘文件（message_attachments 行随级联消失，
    // 之后将无从定位文件；尽力而为，失败不阻断删除）
    await deleteTaskFiles(id);
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
