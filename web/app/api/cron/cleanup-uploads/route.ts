import { NextRequest, NextResponse } from "next/server";
import { cleanupOrphanUploads } from "@/lib/uploads-cleanup";

/**
 * GET /api/cron/cleanup-uploads — IM 附件孤儿文件清理（审计 P2）。
 *
 * 对比 web/uploads/ 与 message_attachments 的 url 引用，删除无记录引用的
 * 磁盘文件。本地 E2E 已实证遗留 15 个孤儿 PDF；生产长期运行磁盘单调增长。
 *
 * 鉴权：CRON_SECRET Bearer（与 /api/cron/due-reminders 同模式）。
 * 调度建议：每周一次即可（孤儿无害，仅占空间）。
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ code: 500, message: "CRON_SECRET not configured" }, { status: 500 });
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });
  }

  try {
    const { deleted, kept } = await cleanupOrphanUploads();
    return NextResponse.json({ code: 200, data: { deleted, kept } });
  } catch (error) {
    console.error("[cron cleanup-uploads] error:", error);
    return NextResponse.json({ code: 500, message: "Internal server error" }, { status: 500 });
  }
}
