import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContextV2 } from "@/lib/auth";
import { syncAllTasks } from "@/lib/calendar/sync";
import { apiMsg } from "@/lib/api-messages";
import { authFailure } from "@/lib/auth-response";
import { withRed } from "@/lib/red-metrics";

/**
 * POST /api/v1/workspaces/{wid}/calendar/sync
 * 手动触发同步：将该用户的所有有截止日期的任务同步到所有已连接日历。
 */
async function postCalendarSync(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string }> },
) {
  const { wid } = await params;
  const ctx = await getWorkspaceContextV2(req, wid);
  if (!ctx)
    // V2 契约上从不返回 null（见 lib/auth.ts 的 WorkspaceContextV2 文档：
    // "调用方遇到 null 应按 500 处理（fail-closed，不可当作 401 重试）"）。
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  if (!ctx.ok) return authFailure(ctx, req);

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
    console.error("[calendar sync] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "calendarSyncFailed") },
      { status: 500 },
    );
  }
}

// RED 指标接线：Rate/Duration 通过 withRed 包装器自动记录
export const POST = withRed(postCalendarSync);
