import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";

/**
 * GET /v1/workspaces/{wid}/time-entries — 工时记录列表
 * Query: ?userId=&taskId=&startDate=&endDate=&page=&limit=
 * 返回按 startTime 倒序
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const url = new URL(req.url);
    const parsed = listQuerySchema.safeParse({
      userId: url.searchParams.get("userId") ?? undefined,
      taskId: url.searchParams.get("taskId") ?? undefined,
      startDate: url.searchParams.get("startDate") ?? undefined,
      endDate: url.searchParams.get("endDate") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "validationFailed"), errors: parsed.error.errors, data: null },
        { status: 400 },
      );
    }
    const { userId, taskId, startDate, endDate, page, limit } = parsed.data;
    const skip = (page - 1) * limit;

    const where = {
      workspaceId: wid,
      ...(userId ? { userId } : {}),
      ...(taskId ? { taskId } : {}),
      ...(startDate || endDate
        ? {
            startTime: {
              ...(startDate ? { gte: new Date(startDate) } : {}),
              ...(endDate ? { lte: new Date(endDate) } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await runWithWorkspace(wid, (tx) =>
      Promise.all([
        tx.timeEntry.findMany({
          where,
          include: {
            user: { select: { id: true, name: true, email: true } },
            task: { select: { id: true, title: true } },
          },
          orderBy: [{ startTime: "desc" }],
          skip,
          take: limit,
        }),
        tx.timeEntry.count({ where }),
      ]),
    );

    return NextResponse.json({
      code: 200,
      data: { items, page, limit, total, hasMore: page * limit < total },
    });
  } catch (error) {
    console.error("[GET time-entries] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

const listQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const createSchema = z.object({
  startTime: z.string().datetime(),
  taskId: z.string().uuid().optional(),
  endTime: z.string().datetime().optional(),
  duration: z.number().int().min(0).optional(),
  description: z.string().optional(),
  billable: z.boolean().optional(),
  hourlyRate: z.number().nonnegative().optional(),
});

/** POST /v1/workspaces/{wid}/time-entries — 创建工时记录 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const body = await req.json();
    const validated = createSchema.parse(body);

    const entry = await runWithWorkspace(
      wid,
      (tx) =>
        tx.timeEntry.create({
          data: {
            workspaceId: wid,
            userId: ctx.payload.sub,
            taskId: validated.taskId,
            startTime: new Date(validated.startTime),
            endTime: validated.endTime ? new Date(validated.endTime) : null,
            duration: validated.duration,
            description: validated.description,
            billable: validated.billable ?? false,
            hourlyRate: validated.hourlyRate,
          },
          include: {
            user: { select: { id: true, name: true, email: true } },
            task: { select: { id: true, title: true } },
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 201, data: entry }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"), data: null, errors: error.errors },
        { status: 400 },
      );
    }
    console.error("[POST time-entry] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}