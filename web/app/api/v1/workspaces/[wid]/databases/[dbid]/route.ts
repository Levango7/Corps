import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { apiMsg } from "@/lib/api-messages";

/**
 * 多维表格详情 API · /api/v1/workspaces/{wid}/databases/{dbid}
 *
 * - GET：获取多维表格详情（含字段、视图）
 * - PATCH：更新多维表格元数据（仅 owner/admin）
 * - DELETE：删除多维表格（仅 owner/admin，级联删除字段/记录/视图）
 */

/** GET /v1/workspaces/{wid}/databases/{dbid} — 获取多维表格详情 */
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
    const database = await runWithWorkspace(
      wid,
      (tx) =>
        tx.database.findFirst({
          where: { id: dbid, workspaceId: wid },
          include: {
            fields: { orderBy: { sortOrder: "asc" } },
            views: { orderBy: { sortOrder: "asc" } },
          },
        }),
      ctx.payload.sub,
    );

    if (!database) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "prismaRecordNotFound"), data: null },
        { status: 404 },
      );
    }
    return NextResponse.json({ code: 0, data: database });
  } catch (error) {
    console.error("[GET database] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

const updateDatabaseSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  spaceId: z.string().uuid().nullable().optional(),
  folderId: z.string().uuid().nullable().optional(),
  icon: z.string().max(50).optional(),
  emoji: z.string().max(10).nullable().optional(),
  description: z.string().nullable().optional(),
  sortOrder: z.number().optional(),
});

/** PATCH /v1/workspaces/{wid}/databases/{dbid} — 更新多维表格元数据（仅 owner/admin） */
export async function PATCH(
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
  if (!["owner", "admin"].includes(ctx.member.role)) {
    return NextResponse.json(
      { code: 403, message: apiMsg(req, "noPermission"), data: null },
      { status: 403 },
    );
  }

  try {
    const validated = updateDatabaseSchema.parse(await req.json());

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        const existing = await tx.database.findFirst({
          where: { id: dbid, workspaceId: wid },
          select: { id: true },
        });
        if (!existing) return { kind: "notFound" as const, data: null };

        const data: {
          title?: string;
          spaceId?: string | null;
          folderId?: string | null;
          icon?: string;
          emoji?: string | null;
          description?: string | null;
          sortOrder?: number;
        } = {};
        if (validated.title !== undefined) data.title = validated.title;
        if (validated.spaceId !== undefined) data.spaceId = validated.spaceId;
        if (validated.folderId !== undefined) data.folderId = validated.folderId;
        if (validated.icon !== undefined) data.icon = validated.icon;
        if (validated.emoji !== undefined) data.emoji = validated.emoji;
        if (validated.description !== undefined)
          data.description = validated.description;
        if (validated.sortOrder !== undefined) data.sortOrder = validated.sortOrder;

        const updated = await tx.database.update({ where: { id: dbid }, data });
        return { kind: "ok" as const, data: updated };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "prismaRecordNotFound"), data: null },
        { status: 404 },
      );
    }
    return NextResponse.json({ code: 0, data: result.data });
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
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // P2025：记录不存在（并发删除）→ 404
      if (error.code === "P2025") {
        return NextResponse.json(
          { code: 404, message: apiMsg(req, "prismaRecordNotFound"), data: null },
          { status: 404 },
        );
      }
      // P2003：外键约束冲突 → 409
      if (error.code === "P2003") {
        return NextResponse.json(
          { code: 409, message: apiMsg(req, "prismaForeignKeyViolation"), data: null },
          { status: 409 },
        );
      }
    }
    console.error("[PATCH database] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/** DELETE /v1/workspaces/{wid}/databases/{dbid} — 删除多维表格（仅 owner/admin）
 *  级联删除：字段、记录、视图（schema onDelete: Cascade）
 */
export async function DELETE(
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
  if (!["owner", "admin"].includes(ctx.member.role)) {
    return NextResponse.json(
      { code: 403, message: apiMsg(req, "noPermission"), data: null },
      { status: 403 },
    );
  }

  try {
    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        const existing = await tx.database.findFirst({
          where: { id: dbid, workspaceId: wid },
          select: { id: true },
        });
        if (!existing) return { kind: "notFound" as const };
        await tx.database.delete({ where: { id: dbid } });
        return { kind: "ok" as const };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "prismaRecordNotFound"), data: null },
        { status: 404 },
      );
    }
    return NextResponse.json({ code: 0, data: { id: dbid, deleted: true } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return NextResponse.json(
          { code: 404, message: apiMsg(req, "prismaRecordNotFound"), data: null },
          { status: 404 },
        );
      }
    }
    console.error("[DELETE database] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}