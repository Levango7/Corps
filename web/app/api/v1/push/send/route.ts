// POST /api/v1/push/send — 发送推送通知（仅管理员）
//
// 请求体：{ userId, title, body, data? }
// 流程：
//   1. 认证 + 管理员校验 + 速率限制
//   2. body 校验
//   3. 调用 sendPushToUser（查库获取目标用户所有设备 token，跨平台批量下发）
//   4. 返回 { code: 0, data: null, message: 'ok' }
//
// 管理员校验：推送发送是全局操作（不绑定工作区），通过环境变量
// PUSH_ADMIN_USER_IDS（逗号分隔的 UUID 列表）配置允许发送的管理员。
// 未配置时拒绝所有请求（安全默认——fail closed）。
//
// 约定：{ code, data, message }

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";
import { sendPushToUser } from "@/lib/push/unified";

/** 发送推送请求体 */
const sendSchema = z.object({
  /** 目标用户 ID */
  userId: z.string().uuid(),
  /** 通知标题 */
  title: z.string().min(1).max(200),
  /** 通知正文 */
  body: z.string().min(1).max(1000),
  /** 自定义数据（键值对，透传到客户端，可选） */
  data: z.record(z.string(), z.string()).optional(),
  /** 角标数（可选） */
  badge: z.number().int().min(0).max(999).optional(),
});

/**
 * 校验当前用户是否为推送管理员。
 *
 * 通过环境变量 PUSH_ADMIN_USER_IDS（逗号分隔的 UUID 列表）配置。
 * 未配置时返回 false（安全默认——fail closed，拒绝所有发送请求）。
 */
function isPushAdmin(userId: string): boolean {
  const adminIds = process.env.PUSH_ADMIN_USER_IDS;
  if (!adminIds) return false;
  const allowed = adminIds
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return allowed.includes(userId);
}

/**
 * POST /api/v1/push/send — 发送推送通知（仅管理员）
 *
 * 管理员向指定用户的所有已注册设备发送推送通知。
 * 跨平台（Android/iOS/HarmonyOS）自动分发，未配置环境变量的平台静默跳过。
 */
export async function POST(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) 管理员校验（推送发送是全局操作，通过环境变量白名单控制）
  if (!isPushAdmin(userId)) {
    return NextResponse.json(
      { code: 403, data: null, message: apiMsg(req, "forbidden") },
      { status: 403 },
    );
  }

  // 3) 速率限制：60s 内最多 30 次（管理员批量推送场景）
  const limited = await checkRateLimit(req, "push-send", {
    windowMs: 60_000,
    max: 30,
  });
  if (limited) return limited;

  // 4) body 校验
  let body: z.infer<typeof sendSchema>;
  try {
    body = sendSchema.parse(await req.json());
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
    // 5) 调用 sendPushToUser 跨平台推送
    //    内部查库获取目标用户所有设备 PushToken，按平台分发到 FCM/APNs/Huawei Push Kit。
    //    未配置环境变量的平台静默跳过；部分设备 token 失效不中断整体（尽力而为）。
    await sendPushToUser(body.userId, {
      title: body.title,
      body: body.body,
      data: body.data,
      badge: body.badge,
    });

    return NextResponse.json({
      code: 0,
      data: null,
      message: apiMsg(req, "ok"),
    });
  } catch (error) {
    console.error("[POST push/send] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
