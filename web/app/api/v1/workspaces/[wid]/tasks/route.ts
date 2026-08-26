import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { trackServerEvent } from "@/lib/analytics-server";
import { z } from "zod";

const createTaskSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  status: z.enum(["todo", "in_progress", "review", "done"]).default("todo"),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  assigneeId: z.string().uuid().optional(),
  dueDate: z.string().datetime().optional(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });

  try {
    // assignee=me：用当前认证用户 ID 过滤 assigneeId；其他值（或缺失）返回所有任务
    const url = new URL(req.url);
    const assigneeFilter =
      url.searchParams.get("assignee") === "me" ? { assigneeId: ctx.payload.sub } : {};

    const tasks = await runWithWorkspace(wid, (tx) =>
      tx.task.findMany({
        where: { workspaceId: wid, ...assigneeFilter },
        include: {
          assignee: { select: { id: true, name: true, email: true } },
          _count: { select: { comments: true } },
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        // 上限保护：看板场景单工作区任务量可控；游标分页列入 v2（见 API-DESIGN-GUIDE）
        take: 500,
      }),
    );

    return NextResponse.json({ code: 200, data: tasks });
  } catch (error) {
    console.error("[GET tasks] error:", error);
    return NextResponse.json({ code: 500, data: null, message: "服务器内部错误" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const validated = createTaskSchema.parse(body);

    // 被指派人必须属于当前工作区（assignee_id 是跨表引用，RLS 不覆盖 users）
    const task = await runWithWorkspace(
      wid,
      async (tx) => {
        if (validated.assigneeId) {
          const member = await tx.member.findUnique({
            where: { userId_workspaceId: { userId: validated.assigneeId, workspaceId: wid } },
            select: { userId: true },
          });
          if (!member) return { invalidAssignee: true as const };
        }

        const maxOrder = await tx.task.aggregate({
          where: { workspaceId: wid },
          _max: { sortOrder: true },
        });
        return {
          invalidAssignee: false as const,
          task: await tx.task.create({
            data: {
              ...validated,
              workspaceId: wid,
              createdBy: ctx.payload.sub,
              sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
            },
            include: { assignee: { select: { id: true, name: true, email: true } } },
          }),
        };
      },
      ctx.payload.sub,
    );

    if (task.invalidAssignee) {
      return NextResponse.json(
        { code: 400, message: "被指派人必须是当前工作区成员" },
        { status: 400 },
      );
    }

    // P2 数据埋点：create_task 事件（不阻塞主流程）
    await trackServerEvent({
      userId: ctx.payload.sub,
      workspaceId: wid,
      name: "create_task",
      props: {
        priority: validated.priority,
        status: validated.status,
        hasAssignee: !!validated.assigneeId,
        hasDueDate: !!validated.dueDate,
      },
    });

    return NextResponse.json({ code: 201, data: task.task }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: "Validation error", errors: error.errors },
        { status: 400 },
      );
    }
    console.error("Create task error:", error);
    return NextResponse.json({ code: 500, message: "Internal server error" }, { status: 500 });
  }
}
