import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";
import { handlePrismaError } from "@/lib/prisma-error";

/**
 * POST /v1/workspaces/{wid}/project-templates/{tid}/apply — 从模板创建任务集
 *
 * 读取 templateData.tasks，在单个事务中批量创建 Task 记录。
 * 可选 body: { milestoneId?, assigneeId? } —— 应用到所有生成的任务。
 *
 * 返回: { count, taskIds: string[] }
 */

/** 模板内任务项结构（与创建路由一致，用于运行时校验读取到的 JSON） */
const templateTaskItemSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(5000).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
});

const applyTemplateSchema = z.object({
  milestoneId: z.string().uuid().nullable().optional(),
  assigneeId: z.string().uuid().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; tid: string }> },
) {
  const { wid, tid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const body = await req.json().catch(() => ({}));
    const validated = applyTemplateSchema.parse(body);

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        // 1. 读取模板并校验归属
        const tpl = await tx.projectTemplate.findUnique({
          where: { id: tid },
          select: { workspaceId: true, templateData: true },
        });
        if (!tpl || tpl.workspaceId !== wid) {
          return { notFound: true as const, count: 0, taskIds: [] as string[] };
        }

        // 2. 解析 templateData.tasks（运行时再校验，防 DB 中 JSON 被外部篡改）
        const rawData = tpl.templateData as { tasks?: unknown[] };
        const tasksParse = z.array(templateTaskItemSchema).safeParse(rawData?.tasks ?? []);
        if (!tasksParse.success) {
          return { invalidTemplate: true as const, count: 0, taskIds: [] as string[] };
        }
        const tasks = tasksParse.data;
        if (tasks.length === 0) {
          return { empty: true as const, count: 0, taskIds: [] as string[] };
        }

        // 3. 校验 milestoneId 属于当前工作区（防跨租户关联）
        if (validated.milestoneId) {
          const ms = await tx.milestone.findFirst({
            where: { id: validated.milestoneId, workspaceId: wid },
            select: { id: true },
          });
          if (!ms) return { invalidMilestone: true as const, count: 0, taskIds: [] as string[] };
        }

        // 4. 校验 assigneeId 是当前工作区成员
        if (validated.assigneeId) {
          const member = await tx.member.findUnique({
            where: { userId_workspaceId: { userId: validated.assigneeId, workspaceId: wid } },
            select: { userId: true },
          });
          if (!member) return { invalidAssignee: true as const, count: 0, taskIds: [] as string[] };
        }

        // 5. 取当前最大 sortOrder，保证新任务排在末尾
        const maxOrder = await tx.task.aggregate({
          where: { workspaceId: wid },
          _max: { sortOrder: true },
        });
        let nextOrder = (maxOrder._max.sortOrder ?? -1) + 1;

        // 6. 批量创建任务（顺序创建以保证 sortOrder 递增；事务保证原子性）
        const createdIds: string[] = [];
        for (const task of tasks) {
          const created = await tx.task.create({
            data: {
              workspaceId: wid,
              title: task.title,
              description: task.description,
              status: "todo",
              priority: task.priority,
              assigneeId: validated.assigneeId,
              milestoneId: validated.milestoneId ?? undefined,
              createdBy: ctx.payload.sub,
              sortOrder: nextOrder,
            },
            select: { id: true },
          });
          createdIds.push(created.id);
          nextOrder += 1;
        }

        return {
          notFound: false as const,
          invalidTemplate: false as const,
          empty: false as const,
          invalidMilestone: false as const,
          invalidAssignee: false as const,
          count: createdIds.length,
          taskIds: createdIds,
        };
      },
      ctx.payload.sub,
    );

    if (result.notFound) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "templateNotFound"), data: null },
        { status: 404 },
      );
    }
    if (result.invalidTemplate) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "validationFailed"), data: null },
        { status: 400 },
      );
    }
    if (result.empty) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "templateEmpty"), data: null },
        { status: 400 },
      );
    }
    if (result.invalidMilestone) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "milestoneNotFound"), data: null },
        { status: 400 },
      );
    }
    if (result.invalidAssignee) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "assigneeNotMember"), data: null },
        { status: 400 },
      );
    }

    return NextResponse.json({
      code: 201,
      data: { count: result.count, taskIds: result.taskIds },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          code: 400,
          message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"),
          data: null,
          errors: error.errors,
        },
        { status: 400 },
      );
    }
    console.error("[POST project-template apply] error:", error);
    return handlePrismaError(error, req);
  }
}
