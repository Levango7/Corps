import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";

/**
 * GET /v1/workspaces/{wid}/calendar/events — 日历事件列表
 * Query: ?start=ISO&end=ISO（时间范围过滤，返回 startAt >= start AND endAt <= end 的事件）
 * 按 startAt 升序排列
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const url = new URL(req.url);
    const start = url.searchParams.get("start");
    const end = url.searchParams.get("end");

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

    const where: { workspaceId: string; startAt?: { gte: Date }; endAt?: { lte: Date } } = {
      workspaceId: wid,
    };
    if (start) where.startAt = { gte: new Date(start) };
    if (end) where.endAt = { lte: new Date(end) };

    const [events, total] = await runWithWorkspace(
      wid,
      async (tx) =>
        Promise.all([
          tx.calendarEvent.findMany({
            where,
            orderBy: { startAt: "asc" },
            take,
            skip,
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
          tx.calendarEvent.count({ where }),
        ]),
      ctx.payload.sub,
    );

    return NextResponse.json({
      code: 200,
      data: { items: events, total, hasMore: skip + take < total },
    });
  } catch (error) {
    console.error("[GET calendar events] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/** POST /v1/workspaces/{wid}/calendar/events — 创建日历事件 */
const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  allDay: z.boolean().optional(),
  location: z.string().max(500).optional(),
  color: z.string().max(20).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const body = await req.json();
    const validated = createSchema.parse(body);

    const event = await runWithWorkspace(
      wid,
      (tx) =>
        tx.calendarEvent.create({
          data: {
            workspaceId: wid,
            title: validated.title,
            description: validated.description ?? null,
            startAt: new Date(validated.startAt),
            endAt: new Date(validated.endAt),
            allDay: validated.allDay ?? false,
            location: validated.location ?? null,
            color: validated.color ?? null,
            createdBy: ctx.payload.sub,
          },
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

    return NextResponse.json({ code: 201, data: event }, { status: 201 });
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
    console.error("[POST calendar event] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
