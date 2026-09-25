// PATCH /api/v1/ai/voice/command/[id] — 标记语音命令已执行
//      Body: { workspaceId, executed }
//
// 认证模式：getUserId → getWorkspaceContext → runWithWorkspace（RLS 事务）
// 安全：通过 id + workspaceId + userId 三重过滤确保用户只能更新自己的命令
// 约定：{ code, data, message }

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";

/** UUID 正则校验 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 从 URL 路径提取命令 ID（"command" 段后紧跟的段） */
function extractCommandId(req: NextRequest): string | null {
  const segments = new URL(req.url).pathname.split("/");
  const idx = segments.indexOf("command");
  if (idx === -1 || idx + 1 >= segments.length) return null;
  const id = segments[idx + 1];
  if (!id || !UUID_RE.test(id)) return null;
  return id;
}

/** PATCH 更新 schema */
const updateSchema = z.object({
  workspaceId: z.string().uuid(),
  executed: z.boolean(),
});

/**
 * PATCH /api/v1/ai/voice/command/[id]
 *
 * 标记指定语音命令的执行状态（executed: true/false）。
 * 前端在用户确认执行后调用，更新后端记录。
 */
export async function PATCH(req: NextRequest) {
  // 1) 认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) 速率限制：每分钟 30 次
  const limited = await checkRateLimit(req, "ai-voice-command-update", {
    windowMs: 60_000,
    max: 30,
  });
  if (limited) return limited;

  // 3) 提取命令 ID
  const commandId = extractCommandId(req);
  if (!commandId) {
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "invalidParams"), data: null },
      { status: 400 },
    );
  }

  // 4) body 校验
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

  // 5) 工作区守卫 + 更新命令执行状态
  try {
    const ctx = await getWorkspaceContext(req, body.workspaceId);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }

    // 用 updateMany + 三重过滤（id + workspaceId + userId）确保只能更新自己的命令
    const result = await runWithWorkspace(
      body.workspaceId,
      (tx) =>
        tx.aiVoiceCommand.updateMany({
          where: {
            id: commandId,
            workspaceId: body.workspaceId,
            userId: ctx.payload.sub,
          },
          data: { executed: body.executed },
        }),
      ctx.payload.sub,
    );

    if (result.count === 0) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "commandNotFound"), data: null },
        { status: 404 },
      );
    }

    return NextResponse.json({ code: 0, data: null, message: "OK" });
  } catch (error) {
    console.error("[PATCH ai/voice/command/[id]] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}
