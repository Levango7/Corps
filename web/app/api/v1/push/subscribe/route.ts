// POST /api/v1/push/subscribe — 注册 Web Push 订阅
//
// 接收浏览器 PushSubscription 的 endpoint + keys，存入 PushSubscription 表。
// 同一用户同一 endpoint 重复订阅时更新 keys（幂等）。

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";
import { prisma } from "@/lib/prisma";

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});

/** POST /api/v1/push/subscribe — 注册/更新 Web Push 订阅 */
export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  const limited = await checkRateLimit(req, "push-subscribe", {
    windowMs: 60_000,
    max: 20,
  });
  if (limited) return limited;

  let body: z.infer<typeof subscribeSchema>;
  try {
    body = subscribeSchema.parse(await req.json());
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
    // 幂等：同一 (userId, endpoint) 已存在则更新 keys，否则创建
    const existing = await prisma.pushSubscription.findFirst({
      where: { userId, endpoint: body.endpoint },
      select: { id: true },
    });
    if (existing) {
      await prisma.pushSubscription.update({
        where: { id: existing.id },
        data: { p256dhKey: body.keys.p256dh, authKey: body.keys.auth },
      });
    } else {
      await prisma.pushSubscription.create({
        data: {
          userId,
          endpoint: body.endpoint,
          p256dhKey: body.keys.p256dh,
          authKey: body.keys.auth,
        },
      });
    }
    return NextResponse.json({ code: 200, data: { subscribed: true } });
  } catch (error) {
    console.error("[POST push/subscribe] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}