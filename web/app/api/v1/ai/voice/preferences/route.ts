// GET   /api/v1/ai/voice/preferences — 获取当前用户语音偏好（如不存在则创建默认）
// PATCH /api/v1/ai/voice/preferences — 更新语音偏好
//        Body: { language?, voiceId?, speed?, wakeWord?, enabled? }
//
// 认证模式：getUserId → prisma（用户级数据，不绑定工作区）
// 安全：AiVoicePreference.userId 唯一，确保用户只能访问自己的偏好
// 约定：{ code, data, message }
//
// 注意：AiVoicePreference 是用户级数据（无 workspaceId），不通过 runWithWorkspace
// 的 RLS 事务，直接用 prisma 操作。userId 已通过 getUserId 认证。

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";
import { prisma } from "@/lib/prisma";

/** PATCH 更新 schema（所有字段可选） */
const updateSchema = z.object({
  language: z.string().min(2).max(10).optional(),
  voiceId: z.string().max(50).nullable().optional(),
  speed: z.number().min(0.5).max(2.0).optional(),
  wakeWord: z.string().min(1).max(50).optional(),
  enabled: z.boolean().optional(),
});

/** 偏好记录（返回给前端） */
interface PreferenceResult {
  id: string;
  language: string;
  voiceId: string | null;
  speed: number;
  wakeWord: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * GET /api/v1/ai/voice/preferences
 *
 * 获取当前用户语音偏好。如不存在则创建默认记录（upsert）。
 */
export async function GET(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 1.5) 限流：60s 内最多 60 次
  const limited = await checkRateLimit(req, "ai-voice-preferences-get", {
    windowMs: 60_000,
    max: 60,
  });
  if (limited) return limited;

  try {
    // 2) upsert 偏好（不存在则创建默认）
    const pref = await prisma.aiVoicePreference.upsert({
      where: { userId },
      create: { userId },
      update: {},
      select: {
        id: true,
        language: true,
        voiceId: true,
        speed: true,
        wakeWord: true,
        enabled: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const data: PreferenceResult = {
      ...pref,
      createdAt: pref.createdAt.toISOString(),
      updatedAt: pref.updatedAt.toISOString(),
    };

    return NextResponse.json({ code: 200, data, message: "OK" });
  } catch (error) {
    console.error("[GET ai/voice/preferences] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/v1/ai/voice/preferences
 *
 * 更新当前用户语音偏好。仅更新提供的字段（partial update）。
 */
export async function PATCH(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 1.5) 限流：60s 内最多 20 次
  const limited = await checkRateLimit(req, "ai-voice-preferences-update", {
    windowMs: 60_000,
    max: 20,
  });
  if (limited) return limited;

  // 2) body 校验
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
    // 3) upsert 偏好（不存在则创建，存在则更新提供的字段）
    const updateData = {
      ...(body.language !== undefined ? { language: body.language } : {}),
      ...(body.voiceId !== undefined ? { voiceId: body.voiceId } : {}),
      ...(body.speed !== undefined ? { speed: body.speed } : {}),
      ...(body.wakeWord !== undefined ? { wakeWord: body.wakeWord } : {}),
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    };

    const pref = await prisma.aiVoicePreference.upsert({
      where: { userId },
      create: { userId, ...updateData },
      update: updateData,
      select: {
        id: true,
        language: true,
        voiceId: true,
        speed: true,
        wakeWord: true,
        enabled: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const data: PreferenceResult = {
      ...pref,
      createdAt: pref.createdAt.toISOString(),
      updatedAt: pref.updatedAt.toISOString(),
    };

    return NextResponse.json({ code: 200, data, message: "OK" });
  } catch (error) {
    console.error("[PATCH ai/voice/preferences] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
