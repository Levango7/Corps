import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContextV2, runWithWorkspace } from "@/lib/auth";
import { authFailure } from "@/lib/auth-response";
import { apiMsg } from "@/lib/api-messages";

/** 任务同步状态响应 */
interface TaskSyncStatus {
  /** 是否已同步到任意日历 */
  synced: boolean;
  /** 同步的 provider 列表（如 ["google"]） */
  providers: string[];
  /** 最后同步时间 */
  lastSyncedAt: string | null;
  /** 是否有同步失败 */
  hasError: boolean;
}

/**
 * GET /api/v1/workspaces/{wid}/tasks/{id}/calendar-sync
 * 获取任务的日历同步状态（用于任务详情页 CalendarSyncBadge）。
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string }> },
) {
  const { wid, id } = await params;
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
    // 查询该任务的所有事件映射 + 对应连接的 provider + 同步状态
    // （task_calendar_events 受 FORCE RLS，必须经 GUC 事务读取，否则加固模式静默空）
    const events = await runWithWorkspace(
      wid,
      (tx) =>
        tx.taskCalendarEvent.findMany({
          where: { taskId: id },
          select: {
            lastSyncedAt: true,
            connection: {
              select: { provider: true, syncStatus: true },
            },
          },
        }),
      ctx.payload.sub,
    );

    const providers = events.map((e) => e.connection.provider);
    const lastSyncedAt =
      events.length > 0
        ? events
            .reduce(
              (latest, e) => (e.lastSyncedAt > latest ? e.lastSyncedAt : latest),
              events[0].lastSyncedAt,
            )
            .toISOString()
        : null;
    const hasError = events.some((e) => e.connection.syncStatus === "error");

    const status: TaskSyncStatus = {
      synced: events.length > 0,
      providers,
      lastSyncedAt,
      hasError,
    };

    return NextResponse.json({ code: 200, data: status });
  } catch (error) {
    console.error("[task calendar-sync] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}
