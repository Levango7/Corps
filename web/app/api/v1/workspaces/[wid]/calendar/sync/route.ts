import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext } from "@/lib/auth";
import { syncAllTasks } from "@/lib/calendar/sync";

/**
 * POST /api/v1/workspaces/{wid}/calendar/sync
 * 手动触发同步：将该用户的所有有截止日期的任务同步到所有已连接日历。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });

  try {
    const result = await syncAllTasks(ctx.payload.sub);
    return NextResponse.json({
      code: 200,
      data: {
        syncedConnections: result.syncedConnections,
        success: result.success,
        error: result.error,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "同步失败";
    console.error("[calendar sync] error:", error);
    return NextResponse.json({ code: 500, message }, { status: 500 });
  }
}
