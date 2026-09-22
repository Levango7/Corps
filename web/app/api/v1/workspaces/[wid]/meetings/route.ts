import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";
import bcrypt from "bcryptjs";

/**
 * GET /v1/workspaces/{wid}/meetings — 工作区会议列表
 * Query: ?status=scheduled|active|ended&page=1&limit=20
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
    const parsed = listMeetingsQuerySchema.safeParse({
      status: url.searchParams.get("status") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
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
    const { status, page, limit } = parsed.data;
    const skip = (page - 1) * limit;

    const where = {
      workspaceId: wid,
      ...(status ? { status } : {}),
    };

    const [items, total] = await runWithWorkspace(
      wid,
      (tx) =>
        Promise.all([
          tx.meeting.findMany({
            where,
            select: {
              id: true,
              title: true,
              description: true,
              roomName: true,
              status: true,
              type: true,
              scheduledAt: true,
              startedAt: true,
              endedAt: true,
              maxParticipants: true,
              recordingEnabled: true,
              createdBy: true,
              createdAt: true,
              updatedAt: true,
              creator: { select: { id: true, name: true, email: true } },
              _count: { select: { participants: true } },
            },
            orderBy: [{ createdAt: "desc" }],
            skip,
            take: limit,
          }),
          tx.meeting.count({ where }),
        ]),
      ctx.payload.sub,
    );

    return NextResponse.json({
      code: 200,
      data: { items, page, limit, total, hasMore: page * limit < total },
    });
  } catch (error) {
    console.error("[GET meetings] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * 列表 searchParams 校验：
 *  - status: scheduled | active | ended（可选）
 *  - page: 页码（默认 1）
 *  - limit: 每页数量（默认 20，最大 100）
 */
const listMeetingsQuerySchema = z.object({
  status: z.enum(["scheduled", "active", "ended"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * POST /v1/workspaces/{wid}/meetings — 创建会议
 * Body: { title, description?, type?, scheduledAt?, maxParticipants?, recordingEnabled?, recurringRule?, password? }
 */
const createMeetingSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  type: z.enum(["instant", "scheduled", "recurring"]).optional(),
  scheduledAt: z.string().datetime().optional(),
  maxParticipants: z.number().int().min(1).max(500).optional(),
  recordingEnabled: z.boolean().optional(),
  // L6 #32：重复规则（iCal RRULE 格式），仅 type=recurring 时有意义
  recurringRule: z.string().max(255).optional(),
  // L8 #34：会议密码，设置后加入需验证
  password: z.string().max(100).optional(),
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
    const validated = createMeetingSchema.parse(body);

    // 生成唯一 roomName：meeting-<wid前8位>-<时间戳>
    const roomName = `meeting-${wid.slice(0, 8)}-${Date.now()}`;

    const meeting = await runWithWorkspace(
      wid,
      async (tx) =>
        tx.meeting.create({
          data: {
            workspaceId: wid,
            title: validated.title,
            description: validated.description,
            roomName,
            type: validated.type ?? "instant",
            scheduledAt: validated.scheduledAt
              ? new Date(validated.scheduledAt)
              : null,
            maxParticipants: validated.maxParticipants ?? 50,
            recordingEnabled: validated.recordingEnabled ?? false,
            createdBy: ctx.payload.sub,
            // L6 #32：重复规则（仅 type=recurring 时有意义，但不在后端强校验）
            recurringRule: validated.recurringRule,
            // L8 #34：会议密码——使用 bcrypt hash 存储，加入时用 bcrypt.compare 验证
            password: validated.password
              ? await bcrypt.hash(validated.password, 10)
              : null,
          },
          include: {
            creator: { select: { id: true, name: true, email: true } },
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 201, data: meeting }, { status: 201 });
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
    console.error("[POST meeting] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}