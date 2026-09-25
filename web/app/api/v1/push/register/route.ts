// POST   /api/v1/push/register — 注册设备推送 token（FCM/APNs/Huawei Push Kit）
// DELETE /api/v1/push/register — 注销设备推送 token
//
// 认证模式：getUserId → checkRateLimit → prisma（用户级数据，不绑定工作区）
// 与 /api/v1/push/subscribe（浏览器 Web Push）正交，覆盖原生 App 推送通道。
// PushToken 是用户级数据（无 workspaceId），不通过 runWithWorkspace 的 RLS 事务，
// 直接用 prisma 操作。userId 已通过 getUserId 认证。
//
// 约定：{ code, data, message }

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";
import { prisma } from "@/lib/prisma";

/** 平台枚举（与 PushToken.platform 一致） */
const platformEnum = z.enum(["android", "ios", "harmonyos"]);

/** POST 注册请求体 */
const registerSchema = z.object({
  platform: platformEnum,
  token: z.string().min(1).max(512),
});

/** DELETE 注销请求体 */
const unregisterSchema = z.object({
  platform: platformEnum,
  token: z.string().min(1).max(512),
});

/**
 * POST /api/v1/push/register — 注册/更新设备推送 token
 *
 * upsert 到 PushToken 表（以 userId+platform+token 为唯一键）。
 * 同一设备重复注册时幂等（updatedAt 刷新）。
 */
export async function POST(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 1.5) 限流：60s 内最多 20 次（设备注册低频，20 足够）
  const limited = await checkRateLimit(req, "push-token-register", {
    windowMs: 60_000,
    max: 20,
  });
  if (limited) return limited;

  // 2) body 校验
  let body: z.infer<typeof registerSchema>;
  try {
    body = registerSchema.parse(await req.json());
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
    // 3) upsert 推送 token（userId+platform+token 唯一）
    await prisma.pushToken.upsert({
      where: {
        userId_platform_token: {
          userId,
          platform: body.platform,
          token: body.token,
        },
      },
      create: {
        userId,
        platform: body.platform,
        token: body.token,
      },
      update: {
        // upsert 的 update 分支：token 已存在，仅刷新 updatedAt（updatedAt @updatedAt 自动更新）
      },
    });

    return NextResponse.json({
      code: 0,
      data: null,
      message: apiMsg(req, "ok"),
    });
  } catch (error) {
    console.error("[POST push/register] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/v1/push/register — 注销设备推送 token
 *
 * 从 PushToken 表删除指定 platform+token 记录（限定当前用户，防越权删除他人 token）。
 * 不存在时幂等返回成功（删除 0 行不报错）。
 */
export async function DELETE(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 1.5) 限流
  const limited = await checkRateLimit(req, "push-token-unregister", {
    windowMs: 60_000,
    max: 20,
  });
  if (limited) return limited;

  // 2) body 校验
  let body: z.infer<typeof unregisterSchema>;
  try {
    body = unregisterSchema.parse(await req.json());
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
    // 3) 删除推送 token（限定 userId 防越权）
    await prisma.pushToken.deleteMany({
      where: {
        userId,
        platform: body.platform,
        token: body.token,
      },
    });

    return NextResponse.json({
      code: 0,
      data: null,
      message: apiMsg(req, "ok"),
    });
  } catch (error) {
    console.error("[DELETE push/register] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
