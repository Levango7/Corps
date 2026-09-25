import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { apiMsg } from "@/lib/api-messages";

/**
 * 独立 IM 在线用户 API（任务 212）
 *
 * GET /v1/workspaces/{wid}/im/online — 在线用户列表
 */

/** 在线判定窗口：最近 5 分钟内有心跳记录视为在线 */
const ONLINE_WINDOW_MS = 5 * 60 * 1000;

/**
 * GET /v1/workspaces/{wid}/im/online — 在线用户列表
 *
 * 查询当前工作区中在独立 IM 会话中在线的用户
 * （ChatPresence where conversationId != null AND lastSeen > now - 5min）。
 *
 * 响应：{ code: 200, data: { userIds: string[], total: number } }
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const userId = ctx.payload.sub;
    const onlineThreshold = new Date(Date.now() - ONLINE_WINDOW_MS);

    const presences = await runWithWorkspace(
      wid,
      async (tx) => {
        // 查询独立 IM 会话中最近 5 分钟活跃的用户
        // conversationId 非空限定为独立 IM（排除任务内聊天）
        // conversation.workspaceId = wid 限定工作区
        return tx.chatPresence.findMany({
          where: {
            conversationId: { not: null },
            lastSeen: { gt: onlineThreshold },
            conversation: { workspaceId: wid },
          },
          select: { userId: true, lastSeen: true },
          orderBy: { lastSeen: "desc" },
        });
      },
      userId,
    );

    // 去重（同一用户可能在多个会话中有在线记录，取最近活跃时间）
    const userMap = new Map<string, Date>();
    for (const p of presences) {
      const existing = userMap.get(p.userId);
      if (!existing || p.lastSeen > existing) {
        userMap.set(p.userId, p.lastSeen);
      }
    }

    const userIds = Array.from(userMap.entries())
      .sort((a, b) => (a[1] < b[1] ? 1 : -1))
      .map(([uid, lastSeen]) => ({ userId: uid, lastSeen: lastSeen.toISOString() }));

    return NextResponse.json({
      code: 200,
      data: { items: userIds, total: userIds.length },
    });
  } catch (error) {
    console.error("[GET im online] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
