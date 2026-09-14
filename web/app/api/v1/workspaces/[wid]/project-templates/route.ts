import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";
import { handlePrismaError } from "@/lib/prisma-error";

/**
 * 模板内单个任务项的结构（templateData.tasks[] 的元素）。
 * 保持与 Task 创建字段兼容：title 必填，description/priority 可选。
 */
const templateTaskItemSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(5000).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
});

/**
 * templateData JSON 结构：
 *  - tasks: 任务项数组（应用模板时批量创建 Task）
 *  - labels: 标签名数组（仅元信息，应用时不自动建标签，避免与工作区标签冲突）
 *  - milestones: 里程碑名数组（仅元信息）
 */
const templateDataSchema = z.object({
  tasks: z.array(templateTaskItemSchema).default([]),
  labels: z.array(z.string()).default([]),
  milestones: z.array(z.string()).default([]),
});

/**
 * GET 列表 searchParams 校验：
 *  - category: 按分类精确过滤（可选）
 *  - page/limit: 分页（默认 1/50，上限 100）
 */
const listTemplatesQuerySchema = z.object({
  category: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/**
 * GET /v1/workspaces/{wid}/project-templates — 项目模板列表
 * Query: ?category=<分类>（精确过滤） ?page=?limit=（分页）
 * 返回按 updatedAt 倒序，附带分页元信息。
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const url = new URL(req.url);
    const parsed = listTemplatesQuerySchema.safeParse({
      category: url.searchParams.get("category") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        {
          code: 400,
          message: apiMsg(req, "validationFailed"),
          errors: parsed.error.errors,
          data: null,
        },
        { status: 400 },
      );
    }
    const { category, page, limit } = parsed.data;
    const skip = (page - 1) * limit;

    const where = {
      workspaceId: wid,
      ...(category ? { category } : {}),
    };

    const [items, total] = await runWithWorkspace(wid, (tx) =>
      Promise.all([
        tx.projectTemplate.findMany({
          where,
          select: {
            id: true,
            name: true,
            description: true,
            category: true,
            templateData: true,
            isPublic: true,
            createdBy: true,
            createdAt: true,
            updatedAt: true,
            creator: { select: { id: true, name: true, email: true } },
          },
          orderBy: [{ updatedAt: "desc" }],
          skip,
          take: limit,
        }),
        tx.projectTemplate.count({ where }),
      ]),
    );

    // 展平：附 taskCount 便于列表展示
    const flattened = items.map((t) => {
      const data = t.templateData as { tasks?: unknown[] };
      const taskCount = Array.isArray(data?.tasks) ? data.tasks.length : 0;
      return { ...t, taskCount };
    });

    return NextResponse.json({
      code: 200,
      data: { items: flattened, page, limit, total, hasMore: page * limit < total },
    });
  } catch (error) {
    console.error("[GET project-templates] error:", error);
    return handlePrismaError(error, req);
  }
}

/**
 * POST /v1/workspaces/{wid}/project-templates — 新建项目模板
 * Body: { name, templateData, description?, category?, isPublic? }
 */
const createTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  category: z.string().max(100).optional(),
  templateData: templateDataSchema,
  isPublic: z.boolean().default(false),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const body = await req.json();
    const validated = createTemplateSchema.parse(body);

    const created = await runWithWorkspace(
      wid,
      (tx) =>
        tx.projectTemplate.create({
          data: {
            workspaceId: wid,
            name: validated.name,
            description: validated.description,
            category: validated.category,
            templateData: validated.templateData as object,
            isPublic: validated.isPublic,
            createdBy: ctx.payload.sub,
          },
          include: {
            creator: { select: { id: true, name: true, email: true } },
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 201, data: created }, { status: 201 });
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
    console.error("[POST project-template] error:", error);
    return handlePrismaError(error, req);
  }
}