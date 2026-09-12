import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { apiMsg } from "@/lib/api-messages";

/**
 * 多维表格记录详情 API · /api/v1/workspaces/{wid}/databases/{dbid}/records/{rid}
 *
 * - PATCH：更新记录数据（member 可写）
 * - DELETE：删除记录（member 可写）
 */

const updateRecordSchema = z.object({
  data: z.record(z.unknown()).optional(),
  sortOrder: z.number().optional(),
});

/** PATCH /v1/workspaces/{wid}/databases/{dbid}/records/{rid} — 更新记录（member 可写） */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; dbid: string; rid: string }> },
) {
  const { wid, dbid, rid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const validated = updateRecordSchema.parse(await req.json());

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        // 校验记录存在且属于该工作区的该表格
        const existing = await tx.databaseRecord.findFirst({
          where: { id: rid, databaseId: dbid, database: { workspaceId: wid } },
          select: { id: true },
        });
        if (!existing) return { kind: "notFound" as const, data: null };

        const data: {
          data?: Prisma.InputJsonValue;
          sortOrder?: number;
        } = {};
        if (validated.data !== undefined)
          data.data = validated.data as Prisma.InputJsonValue;
        if (validated.sortOrder !== undefined) data.sortOrder = validated.sortOrder;

        const updated = await tx.databaseRecord.update({ where: { id: rid }, data });
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
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "prismaRecordNotFound"), data: null },
        { status: 404 },
      );
    }
    console.error("[PATCH database record] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/** DELETE /v1/workspaces/{wid}/databases/{dbid}/records/{rid} — 删除记录（member 可写） */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; dbid: string; rid: string }> },
) {
  const { wid, dbid, rid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        const existing = await tx.databaseRecord.findFirst({
          where: { id: rid, databaseId: dbid, database: { workspaceId: wid } },
          select: { id: true },
        });
        if (!existing) return { kind: "notFound" as const };
        await tx.databaseRecord.delete({ where: { id: rid } });
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
    return NextResponse.json({ code: 0, data: { id: rid, deleted: true } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "prismaRecordNotFound"), data: null },
        { status: 404 },
      );
    }
    console.error("[DELETE database record] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}