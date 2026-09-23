import { NextRequest, NextResponse } from "next/server";
import { runWithAuthOp } from "@/lib/auth";
import { apiMsg } from "@/lib/api-messages";

/**
 * POST /api/cron/recycle-cleanup — 回收站自动清理 cron job
 *
 * 删除 deletedAt < now - retentionDays 的 Task 和 Document（永久删除）。
 * 保留期由环境变量 RECYCLE_RETENTION_DAYS 控制（默认 30 天）。
 *
 * 鉴权：CRON_SECRET Bearer（与 /api/cron/weekly-digest 同模式）。
 * 调度建议：每日 03:00 UTC 运行一次。
 *
 * 响应：{ code: 200, data: { deletedTasks: number, deletedDocuments: number, retentionDays: number } }
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ code: 500, message: apiMsg(req, "cronSecretNotConfigured"), data: null }, { status: 500 });
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });
  }

  // 保留期（天）：环境变量 RECYCLE_RETENTION_DAYS，默认 30
  const retentionDays = Number(process.env.RECYCLE_RETENTION_DAYS) || 30;
  const cutoff = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - retentionDays);

  try {
    const result = await runWithAuthOp("cron", async (tx) => {
      const deletedTasks = await tx.task.deleteMany({
        where: { deletedAt: { lt: cutoff } },
      });
      const deletedDocuments = await tx.document.deleteMany({
        where: { deletedAt: { lt: cutoff } },
      });
      return {
        deletedTasks: deletedTasks.count,
        deletedDocuments: deletedDocuments.count,
        retentionDays,
      };
    });

    return NextResponse.json({ code: 200, data: result });
  } catch (error) {
    console.error("[cron recycle-cleanup] error:", error);
    return NextResponse.json({ code: 500, message: apiMsg(req, "internalError"), data: null }, { status: 500 });
  }
}