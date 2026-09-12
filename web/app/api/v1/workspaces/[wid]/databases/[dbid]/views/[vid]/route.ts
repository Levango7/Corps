import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { apiMsg } from "@/lib/api-messages";

/**
 * 多维表格视图详情 API · /api/v1/workspaces/{wid}/databases/{dbid}/views/{vid}
 *
 * - PATCH：更新视图（仅 owner/admin）
 * - DELETE：删除视图（仅 owner/admin）
 */

const updateViewSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  type: z.string().min(1).max(20).optional(),
  config: z.record(z.unknown()).optional(),
  sortOrder: z.number().optional(),
});

/** PATCH /v1/workspaces/{wid}/databases/{dbid}/views/{vid} — 更新视图（仅 owner/admin） */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; dbid: string; vid: string }> },
) {
  const { wid, dbid, vid } = await params;
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
    const validated = updateViewSchema.parse(await req.json());

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        const existing = await tx.databaseView.findFirst({
          where: { id: vid, databaseId: dbid, database: { workspaceId: wid } },
          select: { id: true },
        });
        if (!existing) return { kind: "notFound" as const, data: null };

        const data: {
          name?: string;
          type?: string;
          config?: Prisma.InputJsonValue;
          sortOrder?: number;
        } = {};
        if (validated.name !== undefined) data.name = validated.name;
        if (validated.type !== undefined) data.type = validated.type;
        if (validated.config !== undefined)
          data.config = validated.config as Prisma.InputJsonValue;
        if (validated.sortOrder !== undefined) data.sortOrder = validated.sortOrder;

        const updated = await tx.databaseView.update({ where: { id: vid }, data });
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
    console.error("[PATCH database view] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/** DELETE /v1/workspaces/{wid}/databases/{dbid}/views/{vid} — 删除视图（仅 owner/admin） */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; dbid: string; vid: string }> },
) {
  const { wid, dbid, vid } = await params;
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
        const existing = await tx.databaseView.findFirst({
          where: { id: vid, databaseId: dbid, database: { workspaceId: wid } },
          select: { id: true },
        });
        if (!existing) return { kind: "notFound" as const };
        await tx.databaseView.delete({ where: { id: vid } });
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
    return NextResponse.json({ code: 200, data: { id: vid, deleted: true } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "prismaRecordNotFound"), data: null },
        { status: 404 },
      );
    }
    console.error("[DELETE database view] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}