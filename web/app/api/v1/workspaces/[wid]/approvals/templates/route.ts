import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";
import type { Prisma } from "@prisma/client";
import { getBuiltinTemplates } from "@/lib/approval/builtin-templates";

/** 审批节点配置 schema（模板与实例共用） */
const approvalNodeSchema = z.object({
  approverRole: z.string().optional(),
  approverUserId: z.string().optional(),
  name: z.string().min(1).max(200),
  order: z.number().int().min(0),
  // M1: 审批模式
  mode: z.enum(["sequential", "parallel", "countersign"]).optional(),
  /** countersign 模式下需要通过的最少审批人数 */
  requiredCount: z.number().int().min(1).optional(),
});

/** GET 列表 query 校验 */
const listTemplatesQuerySchema = z.object({
  includeInactive: z.literal("1").optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  // M3: pageSize 作为 limit 的别名，支持 { items, total, page, pageSize } 分页结构
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  // 分类筛选：leave | expense | purchase | contract | hr
  category: z.string().optional(),
});

/** POST 创建模板 body 校验 */
const createTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  nodes: z.array(approvalNodeSchema).min(1),
});

/** POST init-builtin body 校验 */
const initBuiltinSchema = z.object({
  action: z.literal("init-builtin"),
});

/**
 * GET /v1/workspaces/{wid}/approvals/templates — 审批模板列表
 * Query: ?includeInactive=1（包含已停用模板）?page=1&limit=20
 *        ?category=leave（按分类筛选：leave/expense/purchase/contract/hr）
 * 默认仅返回 active=true 的模板，按 createdAt 倒序
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
      includeInactive: url.searchParams.get("includeInactive") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      category: url.searchParams.get("category") ?? undefined,
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
    // M3: pageSize 优先于 limit，支持 { items, total, page, pageSize } 分页结构
    const { includeInactive, page, category } = parsed.data;
    const limit = parsed.data.pageSize ?? parsed.data.limit;
    const skip = (page - 1) * limit;

    const where = {
      workspaceId: wid,
      ...(includeInactive !== "1" ? { active: true } : {}),
      ...(category ? { category } : {}),
    };

    const [items, total] = await runWithWorkspace(wid, (tx) =>
      Promise.all([
        tx.approvalTemplate.findMany({
          where,
          orderBy: [{ createdAt: "desc" }],
          skip,
          take: limit,
        }),
        tx.approvalTemplate.count({ where }),
      ]),
    );

    return NextResponse.json({
      code: 200,
      // M3: 返回 { items, total, page, pageSize } 分页结构（保留 limit 向后兼容）
      data: { items, page, limit, pageSize: limit, total, hasMore: page * limit < total },
    });
  } catch (error) {
    console.error("[GET approval-templates] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * POST /v1/workspaces/{wid}/approvals/templates — 创建审批模板
 * Body: { name, description?, nodes: [{ approverRole?, approverUserId?, name, order }] }
 *       { action: "init-builtin" } — 初始化内置模板
 * createdBy 设为当前用户，返回 { code: 201, data: template }
 */
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

    // 内置模板初始化分支
    if (body?.action === "init-builtin") {
      const validated = initBuiltinSchema.parse(body);
      if (validated.action === "init-builtin") {
        const builtinTemplates = getBuiltinTemplates();

        const result = await runWithWorkspace(
          wid,
          async (tx) => {
            const created: { name: string; skipped: boolean }[] = [];

            for (const tpl of builtinTemplates) {
              // 按 name + workspaceId 去重，已存在的跳过
              const existing = await tx.approvalTemplate.findFirst({
                where: { workspaceId: wid, name: tpl.name },
              });

              if (existing) {
                created.push({ name: tpl.name, skipped: true });
                continue;
              }

              await tx.approvalTemplate.create({
                data: {
                  workspaceId: wid,
                  name: tpl.name,
                  description: tpl.description,
                  nodes: tpl.nodes as unknown as Prisma.InputJsonValue,
                  formSchema: tpl.formSchema as unknown as Prisma.InputJsonValue,
                  icon: tpl.icon,
                  category: tpl.category,
                  flowType: tpl.flowType,
                  isBuiltin: true,
                  createdBy: ctx.payload.sub,
                },
              });
              created.push({ name: tpl.name, skipped: false });
            }

            return created;
          },
          ctx.payload.sub,
        );

        const createdCount = result.filter((r) => !r.skipped).length;
        const skippedCount = result.filter((r) => r.skipped).length;

        return NextResponse.json(
          {
            code: 201,
            data: { created: createdCount, skipped: skippedCount, details: result },
            message: `内置模板初始化完成：新增 ${createdCount} 个，跳过 ${skippedCount} 个已存在模板`,
          },
          { status: 201 },
        );
      }
    }

    // 常规创建模板分支
    const validated = createTemplateSchema.parse(body);

    const template = await runWithWorkspace(
      wid,
      (tx) =>
        tx.approvalTemplate.create({
          data: {
            workspaceId: wid,
            name: validated.name,
            description: validated.description,
            nodes: validated.nodes as unknown as Prisma.InputJsonValue,
            createdBy: ctx.payload.sub,
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 201, data: template }, { status: 201 });
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
    console.error("[POST approval-template] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
