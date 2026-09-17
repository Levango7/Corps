// POST /api/v1/push/unsubscribe — 注销 Web Push 订阅
//
// 接收 endpoint，删除当前用户名下匹配的 PushSubscription（可能多条，全删）。

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";
import { prisma } from "@/lib/prisma";

const unsubscribeSchema = z.object({
  endpoint: z.string().url(),
});

/** POST /api/v1/push/unsubscribe — 注销 Web Push 订阅 */
export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  const limited = await checkRateLimit(req, "push-unsubscribe", {
    windowMs: 60_000,
    max: 20,
  });
  if (limited) return limited;

  let body: z.infer<typeof unsubscribeSchema>;
  try {
    body = unsubscribeSchema.parse(await req.json());
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
    await prisma.pushSubscription.deleteMany({
      where: { userId, endpoint: body.endpoint },
    });
    return NextResponse.json({ code: 200, data: { unsubscribed: true } });
  } catch (error) {
    console.error("[POST push/unsubscribe] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}