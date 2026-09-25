// GET   /api/v1/ai/meetings/sessions/[id]/actions?wid=xxx[&status=pending] — 获取行动项列表
// PATCH /api/v1/ai/meetings/sessions/[id]/actions — 更新行动项状态
//       Body: { wid, actionId, status }
//
// 认证模式：getUserId → getWorkspaceContext → runWithWorkspace（RLS 事务）
// 安全：通过 workspaceId + sessionId 过滤确保用户只能访问当前工作区的行动项
// 约定：{ code, data, message }

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";

/** 行动项合法状态枚举 */
const ACTION_STATUS_VALUES = ["pending", "completed", "skipped"] as const;

/** UUID 正则校验 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 从 URL 路径提取会话 ID */
function extractSessionId(req: NextRequest): string | null {
  const segments = new URL(req.url).pathname.split("/");
  const idx = segments.indexOf("sessions");
  if (idx === -1 || idx + 1 >= segments.length) return null;
  const id = segments[idx + 1];
  if (!id || !UUID_RE.test(id)) return null;
  return id;
}

/** GET 查询参数 schema */
const listQuerySchema = z.object({
  wid: z.string().uuid(),
  status: z.enum(ACTION_STATUS_VALUES).optional(),
});

/** PATCH 更新行动项 schema */
const updateSchema = z.object({
  wid: z.string().uuid(),
  actionId: z.string().uuid(),
  status: z.enum(ACTION_STATUS_VALUES),
});

/**
 * GET /api/v1/ai/meetings/sessions/[id]/actions?wid=xxx
 *
 * 返回指定会话的行动项列表（按创建时间升序），可选 status 过滤。
 */
export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  const limited = await checkRateLimit(req, "ai-meeting-actions-list", {
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
  const parsed = listQuerySchema.safeParse({
    wid: url.searchParams.get("wid") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
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
  const { wid, status } = parsed.data;

  try {
    const ctx = await getWorkspaceContext(req, wid);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }

    // 先校验会话归属
    const session = await runWithWorkspace(
      wid,
      (tx) =>
        tx.aiMeetingSession.findFirst({
          where: {
            id: sessionId,
            workspaceId: wid,
            userId: ctx.payload.sub,
          },
          select: { id: true },
        }),
      ctx.payload.sub,
    );
    if (!session) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "sessionNotFound"), data: null },
        { status: 404 },
      );
    }

    const actions = await runWithWorkspace(
      wid,
      (tx) =>
        tx.aiMeetingActionItem.findMany({
          where: {
            sessionId,
            workspaceId: wid,
            ...(status ? { status } : {}),
          },
          orderBy: { createdAt: "asc" },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 0, data: actions, message: "OK" });
  } catch (error) {
    console.error("[GET ai/meetings/sessions/[id]/actions] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/v1/ai/meetings/sessions/[id]/actions
 *
 * 更新指定行动项的状态（completed / skipped / pending）。
 */
export async function PATCH(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  const limited = await checkRateLimit(req, "ai-meeting-actions-update", {
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

    // 先校验会话归属，防止同工作区其他成员修改他人会议的行动项
    const session = await runWithWorkspace(
      body.wid,
      (tx) =>
        tx.aiMeetingSession.findFirst({
          where: {
            id: sessionId,
            workspaceId: body.wid,
            userId: ctx.payload.sub,
          },
          select: { id: true },
        }),
      ctx.payload.sub,
    );
    if (!session) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "sessionNotFound"), data: null },
        { status: 404 },
      );
    }

    const action = await runWithWorkspace(
      body.wid,
      (tx) =>
        tx.aiMeetingActionItem.update({
          where: {
            id: body.actionId,
            sessionId,
            workspaceId: body.wid,
          },
          data: { status: body.status },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 0, data: action, message: "OK" });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2025") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "sessionNotFound"), data: null },
        { status: 404 },
      );
    }
    console.error("[PATCH ai/meetings/sessions/[id]/actions] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
