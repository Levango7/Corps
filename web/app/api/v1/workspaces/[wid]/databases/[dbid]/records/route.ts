import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { apiMsg } from "@/lib/api-messages";

/**
 * 多维表格记录 API · /api/v1/workspaces/{wid}/databases/{dbid}/records
 *
 * - GET：列出记录（支持筛选/排序/分页，query params: page, limit, filters, sorts）
 * - POST：创建记录（member 可写）
 *
 * 筛选/排序说明：
 *  - filters：JSON 字符串，格式 [{ fieldId, op, value }]，op 支持 eq/ne/contains
 *    筛选在 data JSON 字段中按 fieldId 键匹配（PostgreSQL JSON 路径查询）
 *  - sorts：JSON 字符串，格式 [{ fieldId, dir }]，dir=asc/desc
 *    复杂排序逻辑由前端 query-engine 处理，API 仅支持 sortOrder 字段排序 + 单字段 data 排序
 */

/** GET /v1/workspaces/{wid}/databases/{dbid}/records — 列出记录（分页 + 筛选 + 排序） */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; dbid: string }> },
) {
  const { wid, dbid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const url = new URL(req.url);
    const parsed = listRecordsQuerySchema.safeParse({
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      filters: url.searchParams.get("filters") ?? undefined,
      sorts: url.searchParams.get("sorts") ?? undefined,
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
    const { page, limit, filters, sorts } = parsed.data;
    const skip = (page - 1) * limit;

    // 构建 Prisma where 条件：基于 data JSON 字段的路径筛选
    // filters 格式: [{ fieldId, op, value }]，op: eq/ne/contains
    // 使用 Prisma 的 JSON 路径过滤：data->>'fieldId' = value
    const prismaWhere: Prisma.DatabaseRecordWhereInput = {
      databaseId: dbid,
      database: { workspaceId: wid },
    };

    if (filters && filters.length > 0) {
      prismaWhere.AND = filters.map((f): Prisma.DatabaseRecordWhereInput => {
        // 使用 Prisma 的 path 过滤（PostgreSQL JSON 路径查询）
        // data->>'fieldId' op value
        const path = `$."${f.fieldId}"`;
        if (f.op === "eq") {
          return { data: { path, equals: f.value } } as Prisma.DatabaseRecordWhereInput;
        } else if (f.op === "ne") {
          return { NOT: { data: { path, equals: f.value } } } as Prisma.DatabaseRecordWhereInput;
        } else if (f.op === "contains") {
          return { data: { path, string_contains: f.value as string } } as Prisma.DatabaseRecordWhereInput;
        }
        return {};
      });
    }

    // 排序：优先使用 sorts 参数（单字段 data 排序），否则按 sortOrder
    // sorts 格式: [{ fieldId, dir }]
    let orderBy: Prisma.DatabaseRecordOrderByWithRelationInput | Prisma.DatabaseRecordOrderByWithRelationInput[];
    if (sorts && sorts.length > 0) {
      // 按 data JSON 字段排序（PostgreSQL JSON 路径）
      // Prisma 支持 orderBy: { data: { path: '$."fieldId"', sort: 'asc' } }
      orderBy = sorts.map((s) => ({
        data: { path: `$."${s.fieldId}"`, sort: s.dir },
      })) as unknown as Prisma.DatabaseRecordOrderByWithRelationInput[];
    } else {
      orderBy = { sortOrder: "asc" };
    }

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        // 先校验 database 存在且属于该工作区
        const db = await tx.database.findFirst({
          where: { id: dbid, workspaceId: wid },
          select: { id: true },
        });
        if (!db) return { kind: "notFound" as const, items: [], total: 0 };

        const [items, total] = await Promise.all([
          tx.databaseRecord.findMany({
            where: prismaWhere,
            orderBy,
            skip,
            take: limit,
          }),
          tx.databaseRecord.count({ where: prismaWhere }),
        ]);
        return { kind: "ok" as const, items, total };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "prismaRecordNotFound"), data: null },
        { status: 404 },
      );
    }
    return NextResponse.json({
      code: 0,
      data: {
        items: result.items,
        page,
        limit,
        total: result.total,
        hasMore: page * limit < result.total,
      },
    });
  } catch (error) {
    console.error("[GET database records] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/** 筛选条件项 */
const filterItemSchema = z.object({
  fieldId: z.string(),
  op: z.enum(["eq", "ne", "contains"]),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
});

/** 排序条件项 */
const sortItemSchema = z.object({
  fieldId: z.string(),
  dir: z.enum(["asc", "desc"]),
});

/** 列表 query 参数校验 */
const listRecordsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  // filters/sorts 为 JSON 字符串，解析后校验
  filters: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      const parsed = JSON.parse(val);
      return z.array(filterItemSchema).parse(parsed);
    }),
  sorts: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      const parsed = JSON.parse(val);
      return z.array(sortItemSchema).parse(parsed);
    }),
});

const createRecordSchema = z.object({
  data: z.record(z.unknown()).optional(),
  sortOrder: z.number().optional(),
});

/** POST /v1/workspaces/{wid}/databases/{dbid}/records — 创建记录（member 可写） */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; dbid: string }> },
) {
  const { wid, dbid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const validated = createRecordSchema.parse(await req.json());

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        // 校验 database 存在且属于该工作区
        const db = await tx.database.findFirst({
          where: { id: dbid, workspaceId: wid },
          select: { id: true },
        });
        if (!db) return { kind: "notFound" as const, data: null };

        const record = await tx.databaseRecord.create({
          data: {
            databaseId: dbid,
            data: (validated.data ?? {}) as Prisma.InputJsonValue,
            sortOrder: validated.sortOrder ?? 0,
          },
        });
        return { kind: "ok" as const, data: record };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "prismaRecordNotFound"), data: null },
        { status: 404 },
      );
    }
    return NextResponse.json({ code: 0, data: result.data }, { status: 201 });
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
    if ((error as { code?: string }).code === "P2003") {
      return NextResponse.json(
        { code: 409, message: apiMsg(req, "prismaForeignKeyViolation"), data: null },
        { status: 409 },
      );
    }
    console.error("[POST database record] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}