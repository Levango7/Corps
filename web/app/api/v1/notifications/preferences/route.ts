// GET   /api/v1/notifications/preferences — 获取当前用户通知偏好（如不存在则创建默认）
// PATCH /api/v1/notifications/preferences — 更新通知偏好
//        Body: { emailNotify?, pushNotify?, dndEnabled?, dndStart?, dndEnd? }
//
// 认证模式：getUserId → checkRateLimit → prisma（用户级数据，不绑定工作区）
// 安全：NotificationPreference.userId 唯一，确保用户只能访问自己的偏好
// 约定：{ code, data, message }
//
// 注意：NotificationPreference 是用户级数据（无 workspaceId），不通过 runWithWorkspace
// 的 RLS 事务，直接用 prisma 操作。userId 已通过 getUserId 认证。
//
// 经验来源：2026-09-15-ai-route-unified-pattern-audit-checklist
//  - checkRateLimit 认证后立即调用
//  - DB 操作用 try-catch 包裹，catch 返回 503 internalError

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";
import { prisma } from "@/lib/prisma";

/** HH:mm 时间格式校验 */
const timeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "时间格式必须为 HH:mm");

/** PATCH 更新 schema（所有字段可选） */
const updateSchema = z.object({
  emailNotify: z.boolean().optional(),
  pushNotify: z.boolean().optional(),
  dndEnabled: z.boolean().optional(),
  dndStart: timeString.optional(),
  dndEnd: timeString.optional(),
});

/** 偏好记录（返回给前端） */
interface PreferenceResult {
  id: string;
  emailNotify: boolean;
  pushNotify: boolean;
  dndEnabled: boolean;
  dndStart: string;
  dndEnd: string;
  createdAt: string;
  updatedAt: string;
}

/** 将 Prisma 记录转为前端响应格式 */
function toResult(pref: {
  id: string;
  emailNotify: boolean;
  pushNotify: boolean;
  dndEnabled: boolean;
  dndStart: string;
  dndEnd: string;
  createdAt: Date;
  updatedAt: Date;
}): PreferenceResult {
  return {
    ...pref,
    createdAt: pref.createdAt.toISOString(),
    updatedAt: pref.updatedAt.toISOString(),
  };
}

/** select 子集（GET/PATCH 共用） */
const selectFields = {
  id: true,
  emailNotify: true,
  pushNotify: true,
  dndEnabled: true,
  dndStart: true,
  dndEnd: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * GET /api/v1/notifications/preferences
 *
 * 获取当前用户通知偏好。如不存在则创建默认记录（upsert）。
 */
export async function GET(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 1.5) 限流：60s 内最多 60 次
  const limited = await checkRateLimit(req, "notification-preferences-get", {
    windowMs: 60_000,
    max: 60,
  });
  if (limited) return limited;

  try {
    // 2) upsert 偏好（不存在则创建默认）
    const pref = await prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId },
      update: {},
      select: selectFields,
    });

    return NextResponse.json({ code: 0, data: toResult(pref), message: apiMsg(req, "ok") });
  } catch (error) {
    console.error("[GET notifications/preferences] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/v1/notifications/preferences
 *
 * 更新当前用户通知偏好。仅更新提供的字段（partial update）。
 */
export async function PATCH(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 1.5) 限流：60s 内最多 20 次
  const limited = await checkRateLimit(req, "notification-preferences-update", {
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
      ...(body.emailNotify !== undefined ? { emailNotify: body.emailNotify } : {}),
      ...(body.pushNotify !== undefined ? { pushNotify: body.pushNotify } : {}),
      ...(body.dndEnabled !== undefined ? { dndEnabled: body.dndEnabled } : {}),
      ...(body.dndStart !== undefined ? { dndStart: body.dndStart } : {}),
      ...(body.dndEnd !== undefined ? { dndEnd: body.dndEnd } : {}),
    };

    const pref = await prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, ...updateData },
      update: updateData,
      select: selectFields,
    });

    return NextResponse.json({ code: 0, data: toResult(pref), message: apiMsg(req, "ok") });
  } catch (error) {
    console.error("[PATCH notifications/preferences] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
