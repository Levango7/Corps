import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContextV2, runWithWorkspace } from "@/lib/auth";
import { authFailure } from "@/lib/auth-response";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { apiMsg } from "@/lib/api-messages";

/**
 * 多维表格字段 API · /api/v1/workspaces/{wid}/databases/{dbid}/fields
 *
 * - GET：列出多维表格所有字段（按 sortOrder 排序）
 * - POST：创建字段（仅 owner/admin）
 */

/** GET /v1/workspaces/{wid}/databases/{dbid}/fields — 列出字段 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; dbid: string }> },
) {
  const { wid, dbid } = await params;
  const ctx = await getWorkspaceContextV2(req, wid);
  if (!ctx)
    // V2 契约上从不返回 null（见 lib/auth.ts 的 WorkspaceContextV2 文档：
    // "调用方遇到 null 应按 500 处理（fail-closed，不可当作 401 重试）"）。
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  if (!ctx.ok) return authFailure(ctx, req);

  try {
    const url = new URL(req.url);
    const paginationSchema = z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(50),
    });
    const { page, pageSize } = paginationSchema.parse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
    });
    const take = pageSize;
    const skip = (page - 1) * pageSize;

    // 先校验 database 存在且属于该工作区
    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        const db = await tx.database.findFirst({
          where: { id: dbid, workspaceId: wid },
          select: { id: true },
        });
        if (!db) return { kind: "notFound" as const, data: null };
        const [fields, total] = await Promise.all([
          tx.databaseField.findMany({
            where: { databaseId: dbid },
            orderBy: { sortOrder: "asc" },
            take,
            skip,
          }),
          tx.databaseField.count({ where: { databaseId: dbid } }),
        ]);
        return {
          kind: "ok" as const,
          data: { items: fields, total, hasMore: skip + take < total },
        };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "prismaRecordNotFound"), data: null },
        { status: 404 },
      );
    }
    return NextResponse.json({ code: 200, data: result.data });
  } catch (error) {
    console.error("[GET database fields] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

const createFieldSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.string().min(1).max(20),
  options: z.record(z.unknown()).optional(),
  sortOrder: z.number().optional(),
});

/** POST /v1/workspaces/{wid}/databases/{dbid}/fields — 创建字段（仅 owner/admin） */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; dbid: string }> },
) {
  const { wid, dbid } = await params;
  const ctx = await getWorkspaceContextV2(req, wid);
  if (!ctx)
    // V2 契约上从不返回 null（见 lib/auth.ts 的 WorkspaceContextV2 文档：
    // "调用方遇到 null 应按 500 处理（fail-closed，不可当作 401 重试）"）。
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  if (!ctx.ok) return authFailure(ctx, req);
  if (!["owner", "admin"].includes(ctx.member.role)) {
    return NextResponse.json(
      { code: 403, message: apiMsg(req, "noPermission"), data: null },
      { status: 403 },
    );
  }

  try {
    const validated = createFieldSchema.parse(await req.json());

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        // 校验 database 存在且属于该工作区
        const db = await tx.database.findFirst({
          where: { id: dbid, workspaceId: wid },
          select: { id: true },
        });
        if (!db) return { kind: "notFound" as const, data: null };

        const field = await tx.databaseField.create({
          data: {
            databaseId: dbid,
            name: validated.name,
            type: validated.type,
            options: (validated.options ?? {}) as Prisma.InputJsonValue,
            sortOrder: validated.sortOrder ?? 0,
          },
        });
        return { kind: "ok" as const, data: field };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "prismaRecordNotFound"), data: null },
        { status: 404 },
      );
    }
    return NextResponse.json({ code: 201, data: result.data }, { status: 201 });
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
    // P2003：外键约束冲突（databaseId 不存在）
    if ((error as { code?: string }).code === "P2003") {
      return NextResponse.json(
        { code: 409, message: apiMsg(req, "prismaForeignKeyViolation"), data: null },
        { status: 409 },
      );
    }
    console.error("[POST database field] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
