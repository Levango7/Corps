import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { apiMsg } from "@/lib/api-messages";

/**
 * 多维表格字段详情 API · /api/v1/workspaces/{wid}/databases/{dbid}/fields/{fid}
 *
 * - PATCH：更新字段（仅 owner/admin）
 * - DELETE：删除字段（仅 owner/admin）
 */

const updateFieldSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  type: z.string().min(1).max(20).optional(),
  options: z.record(z.unknown()).optional(),
  sortOrder: z.number().optional(),
});

/** PATCH /v1/workspaces/{wid}/databases/{dbid}/fields/{fid} — 更新字段（仅 owner/admin） */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; dbid: string; fid: string }> },
) {
  const { wid, dbid, fid } = await params;
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
    const validated = updateFieldSchema.parse(await req.json());

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        // 校验字段存在且属于该工作区的该表格
        const existing = await tx.databaseField.findFirst({
          where: { id: fid, databaseId: dbid, database: { workspaceId: wid } },
          select: { id: true },
        });
        if (!existing) return { kind: "notFound" as const, data: null };

        const data: {
          name?: string;
          type?: string;
          options?: Prisma.InputJsonValue;
          sortOrder?: number;
        } = {};
        if (validated.name !== undefined) data.name = validated.name;
        if (validated.type !== undefined) data.type = validated.type;
        if (validated.options !== undefined)
          data.options = validated.options as Prisma.InputJsonValue;
        if (validated.sortOrder !== undefined) data.sortOrder = validated.sortOrder;

        const updated = await tx.databaseField.update({ where: { id: fid }, data });
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
    return NextResponse.json({ code: 200, data: result.data });
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
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "prismaRecordNotFound"), data: null },
        { status: 404 },
      );
    }
    console.error("[PATCH database field] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/** DELETE /v1/workspaces/{wid}/databases/{dbid}/fields/{fid} — 删除字段（仅 owner/admin） */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; dbid: string; fid: string }> },
) {
  const { wid, dbid, fid } = await params;
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
        const existing = await tx.databaseField.findFirst({
          where: { id: fid, databaseId: dbid, database: { workspaceId: wid } },
          select: { id: true },
        });
        if (!existing) return { kind: "notFound" as const };
        await tx.databaseField.delete({ where: { id: fid } });
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
    return NextResponse.json({ code: 200, data: { id: fid, deleted: true } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "prismaRecordNotFound"), data: null },
        { status: 404 },
      );
    }
    console.error("[DELETE database field] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}