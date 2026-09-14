import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { apiMsg } from "@/lib/api-messages";

/**
 * GET /v1/workspaces/{wid}/whiteboards/{wbid} — 白板详情（含完整 data）
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; wbid: string }> },
) {
  const { wid, wbid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const wb = await runWithWorkspace(wid, (tx) =>
      tx.whiteboard.findFirst({
        where: { id: wbid, workspaceId: wid },
        select: {
          id: true,
          title: true,
          data: true,
          createdBy: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    );

    if (!wb) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "whiteboardNotFound"), data: null },
        { status: 404 },
      );
    }
    return NextResponse.json({ code: 200, data: wb });
  } catch (error) {
    console.error("[GET whiteboard] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * PATCH 更新校验：title 和/或 data（data 为完整替换）
 * data 接受字符串（JSON）或数组对象，服务端统一存为 JsonB
 */
const updateWbSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  data: z.union([z.string(), z.array(z.any())]).optional(),
});

/** PATCH /v1/workspaces/{wid}/whiteboards/{wbid} — 更新白板标题和/或画布数据 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; wbid: string }> },
) {
  const { wid, wbid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const body = await req.json();
    const validated = updateWbSchema.parse(body);

    const updated = await runWithWorkspace(
      wid,
      async (tx) => {
        const existing = await tx.whiteboard.findFirst({
          where: { id: wbid, workspaceId: wid },
          select: { id: true },
        });
        if (!existing) return { kind: "notFound" as const };

        const data: { title?: string; data?: Prisma.InputJsonValue } = {};
        if (validated.title !== undefined) data.title = validated.title;
        if (validated.data !== undefined) {
          // data 列为 JsonB：字符串则 JSON.parse 为数组/对象，否则直接传入。完整替换语义。
          data.data = (
            typeof validated.data === "string" ? JSON.parse(validated.data) : validated.data
          ) as Prisma.InputJsonValue;
        }

        const wb = await tx.whiteboard.update({ where: { id: wbid }, data });
        return { kind: "ok" as const, wb };
      },
      ctx.payload.sub,
    );

    if (updated.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "whiteboardNotFound"), data: null },
        { status: 404 },
      );
    }
    return NextResponse.json({ code: 200, data: updated.wb });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"), data: null },
        { status: 400 },
      );
    }
    // P2025: 记录不存在（并发删除场景）→ 404
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "whiteboardNotFound"), data: null },
        { status: 404 },
      );
    }
    console.error("[PATCH whiteboard] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/** DELETE /v1/workspaces/{wid}/whiteboards/{wbid} — 删除白板 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; wbid: string }> },
) {
  const { wid, wbid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const deleted = await runWithWorkspace(
      wid,
      async (tx) => {
        const existing = await tx.whiteboard.findFirst({
          where: { id: wbid, workspaceId: wid },
          select: { id: true },
        });
        if (!existing) return { kind: "notFound" as const };
        await tx.whiteboard.delete({ where: { id: wbid } });
        return { kind: "ok" as const };
      },
      ctx.payload.sub,
    );

    if (deleted.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "whiteboardNotFound"), data: null },
        { status: 404 },
      );
    }
    return NextResponse.json({ code: 200, data: { id: wbid, deleted: true } });
  } catch (error) {
    console.error("[DELETE whiteboard] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}