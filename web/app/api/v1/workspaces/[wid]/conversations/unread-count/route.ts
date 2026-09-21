import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { apiMsg } from "@/lib/api-messages";

/**
 * 未读消息计数 API
 *
 * GET /v1/workspaces/{wid}/conversations/unread-count
 *
 * 返回当前用户在所有会话中的未读消息总数及按会话分解的列表。
 * 未读定义：createdAt > member.lastReadAt 且 authorId != userId。
 * lastReadAt 为 null 时，统计所有非自己发送的消息。
 */

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string }> },
) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  const userId = ctx.payload.sub;

  try {
    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        // 1. 查找用户参与的所有会话 + lastReadAt
        const memberships = await tx.conversationMember.findMany({
          where: { userId },
          select: { conversationId: true, lastReadAt: true },
        });

        // 2. 批量计算每个会话的未读数
        const byConversation = await Promise.all(
          memberships.map(async (m) => {
            const unreadCount = m.lastReadAt
              ? await tx.message.count({
                  where: {
                    conversationId: m.conversationId,
                    createdAt: { gt: m.lastReadAt },
                    authorId: { not: userId },
                  },
                })
              : await tx.message.count({
                  where: {
                    conversationId: m.conversationId,
                    authorId: { not: userId },
                  },
                });
            return { conversationId: m.conversationId, unreadCount };
          }),
        );

        // 3. 过滤掉 unreadCount=0 的会话，计算总数
        const filtered = byConversation.filter((c) => c.unreadCount > 0);
        const totalUnread = filtered.reduce(
          (sum, c) => sum + c.unreadCount,
          0,
        );

        return { totalUnread, byConversation: filtered };
      },
      userId,
    );

    return NextResponse.json({ code: 200, data: result });
  } catch (error) {
    console.error("[GET unread-count] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}