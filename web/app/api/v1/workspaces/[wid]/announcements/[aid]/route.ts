import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { apiMsg } from "@/lib/api-messages";

/**
 * GET /v1/workspaces/{wid}/announcements/{aid} — 公告详情
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; aid: string }> },
) {
  const { wid, aid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const announcement = await runWithWorkspace(wid, (tx) =>
      tx.announcement.findFirst({
        where: { id: aid, workspaceId: wid },
        include: {
          publisher: { select: { id: true, name: true, email: true } },
        },
      }),
    );

    if (!announcement) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "announcementNotFound"), data: null },
        { status: 404 },
      );
    }
    return NextResponse.json({ code: 200, data: announcement });
  } catch (error) {
    console.error("[GET announcement] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/** 目标受众 schema */
const targetAudienceSchema = z.object({
  type: z.enum(["all", "role", "department"]),
  value: z.array(z.string()).optional(),
});

/** PATCH /v1/workspaces/{wid}/announcements/{aid} — 更新公告 */
const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).optional(),
  type: z.enum(["info", "warning", "urgent"]).optional(),
  targetAudience: targetAudienceSchema.optional(),
  pinned: z.boolean().optional(),
  expiresAt: z.union([z.string().datetime(), z.null()]).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; aid: string }> },
) {
  const { wid, aid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const body = await req.json();
    const validated = updateSchema.parse(body);

    const updated = await runWithWorkspace(
      wid,
      async (tx) => {
        const existing = await tx.announcement.findFirst({
          where: { id: aid, workspaceId: wid },
          select: { id: true },
        });
        if (!existing) return { kind: "notFound" as const };

        const data: Prisma.AnnouncementUpdateInput = {};
        if (validated.title !== undefined) data.title = validated.title;
        if (validated.content !== undefined) data.content = validated.content;
        if (validated.type !== undefined) data.type = validated.type;
        if (validated.targetAudience !== undefined) {
          data.targetAudience = validated.targetAudience as Prisma.InputJsonValue;
        }
        if (validated.pinned !== undefined) data.pinned = validated.pinned;
        if (validated.expiresAt !== undefined) {
          data.expiresAt = validated.expiresAt ? new Date(validated.expiresAt) : null;
        }

        const announcement = await tx.announcement.update({
          where: { id: aid },
          data,
          include: {
            publisher: { select: { id: true, name: true, email: true } },
          },
        });
        return { kind: "ok" as const, announcement };
      },
      ctx.payload.sub,
    );

    if (updated.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "announcementNotFound"), data: null },
        { status: 404 },
      );
    }
    return NextResponse.json({ code: 200, data: updated.announcement });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          code: 400,
          message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"),
          data: null,
        },
        { status: 400 },
      );
    }
    // P2025: 记录不存在（并发删除场景）→ 404
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "announcementNotFound"), data: null },
        { status: 404 },
      );
    }
    console.error("[PATCH announcement] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/** DELETE /v1/workspaces/{wid}/announcements/{aid} — 删除公告 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; aid: string }> },
) {
  const { wid, aid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const deleted = await runWithWorkspace(
      wid,
      async (tx) => {
        const existing = await tx.announcement.findFirst({
          where: { id: aid, workspaceId: wid },
          select: { id: true },
        });
        if (!existing) return { kind: "notFound" as const };
        await tx.announcement.delete({ where: { id: aid } });
        return { kind: "ok" as const };
      },
      ctx.payload.sub,
    );

    if (deleted.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "announcementNotFound"), data: null },
        { status: 404 },
      );
    }
    return NextResponse.json({ code: 200, data: { id: aid, deleted: true } });
  } catch (error) {
    console.error("[DELETE announcement] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
