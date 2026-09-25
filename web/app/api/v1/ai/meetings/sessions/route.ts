// GET  /api/v1/ai/meetings/sessions?wid=xxx[&status=active][&limit=20][&cursor=xxx] — 获取会议会话列表
// POST /api/v1/ai/meetings/sessions — 创建会议会话
//      Body: { wid, title, participantCount? }
//
// 认证模式：getUserId → getWorkspaceContext → runWithWorkspace（RLS 事务）
// 安全：通过 workspaceId 过滤确保用户只能访问当前工作区的会议会话
// 约定：{ code, data, message }；transcript 用 as Prisma.InputJsonValue 转换。

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";

/** 合法状态枚举 */
const STATUS_VALUES = ["active", "paused", "ended"] as const;

/** GET 查询参数 schema */
const listQuerySchema = z.object({
  wid: z.string().uuid(),
  status: z.enum(STATUS_VALUES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().uuid().optional(),
});

/** POST 创建会话 schema */
const createSchema = z.object({
  wid: z.string().uuid(),
  title: z.string().min(1).max(200),
  participantCount: z.number().int().min(0).max(1000).optional(),
});

/** 会话列表分页响应 */
interface SessionsListResponse {
  items: unknown[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * GET /api/v1/ai/meetings/sessions?wid=xxx
 *
 * 返回当前工作区的会议会话列表（按开始时间倒序，cursor 分页）。
 */
export async function GET(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 1.5) 限流
  const limited = await checkRateLimit(req, "ai-meeting-sessions-list", {
    windowMs: 60_000,
    max: 60,
  });
  if (limited) return limited;

  // 2) 查询参数校验
  const url = new URL(req.url);
  const parsed = listQuerySchema.safeParse({
    wid: url.searchParams.get("wid") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      {
        code: 400,
        message: parsed.error.issues[0]?.message ?? apiMsg(req, "invalidParams"),
        data: null,
      },
      { status: 400 },
    );
  }
  const { wid, status, limit, cursor } = parsed.data;

  // 3) 工作区成员资格认证 + 查询
  try {
    const ctx = await getWorkspaceContext(req, wid);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }

    const sessions = await runWithWorkspace(
      wid,
      (tx) =>
        tx.aiMeetingSession.findMany({
          where: {
            workspaceId: wid,
            userId: ctx.payload.sub,
            ...(status ? { status } : {}),
            ...(cursor ? { id: { lt: cursor } } : {}),
          },
          select: {
            id: true,
            title: true,
            status: true,
            participantCount: true,
            startTime: true,
            endTime: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: { startTime: "desc" },
          take: limit + 1,
        }),
      ctx.payload.sub,
    );

    const hasMore = sessions.length > limit;
    const items = hasMore ? sessions.slice(0, limit) : sessions;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    const data: SessionsListResponse = { items, nextCursor, hasMore };
    return NextResponse.json({ code: 0, data, message: "OK" });
  } catch (error) {
    console.error("[GET ai/meetings/sessions] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * POST /api/v1/ai/meetings/sessions — 创建会议会话
 *
 * 在指定工作区创建一个新的会议 AI 会话。
 */
export async function POST(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 1.5) 限流
  const limited = await checkRateLimit(req, "ai-meeting-sessions-create", {
    windowMs: 60_000,
    max: 20,
  });
  if (limited) return limited;

  // 2) body 校验
  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        {
          code: 400,
          message: e.issues[0]?.message ?? apiMsg(req, "validationFailed"),
          data: null,
        },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "invalidBody"), data: null },
      { status: 400 },
    );
  }

  // 3) 工作区成员资格认证 + 创建
  try {
    const ctx = await getWorkspaceContext(req, body.wid);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }

    const session = await runWithWorkspace(
      body.wid,
      (tx) =>
        tx.aiMeetingSession.create({
          data: {
            workspaceId: body.wid,
            userId: ctx.payload.sub,
            title: body.title,
            participantCount: body.participantCount ?? 0,
            transcript: [] as Prisma.InputJsonValue,
          },
          select: {
            id: true,
            title: true,
            status: true,
            participantCount: true,
            startTime: true,
            endTime: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 0, data: session, message: "OK" }, { status: 201 });
  } catch (error) {
    console.error("[POST ai/meetings/sessions] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
