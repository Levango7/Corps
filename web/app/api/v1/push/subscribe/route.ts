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

// P1-fix: SSRF 防护——endpoint 域名白名单，只允许已知 Web Push 服务域名
const ALLOWED_PUSH_HOSTS = [
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "push.apple.com",
];

const subscribeSchema = z.object({
  endpoint: z
    .string()
    .url()
    .refine(
      (url) => {
        try {
          const host = new URL(url).hostname.toLowerCase();
          return ALLOWED_PUSH_HOSTS.some(
            (h) => host === h || host.endsWith("." + h),
          );
        } catch {
          return false;
        }
      },
      { message: "endpoint 域名不在允许的推送服务列表中" },
    ),
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
    // P1-fix: 用 findFirst + update/create 替代裸 create，消除并发竞态。
    // schema 尚未添加 @@unique([userId, endpoint])，故无法用 upsert 的复合 where。
    // 这里先查再更新/创建，并对 create 加 try-catch 处理唯一约束冲突
    // （若并发下另一事务先创建了同 (userId, endpoint) 行，P2002 时改为 update）。
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
      try {
        await prisma.pushSubscription.create({
          data: {
            userId,
            endpoint: body.endpoint,
            p256dhKey: body.keys.p256dh,
            authKey: body.keys.auth,
          },
        });
      } catch (e: unknown) {
        // P2002 = 唯一约束冲突（并发下另一事务先创建了同 endpoint 行）
        // 降级为按 (userId, endpoint) 再查一次并 update keys
        if (e instanceof Error && "code" in e && (e as { code: string }).code === "P2002") {
          const again = await prisma.pushSubscription.findFirst({
            where: { userId, endpoint: body.endpoint },
            select: { id: true },
          });
          if (again) {
            await prisma.pushSubscription.update({
              where: { id: again.id },
              data: { p256dhKey: body.keys.p256dh, authKey: body.keys.auth },
            });
          } else {
            throw e;
          }
        } else {
          throw e;
        }
      }
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