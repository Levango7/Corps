import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { apiMsg } from "@/lib/api-messages";

/**
 * GET /v1/workspaces/{wid}/calendar/events/{eventId} — 日历事件详情
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; eventId: string }> },
) {
  const { wid, eventId } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const event = await runWithWorkspace(
      wid,
      (tx) =>
        tx.calendarEvent.findFirst({
          where: { id: eventId, workspaceId: wid },
          select: {
            id: true,
            title: true,
            description: true,
            startAt: true,
            endAt: true,
            allDay: true,
            location: true,
            color: true,
            createdBy: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
      ctx.payload.sub,
    );

    if (!event) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "calendarEventNotFound"), data: null },
        { status: 404 },
      );
    }
    return NextResponse.json({ code: 200, data: event });
  } catch (error) {
    console.error("[GET calendar event] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/** PATCH /v1/workspaces/{wid}/calendar/events/{eventId} — 更新日历事件 */
const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  allDay: z.boolean().optional(),
  location: z.string().max(500).optional(),
  color: z.string().max(20).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; eventId: string }> },
) {
  const { wid, eventId } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const body = await req.json();
    const validated = updateSchema.parse(body);

    const updated = await runWithWorkspace(
      wid,
      async (tx) => {
        const existing = await tx.calendarEvent.findFirst({
          where: { id: eventId, workspaceId: wid },
          select: { id: true },
        });
        if (!existing) return { kind: "notFound" as const };

        const data: Prisma.CalendarEventUpdateInput = {};
        if (validated.title !== undefined) data.title = validated.title;
        if (validated.description !== undefined) data.description = validated.description;
        if (validated.startAt !== undefined) data.startAt = new Date(validated.startAt);
        if (validated.endAt !== undefined) data.endAt = new Date(validated.endAt);
        if (validated.allDay !== undefined) data.allDay = validated.allDay;
        if (validated.location !== undefined) data.location = validated.location;
        if (validated.color !== undefined) data.color = validated.color;

        const event = await tx.calendarEvent.update({
          where: { id: eventId },
          data,
          select: {
            id: true,
            title: true,
            description: true,
            startAt: true,
            endAt: true,
            allDay: true,
            location: true,
            color: true,
            createdBy: true,
            createdAt: true,
            updatedAt: true,
          },
        });
        return { kind: "ok" as const, event };
      },
      ctx.payload.sub,
    );

    if (updated.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "calendarEventNotFound"), data: null },
        { status: 404 },
      );
    }
    return NextResponse.json({ code: 200, data: updated.event });
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
        { code: 404, message: apiMsg(req, "calendarEventNotFound"), data: null },
        { status: 404 },
      );
    }
    console.error("[PATCH calendar event] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/** DELETE /v1/workspaces/{wid}/calendar/events/{eventId} — 删除日历事件 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; eventId: string }> },
) {
  const { wid, eventId } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const deleted = await runWithWorkspace(
      wid,
      async (tx) => {
        const existing = await tx.calendarEvent.findFirst({
          where: { id: eventId, workspaceId: wid },
          select: { id: true },
        });
        if (!existing) return { kind: "notFound" as const };
        await tx.calendarEvent.delete({ where: { id: eventId } });
        return { kind: "ok" as const };
      },
      ctx.payload.sub,
    );

    if (deleted.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "calendarEventNotFound"), data: null },
        { status: 404 },
      );
    }
    return NextResponse.json({ code: 200, data: { id: eventId, deleted: true } });
  } catch (error) {
    console.error("[DELETE calendar event] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}