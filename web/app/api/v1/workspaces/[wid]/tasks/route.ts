import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { trackServerEvent } from "@/lib/analytics-server";
import { shouldActivate } from "@/lib/analytics-activation";
import { prisma } from "@/lib/prisma";
import { sendTaskAssignedEmail, isEmailConfigured } from "@/lib/email";
import { z } from "zod";

const createTaskSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  status: z.enum(["todo", "in_progress", "review", "done"]).default("todo"),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  assigneeId: z.string().uuid().optional(),
  dueDate: z.string().datetime().optional(),
  milestoneId: z.string().uuid().nullable().optional(),
  labelIds: z.array(z.string().uuid()).optional(),
  parentId: z.string().uuid().nullable().optional(),
  blocked: z.boolean().optional(),
  blockedReason: z.string().max(500).nullable().optional(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });

  try {
    // 筛选参数（阶段 2-2 筛选与自定义视图）：
    //  - assignee=me 按当前用户过滤；assignee=<uuid> 按指定成员过滤
    //  - milestone=ID / milestone=null（未归入里程碑）
    //  - status=<todo|in_progress|review|done>；priority=<low|medium|high|urgent>
    //  - label=<uuid>（多标签以逗号分隔：label=a,b —— 命中任一即可，OR 语义）
    //  - q=<关键词>：标题/描述 ilike 模糊搜索（复用搜索索引）
    const url = new URL(req.url);
    const assigneeParam = url.searchParams.get("assignee");
    const assigneeFilter =
      assigneeParam === "me"
        ? { assigneeId: ctx.payload.sub }
        : assigneeParam
          ? { assigneeId: assigneeParam }
          : {};
    const milestoneParam = url.searchParams.get("milestone");
    const milestoneFilter =
      milestoneParam === null
        ? {}
        : milestoneParam === "null"
          ? { milestoneId: null }
          : { milestoneId: milestoneParam };
    const statusParam = url.searchParams.get("status");
    const statusFilter = statusParam ? { status: statusParam } : {};
    const priorityParam = url.searchParams.get("priority");
    const priorityFilter = priorityParam ? { priority: priorityParam } : {};
    const labelParam = url.searchParams.get("label");
    const labelFilter = labelParam
      ? { labels: { some: { labelId: { in: labelParam.split(",").filter(Boolean) } } } }
      : {};
    const qParam = url.searchParams.get("q");
    const qFilter = qParam
      ? {
          OR: [
            { title: { contains: qParam, mode: "insensitive" as const } },
            { description: { contains: qParam, mode: "insensitive" as const } },
          ],
        }
      : {};

    const tasks = await runWithWorkspace(wid, (tx) =>
      tx.task.findMany({
        where: {
          workspaceId: wid,
          // 列表/看板只返回顶层任务；子任务由任务详情 children 关联获取
          parentId: null,
          ...assigneeFilter,
          ...milestoneFilter,
          ...statusFilter,
          ...priorityFilter,
          ...labelFilter,
          ...qFilter,
        },
        include: {
          assignee: { select: { id: true, name: true, email: true } },
          labels: { include: { label: { select: { id: true, name: true, color: true } } } },
          _count: { select: { comments: true, children: true } },
          // 子任务完成数（进度汇总 3/5 的分子）
          children: { where: { status: "done" }, select: { id: true } },
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        // 上限保护：看板场景单工作区任务量可控；游标分页列入 v2（见 API-DESIGN-GUIDE）
        take: 500,
      }),
    );

    // 展平 labels 形态 + 子任务进度（subtaskTotal/subtaskDone 替换 children 数组）
    const flattened = tasks.map((t) => ({
      ...t,
      labels: t.labels.map((tl) => tl.label),
      subtaskTotal: t._count.children,
      subtaskDone: t.children.length,
      children: undefined,
    }));

    return NextResponse.json({ code: 200, data: flattened });
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

        // 校验 milestoneId 属于当前工作区（防跨租户关联）
        if (validated.milestoneId) {
          const ms = await tx.milestone.findFirst({
            where: { id: validated.milestoneId, workspaceId: wid },
            select: { id: true },
          });
          if (!ms) return { invalidMilestone: true as const };
        }

        // 校验 labelIds 都属于当前工作区
        const labelIds = validated.labelIds ?? [];
        if (labelIds.length > 0) {
          const validLabels = await tx.label.findMany({
            where: { id: { in: labelIds }, workspaceId: wid },
            select: { id: true },
          });
          if (validLabels.length !== labelIds.length) {
            return { invalidLabel: true as const };
          }
        }

        // 校验 parentId：父任务必须同工作区存在，且父级本身不能是子任务（仅一层层级）
        if (validated.parentId) {
          const parent = await tx.task.findFirst({
            where: { id: validated.parentId, workspaceId: wid },
            select: { id: true, parentId: true },
          });
          if (!parent) return { invalidParent: "notFound" as const };
          if (parent.parentId) return { invalidParent: "nested" as const };
        }

        const maxOrder = await tx.task.aggregate({
          where: { workspaceId: wid },
          _max: { sortOrder: true },
        });
        const created = await tx.task.create({
          data: {
            title: validated.title,
            description: validated.description,
            status: validated.status,
            priority: validated.priority,
            assigneeId: validated.assigneeId,
            dueDate: validated.dueDate ? new Date(validated.dueDate) : undefined,
            milestoneId: validated.milestoneId ?? undefined,
            parentId: validated.parentId ?? undefined,
            blocked: validated.blocked ?? false,
            blockedReason: validated.blockedReason ?? undefined,
            workspaceId: wid,
            createdBy: ctx.payload.sub,
            sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
            // 多对多关联：通过 TaskLabel 关联表写入
            ...(labelIds.length > 0
              ? { labels: { create: labelIds.map((labelId) => ({ labelId })) } }
              : {}),
          },
          include: {
            assignee: { select: { id: true, name: true, email: true } },
            labels: { include: { label: { select: { id: true, name: true, color: true } } } },
          },
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
          invalidMilestone: false as const,
          invalidLabel: false as const,
          invalidParent: false as const,
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
    if (task.invalidMilestone) {
      return NextResponse.json({ code: 400, message: "里程碑不存在" }, { status: 400 });
    }
    if (task.invalidLabel) {
      return NextResponse.json({ code: 400, message: "标签不存在" }, { status: 400 });
    }
    if (task.invalidParent === "notFound") {
      return NextResponse.json({ code: 400, message: "父任务不存在" }, { status: 400 });
    }
    if (task.invalidParent === "nested") {
      return NextResponse.json(
        { code: 400, message: "仅支持一层子任务（父级本身不能是子任务）" },
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

    // 任务指派邮件通知（他派且邮件已配置时发送，失败不阻塞）
    if (validated.assigneeId && !selfAssigned && task.task.assignee?.email) {
      try {
        // workspaces 受 FORCE RLS：加固模式下裸查恒返 null，邮件会被静默跳过，
        // 故经 runWithWorkspace 注入租户上下文取操作者/工作区名
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
          await notifyTaskAssigned({
            assigneeId: validated.assigneeId,
            assigneeName: task.task.assignee.name,
            assigneeEmail: task.task.assignee.email,
            assignerName: assigner.name ?? assigner.email,
            taskTitle: task.task.title,
            workspaceName: workspace.name,
            wid,
            taskId: task.task.id,
          });
        }
      } catch (err) {
        console.error("[tasks] post-create notify failed (non-blocking):", err);
      }
    }

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

    return NextResponse.json(
      {
        code: 201,
        data: {
          ...task.task,
          labels: task.task.labels.map((tl) => tl.label),
        },
      },
      { status: 201 },
    );
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

/**
 * 任务指派邮件通知（尽力而为，失败不阻塞主流程）。
 * 仅当：被指派人非操作者本人 + 邮件服务已配置 + 被指派人有邮箱时发送。
 */
async function notifyTaskAssigned(opts: {
  assigneeId: string;
  assigneeName: string | null;
  assigneeEmail: string;
  assignerName: string;
  taskTitle: string;
  workspaceName: string;
  wid: string;
  taskId: string;
}): Promise<void> {
  try {
    if (!isEmailConfigured()) return;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    await sendTaskAssignedEmail({
      to: opts.assigneeEmail,
      assigneeName: opts.assigneeName ?? opts.assigneeEmail,
      taskTitle: opts.taskTitle,
      workspaceName: opts.workspaceName,
      assignerName: opts.assignerName,
      taskUrl: `${appUrl}/w/${opts.wid}/task/${opts.taskId}`,
    });
  } catch (err) {
    console.error("[tasks] notifyTaskAssigned failed (non-blocking):", err);
  }
}
