import { NextRequest, NextResponse } from "next/server";
import { runWithAuthOp } from "@/lib/auth";
import { apiMsg } from "@/lib/api-messages";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { sendPush } from "@/lib/web-push";

/**
 * GET /api/cron/ai-push-web — AI 推送 Web Push 发送器（每 15 分钟定时调用）
 *
 * 查询未读的 AiPushRecord（read=false，最近 24 小时内创建），对每条 record
 * 查对应用户的 PushSubscription，调用 sendPush 发送 Web Push 通知。
 * 发送成功后标记 record.read=true，避免重复推送。
 *
 * 逻辑：
 *  1. CRON_SECRET Bearer 鉴权（与 /api/cron/ai-push-runner 同模式）
 *  2. runWithAuthOp("cron") 跨工作区查询未读 AiPushRecord
 *  3. 对每条 record 查对应用户的 PushSubscription（用户级，无 RLS 限制）
 *  4. 调用 sendPush 发送 Web Push（payload: title/summary/url）
 *  5. 发送成功后批量标记 record.read=true（避免重复推送）
 *  6. 返回 { checked, sent, skipped }
 *
 * 鉴权：CRON_SECRET Bearer（与 /api/cron/* 路由约定一致）。
 * 调度建议：每 15 分钟调用一次（entrypoint-cron.sh 中配置）。
 */

/** 未读推送查询窗口：最近 24 小时 */
const LOOKBACK_MS = 24 * 60 * 60 * 1000;
/** summary 截断长度（Web Push payload body 上限） */
const SUMMARY_MAX = 100;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "cronSecretNotConfigured"), data: null },
      { status: 500 },
    );
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  try {
    const since = new Date(Date.now() - LOOKBACK_MS);

    // 1) 跨工作区查询未读 AiPushRecord（cron 逃生口绕过 RLS）
    //    加 take: 100 限制单次 cron 处理量，避免长事务与超时
    const records = await runWithAuthOp("cron", async (tx) => {
      return tx.aiPushRecord.findMany({
        where: { read: false, createdAt: { gte: since } },
        select: {
          id: true,
          userId: true,
          workspaceId: true,
          title: true,
          summary: true,
        },
        take: 100,
      });
    });

    // 2) 批量查询所有相关用户的 PushSubscription（消除 N+1 查询）
    //    一次性按 userId in (...) 查询，再按 userId 分组建 Map
    const userIds = Array.from(new Set(records.map((r) => r.userId)));
    const allSubscriptions =
      userIds.length > 0
        ? await prisma.pushSubscription.findMany({
            where: { userId: { in: userIds } },
            select: {
              userId: true,
              endpoint: true,
              p256dhKey: true,
              authKey: true,
            },
          })
        : [];
    const subsByUser = new Map<string, typeof allSubscriptions>();
    for (const sub of allSubscriptions) {
      const list = subsByUser.get(sub.userId);
      if (list) {
        list.push(sub);
      } else {
        subsByUser.set(sub.userId, [sub]);
      }
    }

    let sent = 0;
    let skipped = 0;
    const sentRecordIds: string[] = [];

    // 3) 逐条发送 Web Push（HTTP 调用，在事务外执行）
    for (const record of records) {
      const subscriptions = subsByUser.get(record.userId) ?? [];

      // 用户无任何 Web Push 订阅：跳过（不标记 read，保留站内通知）
      if (subscriptions.length === 0) {
        skipped++;
        continue;
      }

      const payload = {
        title: record.title,
        body: record.summary.slice(0, SUMMARY_MAX),
        url: `/w/${record.workspaceId}/ai-tools`,
      };

      // 对该用户的每个订阅尝试发送，任一成功即视为已推送
      const results = await Promise.all(
        subscriptions.map((sub) =>
          sendPush(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dhKey, auth: sub.authKey },
            },
            payload,
          ),
        ),
      );

      if (results.some((ok) => ok)) {
        sent++;
        sentRecordIds.push(record.id);
      } else {
        skipped++;
      }
    }

    // 4) 批量标记已推送的 record 为已读（避免重复推送）
    if (sentRecordIds.length > 0) {
      await runWithAuthOp("cron", async (tx) => {
        await tx.aiPushRecord.updateMany({
          where: { id: { in: sentRecordIds } },
          data: { read: true },
        });
      }).catch((e: unknown) => {
        logger.warn("[cron ai-push-web] 标记 read=true 失败", {
          error: e instanceof Error ? e.message : String(e),
          count: sentRecordIds.length,
        });
      });
    }

    return NextResponse.json({
      code: 200,
      data: { checked: records.length, sent, skipped },
    });
  } catch (error) {
    logger.error("[cron ai-push-web] error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}