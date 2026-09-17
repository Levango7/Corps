// GET /api/v1/push/vapid — 返回 VAPID 公钥
//
// 前端在 ServiceWorker 订阅 Web Push 前，需先获取 VAPID 公钥（应用服务器公钥）。

import { NextRequest, NextResponse } from "next/server";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";
import { getVapidPublicKey } from "@/lib/web-push";

/** GET /api/v1/push/vapid — 返回 VAPID 公钥 */
export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  const limited = await checkRateLimit(req, "push-vapid", {
    windowMs: 60_000,
    max: 30,
  });
  if (limited) return limited;

  const publicKey = getVapidPublicKey();
  if (!publicKey) {
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
  return NextResponse.json({ code: 200, data: { publicKey } });
}