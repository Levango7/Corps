import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";
import type { Prisma } from "@prisma/client";

/**
 * GET /v1/workspaces/{wid}/meeting-minutes — 工作区会议纪要列表
 * Query: ?page=1&limit=20&meetingId=<uuid>（可选，按会议过滤）
 * 返回按 createdAt 倒序，统一分页格式 { items, page, limit, total, hasMore }
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string }> },
) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const url = new URL(req.url);
    const parsed = listMinutesQuerySchema.safeParse({
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      meetingId: url.searchParams.get("meetingId") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        {
          code: 400,
          message: apiMsg(req, "validationFailed"),
          errors: parsed.error.errors,
          data: null,
        },
        { status: 400 },
      );
    }
    const { page, limit, meetingId } = parsed.data;
    const skip = (page - 1) * limit;

    const where = {
      workspaceId: wid,
      ...(meetingId ? { meetingId } : {}),
    };

    const [items, total] = await runWithWorkspace(
      wid,
      (tx) =>
        Promise.all([
          tx.meetingMinutes.findMany({
            where,
            select: {
              id: true,
              meetingId: true,
              title: true,
              attendees: true,
              actionItems: true,
              createdBy: true,
              createdAt: true,
              updatedAt: true,
              creator: { select: { id: true, name: true, email: true } },
            },
            orderBy: [{ createdAt: "desc" }],
            skip,
            take: limit,
          }),
          tx.meetingMinutes.count({ where }),
        ]),
      ctx.payload.sub,
    );

    return NextResponse.json({
      code: 200,
      data: { items, page, limit, total, hasMore: page * limit < total },
    });
  } catch (error) {
    console.error("[GET meeting-minutes] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * 列表 searchParams 校验：
 *  - page: 页码（默认 1）
 *  - limit: 每页数量（默认 20，最大 100）
 *  - meetingId: 可选，按会议过滤
 */
const listMinutesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  meetingId: z.string().uuid().optional(),
});

/**
 * 参会人员单项：{ userId?, name, role? }
 * 行动项单项：{ title, assigneeId?, dueDate?, done }
 */
const attendeeSchema = z.object({
  userId: z.string().uuid().optional(),
  name: z.string().min(1).max(100),
  role: z.string().max(50).optional(),
});

const actionItemSchema = z.object({
  title: z.string().min(1).max(200),
  assigneeId: z.string().uuid().optional(),
  dueDate: z.string().datetime().optional(),
  done: z.boolean().default(false),
});

/**
 * POST /v1/workspaces/{wid}/meeting-minutes — 创建会议纪要
 * Body: { title, content, meetingId?, attendees?, actionItems? }
 */
const createMinutesSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  meetingId: z.string().uuid().optional(),
  attendees: z.array(attendeeSchema).default([]),
  actionItems: z.array(actionItemSchema).default([]),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string }> },
) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const body = await req.json();
    const validated = createMinutesSchema.parse(body);

    // 行动项 dueDate 从 ISO 字符串转为 ISO（保持 JSON 字符串存储，前端可直读）
    const minutes = await runWithWorkspace(
      wid,
      (tx) =>
        tx.meetingMinutes.create({
          data: {
            workspaceId: wid,
            meetingId: validated.meetingId,
            title: validated.title,
            content: validated.content,
            attendees: validated.attendees as Prisma.InputJsonValue,
            actionItems: validated.actionItems as Prisma.InputJsonValue,
            createdBy: ctx.payload.sub,
          },
          include: {
            creator: { select: { id: true, name: true, email: true } },
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 201, data: minutes }, { status: 201 });
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
    console.error("[POST meeting-minutes] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}