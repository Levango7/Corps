import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";

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
});

/** POST 创建模板 body 校验 */
const createTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  nodes: z.array(approvalNodeSchema).min(1),
});

/**
 * GET /v1/workspaces/{wid}/approvals/templates — 审批模板列表
 * Query: ?includeInactive=1（包含已停用模板）?page=1&limit=20
 * 默认仅返回 active=true 的模板，按 createdAt 倒序
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const url = new URL(req.url);
    const parsed = listTemplatesQuerySchema.safeParse({
      includeInactive: url.searchParams.get("includeInactive") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "validationFailed"), errors: parsed.error.errors, data: null },
        { status: 400 },
      );
    }
    // M3: pageSize 优先于 limit，支持 { items, total, page, pageSize } 分页结构
    const { includeInactive, page } = parsed.data;
    const limit = parsed.data.pageSize ?? parsed.data.limit;
    const skip = (page - 1) * limit;

    const where = {
      workspaceId: wid,
      ...(includeInactive !== "1" ? { active: true } : {}),
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
 * createdBy 设为当前用户，返回 { code: 201, data: template }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const body = await req.json();
    const validated = createTemplateSchema.parse(body);

    const template = await runWithWorkspace(
      wid,
      (tx) =>
        tx.approvalTemplate.create({
          data: {
            workspaceId: wid,
            name: validated.name,
            description: validated.description,
            nodes: validated.nodes,
            createdBy: ctx.payload.sub,
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 201, data: template }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"), data: null, errors: error.errors },
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