import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";

/**
 * 多维表格 API · /api/v1/workspaces/{wid}/databases
 * Phase 3A — Notion 式 Database 数据模型
 *
 * - GET：列出工作区多维表格（支持 spaceId/folderId 筛选 + 分页）
 * - POST：创建多维表格（仅 owner/admin）
 */

/** GET /v1/workspaces/{wid}/databases — 列出工作区多维表格 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string }> },
) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const url = new URL(req.url);
    const parsed = listDatabasesQuerySchema.safeParse({
      spaceId: url.searchParams.get("spaceId") ?? undefined,
      folderId: url.searchParams.get("folderId") ?? undefined,
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
    const { spaceId, folderId, page, limit } = parsed.data;
    const skip = (page - 1) * limit;

    // 构建筛选条件：spaceId/folderId 精确匹配（null 表示未分类）
    const where: {
      workspaceId: string;
      spaceId?: string | null;
      folderId?: string | null;
    } = { workspaceId: wid };
    if (spaceId !== undefined) where.spaceId = spaceId;
    if (folderId !== undefined) where.folderId = folderId;

    const [items, total] = await runWithWorkspace(
      wid,
      (tx) =>
        Promise.all([
          tx.database.findMany({
            where,
            orderBy: { sortOrder: "asc" },
            skip,
            take: limit,
          }),
          tx.database.count({ where }),
        ]),
      ctx.payload.sub,
    );

    return NextResponse.json({
      code: 0,
      data: { items, page, limit, total, hasMore: page * limit < total },
    });
  } catch (error) {
    console.error("[GET databases] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/** 列表 query 参数校验 */
const listDatabasesQuerySchema = z.object({
  spaceId: z.string().uuid().optional(),
  folderId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const createDatabaseSchema = z.object({
  title: z.string().min(1).max(255),
  spaceId: z.string().uuid().nullable().optional(),
  folderId: z.string().uuid().nullable().optional(),
  icon: z.string().max(50).optional(),
  emoji: z.string().max(10).nullable().optional(),
  description: z.string().nullable().optional(),
  sortOrder: z.number().optional(),
});

/** POST /v1/workspaces/{wid}/databases — 创建多维表格（仅 owner/admin） */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string }> },
) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  // 权限：仅 owner/admin 可创建多维表格
  if (!["owner", "admin"].includes(ctx.member.role)) {
    return NextResponse.json(
      { code: 403, message: apiMsg(req, "noPermission"), data: null },
      { status: 403 },
    );
  }

  try {
    const validated = createDatabaseSchema.parse(await req.json());

    const database = await runWithWorkspace(
      wid,
      (tx) =>
        tx.database.create({
          data: {
            workspaceId: wid,
            title: validated.title,
            spaceId: validated.spaceId ?? null,
            folderId: validated.folderId ?? null,
            icon: validated.icon ?? "table",
            emoji: validated.emoji ?? null,
            description: validated.description ?? null,
            sortOrder: validated.sortOrder ?? 0,
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 0, data: database }, { status: 201 });
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
    // P2003：外键约束冲突（spaceId/folderId 不属于该工作区）
    if ((error as { code?: string }).code === "P2003") {
      return NextResponse.json(
        { code: 409, message: apiMsg(req, "prismaForeignKeyViolation"), data: null },
        { status: 409 },
      );
    }
    console.error("[POST database] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}