import { NextRequest, NextResponse } from "next/server";
import { apiMsg } from "@/lib/api-messages";
import { runDeliveryOutboxWorker } from "@/lib/delivery/outbox-worker";
import { withRed } from "@/lib/red-metrics";

/**
 * GET /api/cron/deliverable-outbox — 交付 outbox 有界批处理器。
 *
 * CRON_SECRET Bearer 鉴权。建议每 30 秒调用；单次最多 50 条（默认 20），
 * 租约/条件认领负责并发与崩溃恢复，不依赖长驻 Node 进程。
 */
async function getDeliverableOutboxWorker(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "cronSecretNotConfigured"), data: null },
      { status: 500 },
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  const rawLimit = Number.parseInt(new URL(req.url).searchParams.get("limit") ?? "20", 10);
  const limit = Number.isFinite(rawLimit) ? rawLimit : 20;
  try {
    const stats = await runDeliveryOutboxWorker(limit);
    return NextResponse.json({ code: 200, data: stats, message: apiMsg(req, "ok") });
  } catch (error) {
    console.error("[cron deliverable-outbox] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}

export const GET = withRed(getDeliverableOutboxWorker);
