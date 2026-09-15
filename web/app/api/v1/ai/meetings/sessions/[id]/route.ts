// GET    /api/v1/ai/meetings/sessions/[id]?wid=xxx — 获取会话详情（含 actionItems + decisions）
// PATCH  /api/v1/ai/meetings/sessions/[id]?wid=xxx — 更新会话（status / title / endTime）
// DELETE /api/v1/ai/meetings/sessions/[id]?wid=xxx — 删除会话
//
// 认证模式：getUserId → getWorkspaceContext → runWithWorkspace（RLS 事务）
// 安全：通过 workspaceId + userId + id 三重过滤确保用户只能操作自己的会议会话
// 约定：{ code, data, message }

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";

/** 合法状态枚举 */
const STATUS_VALUES = ["active", "paused", "ended"] as const;

/** UUID 正则校验 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 从 URL 路径提取会话 ID（"sessions" 段后紧跟的段） */
function extractSessionId(req: NextRequest): string | null {
  const segments = new URL(req.url).pathname.split("/");
  const idx = segments.indexOf("sessions");
  if (idx === -1 || idx + 1 >= segments.length) return null;
  const id = segments[idx + 1];
  if (!id || !UUID_RE.test(id)) return null;
  return id;
}

/** GET 查询参数 schema */
const detailQuerySchema = z.object({
  wid: z.string().uuid(),
});

/** PATCH 更新会话 schema */
const updateSchema = z.object({
  wid: z.string().uuid(),
  status: z.enum(STATUS_VALUES).optional(),
  title: z.string().min(1).max(200).optional(),
});

/**
 * GET /api/v1/ai/meetings/sessions/[id]?wid=xxx
 *
 * 获取会话详情，含行动项和决策列表。
 */
export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  const limited = await checkRateLimit(req, "ai-meeting-session-detail", {
    windowMs: 60_000,
    max: 60,
  });
  if (limited) return limited;

  const sessionId = extractSessionId(req);
  if (!sessionId) {
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "invalidParams"), data: null },
      { status: 400 },
    );
  }

  const url = new URL(req.url);
  const parsed = detailQuerySchema.safeParse({
    wid: url.searchParams.get("wid") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      {
        code: 400,
        message:
          parsed.error.issues[0]?.message ?? apiMsg(req, "invalidParams"),
        data: null,
      },
      { status: 400 },
    );
  }
  const { wid } = parsed.data;

  try {
    const ctx = await getWorkspaceContext(req, wid);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }

    const session = await runWithWorkspace(
      wid,
      (tx) =>
        tx.aiMeetingSession.findFirst({
          where: {
            id: sessionId,
            workspaceId: wid,
            userId: ctx.payload.sub,
          },
          include: {
            actionItems: {
              orderBy: { createdAt: "asc" },
            },
            decisions: {
              orderBy: { createdAt: "asc" },
            },
          },
        }),
      ctx.payload.sub,
    );

    if (!session) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "workspaceNotFound"), data: null },
        { status: 404 },
      );
    }

    return NextResponse.json({ code: 0, data: session, message: "OK" });
  } catch (error) {
    console.error("[GET ai/meetings/sessions/[id]] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/v1/ai/meetings/sessions/[id]?wid=xxx
 *
 * 更新会话状态（paused/ended）或标题。ended 状态自动设置 endTime。
 */
export async function PATCH(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  const limited = await checkRateLimit(req, "ai-meeting-session-update", {
    windowMs: 60_000,
    max: 30,
  });
  if (limited) return limited;

  const sessionId = extractSessionId(req);
  if (!sessionId) {
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "invalidParams"), data: null },
      { status: 400 },
    );
  }

  let body: z.infer<typeof updateSchema>;
  try {
    body = updateSchema.parse(await req.json());
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
        tx.aiMeetingSession.update({
          where: {
            id: sessionId,
            workspaceId: body.wid,
            userId: ctx.payload.sub,
          },
          data: {
            ...(body.status ? { status: body.status } : {}),
            ...(body.title ? { title: body.title } : {}),
            // ended 状态自动设置 endTime（若未设置）
            ...(body.status === "ended" ? { endTime: new Date() } : {}),
          },
          select: {
            id: true,
            title: true,
            status: true,
            participantCount: true,
            startTime: true,
            endTime: true,
            updatedAt: true,
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 0, data: session, message: "OK" });
  } catch (error) {
    // P2025: 记录不存在（update where 条件不匹配）
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2025"
    ) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "workspaceNotFound"), data: null },
        { status: 404 },
      );
    }
    console.error("[PATCH ai/meetings/sessions/[id]] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/v1/ai/meetings/sessions/[id]?wid=xxx
 *
 * 删除会议会话及其关联的行动项和决策（级联删除由 Prisma 外键约束保证）。
 */
export async function DELETE(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  const limited = await checkRateLimit(req, "ai-meeting-session-delete", {
    windowMs: 60_000,
    max: 20,
  });
  if (limited) return limited;

  const sessionId = extractSessionId(req);
  if (!sessionId) {
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "invalidParams"), data: null },
      { status: 400 },
    );
  }

  const url = new URL(req.url);
  const parsed = detailQuerySchema.safeParse({
    wid: url.searchParams.get("wid") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      {
        code: 400,
        message:
          parsed.error.issues[0]?.message ?? apiMsg(req, "invalidParams"),
        data: null,
      },
      { status: 400 },
    );
  }
  const { wid } = parsed.data;

  try {
    const ctx = await getWorkspaceContext(req, wid);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }

    await runWithWorkspace(
      wid,
      (tx) =>
        tx.aiMeetingSession.delete({
          where: {
            id: sessionId,
            workspaceId: wid,
            userId: ctx.payload.sub,
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 0, data: null, message: "OK" });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2025"
    ) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "workspaceNotFound"), data: null },
        { status: 404 },
      );
    }
    console.error("[DELETE ai/meetings/sessions/[id]] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}