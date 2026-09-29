import { NextRequest, NextResponse } from "next/server";
import { reconcileCalendarSync } from "@/lib/calendar/reconcile";
import { apiMsg } from "@/lib/api-messages";

/**
 * GET /api/cron/calendar-reconcile — 日历同步对账 cron job
 *
 * 三段对账：error 状态连接重置为 idle、超过 7 天未同步的连接记警告、
 * 删除 task 已不存在的 task_calendar_events 映射行。
 * 仅回收本地映射行；补偿删除失败产生的外部孤儿事件（Google/Outlook 侧）不在此范围。
 *
 * 鉴权：CRON_SECRET Bearer（与 /api/cron/recycle-cleanup 同模式）。
 * 调度：entrypoint-cron.sh 每周日 05:00 一次；对账非实时需求，低频足够。
 *
 * 响应：{ code: 200, data: { resetErrorConnections, staleConnections, orphanMappingsRemoved, scannedConnections } }
 */
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
    const result = await reconcileCalendarSync();
    return NextResponse.json({ code: 200, data: result });
  } catch (error) {
    console.error("[cron calendar-reconcile] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}
