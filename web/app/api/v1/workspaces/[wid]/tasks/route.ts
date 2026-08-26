import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { trackServerEvent } from "@/lib/analytics-server";
import { shouldActivate } from "@/lib/analytics-activation";
import { prisma } from "@/lib/prisma";
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
        const created = await tx.task.create({
          data: {
            ...validated,
            workspaceId: wid,
            createdBy: ctx.payload.sub,
            sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
          },
          include: { assignee: { select: { id: true, name: true, email: true } } },
        });
        // P2-1：isFirstTask 与 dupCount 在主事务内用 tx.count 取值
        // isFirstTask 供 activation 判定复用，避免事务外二次计数竞态
        // dupCount 在事务内随任务创建一并 count，消除全局实例 RLS 疑问
        const taskCount = await tx.task.count({ where: { workspaceId: wid } });
        const dupCount = await tx.analyticsEvent.count({
          where: { workspaceId: wid, name: "activation_completed" },
        });
        return {
          invalidAssignee: false as const,
          task: created,
          isFirstTask: taskCount === 1,
          dupCount,
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
    // selfAssigned：AC-07 他派判定（assigneeId === ctx.payload.sub 即自派）
    const selfAssigned = !!validated.assigneeId && validated.assigneeId === ctx.payload.sub;
    await trackServerEvent({
      userId: ctx.payload.sub,
      workspaceId: wid,
      name: "create_task",
      props: {
        priority: validated.priority,
        status: validated.status,
        hasAssignee: !!validated.assigneeId,
        hasDueDate: !!validated.dueDate,
        selfAssigned,
      },
    });

    // 激活判定：主事务提交后、响应返回前；P2-1 整块包 try-catch 失败静默
    // 条件：isFirstTask && hasAssignee && !selfAssigned && dupCount===0 && minutesSinceRegister ≤ 15
    // shouldActivate 纯函数见 lib/analytics-activation.ts（供单测布尔矩阵覆盖）
    try {
      if (
        shouldActivate({
          isFirstTask: task.isFirstTask,
          assignedToOther: !!validated.assigneeId && !selfAssigned,
          minutesSinceRegister: 0, // 占位，下方真实计算后重新判定
          dupCount: task.dupCount,
        })
      ) {
        const user = await prisma.user.findUnique({
          where: { id: ctx.payload.sub },
          select: { createdAt: true },
        });
        if (user) {
          const minutesSinceRegister = (Date.now() - user.createdAt.getTime()) / 60_000;
          if (
            shouldActivate({
              isFirstTask: task.isFirstTask,
              assignedToOther: !!validated.assigneeId && !selfAssigned,
              minutesSinceRegister,
              dupCount: task.dupCount,
            })
          ) {
            await trackServerEvent({
              userId: ctx.payload.sub,
              workspaceId: wid,
              name: "activation_completed",
              props: {
                taskId: task.task.id,
                minutesSinceRegister: Math.round(minutesSinceRegister),
              },
            });
          }
        }
      }
    } catch {
      /* P2-1：判定块任一查询/写入抛错均静默，主接口已 201 不受影响 */
    }

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
