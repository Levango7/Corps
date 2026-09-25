import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { apiMsg } from "@/lib/api-messages";
import { requirePermission } from "@/lib/permissions";

/**
 * GET /v1/workspaces/{wid}/announcements — 公告列表
 * Query: ?type=info|warning|urgent（按类型过滤）
 *        ?pinned=true|false（按置顶过滤）
 *        ?page=&limit=（分页，默认 page=1 limit=50）
 * 按 pinned DESC + publishedAt DESC 排序（置顶优先，再按发布时间倒序）
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
    const parsed = listQuerySchema.safeParse({
      type: url.searchParams.get("type") ?? undefined,
      pinned: url.searchParams.get("pinned") ?? undefined,
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
    const { page, limit } = parsed.data;
    const skip = (page - 1) * limit;

    const where: Prisma.AnnouncementWhereInput = { workspaceId: wid };
    if (parsed.data.type) where.type = parsed.data.type;
    if (parsed.data.pinned !== undefined) where.pinned = parsed.data.pinned === "true";

    const [items, total] = await runWithWorkspace(wid, (tx) =>
      Promise.all([
        tx.announcement.findMany({
          where,
          select: {
            id: true,
            title: true,
            content: true,
            type: true,
            targetAudience: true,
            pinned: true,
            publishedBy: true,
            publishedAt: true,
            expiresAt: true,
            createdAt: true,
            updatedAt: true,
            publisher: { select: { id: true, name: true, email: true } },
          },
          orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }],
          skip,
          take: limit,
        }),
        tx.announcement.count({ where }),
      ]),
    );

    return NextResponse.json({
      code: 200,
      data: { items, page, limit, total, hasMore: page * limit < total },
    });
  } catch (error) {
    console.error("[GET announcements] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/** 列表查询参数校验 */
const listQuerySchema = z.object({
  type: z.enum(["info", "warning", "urgent"]).optional(),
  pinned: z.union([z.literal("true"), z.literal("false")]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** 目标受众 schema：{ type: "all"|"role"|"department", value?: string[] } */
const targetAudienceSchema = z.object({
  type: z.enum(["all", "role", "department"]),
  value: z.array(z.string()).optional(),
});

/** POST /v1/workspaces/{wid}/announcements — 创建公告 */
const createSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  type: z.enum(["info", "warning", "urgent"]).optional(),
  targetAudience: targetAudienceSchema.optional(),
  pinned: z.boolean().optional(),
  expiresAt: z.union([z.string().datetime(), z.null()]).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  const denied = await requirePermission(ctx, "announcements", "create", req);
  if (denied) return denied;

  try {
    const body = await req.json();
    const validated = createSchema.parse(body);

    const announcement = await runWithWorkspace(
      wid,
      (tx) =>
        tx.announcement.create({
          data: {
            workspaceId: wid,
            title: validated.title,
            content: validated.content,
            type: validated.type ?? "info",
            targetAudience: (validated.targetAudience ?? { type: "all" }) as Prisma.InputJsonValue,
            pinned: validated.pinned ?? false,
            publishedBy: ctx.payload.sub,
            publishedAt: new Date(),
            expiresAt: validated.expiresAt ? new Date(validated.expiresAt) : null,
          },
          include: {
            publisher: { select: { id: true, name: true, email: true } },
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 201, data: announcement }, { status: 201 });
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
    console.error("[POST announcement] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
