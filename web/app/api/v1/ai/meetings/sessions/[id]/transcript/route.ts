// POST /api/v1/ai/meetings/sessions/[id]/transcript — 提交转录片段
//      Body: { wid, speaker, text, timestamp? }
//
// 将转录片段追加到 session.transcript JSON 数组。
// 认证模式：getUserId → getWorkspaceContext → runWithWorkspace（RLS 事务）
// 约定：{ code, data, message }
// 并发安全：用 PostgreSQL 原生 JSONB `||` 追加，避免 read-modify-write 丢失更新。

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";

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

/** POST 提交转录片段 schema */
const transcriptSchema = z.object({
  wid: z.string().uuid(),
  speaker: z.string().min(1).max(100),
  text: z.string().min(1).max(5000),
  timestamp: z.string().optional(),
});

/** 转录片段类型 */
interface TranscriptSegment {
  speaker: string;
  text: string;
  timestamp: string;
}

/**
 * POST /api/v1/ai/meetings/sessions/[id]/transcript
 *
 * 提交一个转录片段，追加到会话的 transcript JSON 数组。
 */
export async function POST(req: NextRequest) {
  // 1) 认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 1.5) 限流：每分钟 120 次（转录片段提交频繁）
  const limited = await checkRateLimit(req, "ai-meeting-transcript", {
    windowMs: 60_000,
    max: 120,
  });
  if (limited) return limited;

  // 2) 提取会话 ID
  const sessionId = extractSessionId(req);
  if (!sessionId) {
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "invalidParams"), data: null },
      { status: 400 },
    );
  }

  // 3) body 校验
  let body: z.infer<typeof transcriptSchema>;
  try {
    body = transcriptSchema.parse(await req.json());
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

  // 4) 工作区守卫 + 追加转录片段
  try {
    const ctx = await getWorkspaceContext(req, body.wid);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }

    // 构造转录片段，用 PostgreSQL 原生 JSONB 追加避免读改写丢失更新
    const segment: TranscriptSegment = {
      speaker: body.speaker,
      text: body.text,
      timestamp: body.timestamp ?? new Date().toISOString(),
    };
    const segmentJson = JSON.stringify([segment]);

    // 原子追加：transcript || $1::jsonb 在 SQL 层拼接，无需先读后写
    const affected = await runWithWorkspace(
      body.wid,
      (tx) =>
        tx.$executeRawUnsafe(
          `UPDATE ai_meeting_sessions SET transcript = transcript || $1::jsonb, updated_at = now() WHERE id = $2 AND workspace_id = $3 AND user_id = $4`,
          segmentJson,
          sessionId,
          body.wid,
          ctx.payload.sub,
        ),
      ctx.payload.sub,
    );

    if (affected === 0) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "sessionNotFound"), data: null },
        { status: 404 },
      );
    }

    // 追加成功后读取最新 transcript 返回（保持响应结构不变）
    const session = await runWithWorkspace(
      body.wid,
      (tx) =>
        tx.aiMeetingSession.findFirst({
          where: {
            id: sessionId,
            workspaceId: body.wid,
            userId: ctx.payload.sub,
          },
          select: { id: true, transcript: true },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 0, data: session, message: "OK" });
  } catch (error) {
    console.error("[POST ai/meetings/sessions/[id]/transcript] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
