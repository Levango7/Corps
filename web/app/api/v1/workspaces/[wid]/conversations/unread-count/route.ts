import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContextV2, runWithWorkspace } from "@/lib/auth";
import { authFailure } from "@/lib/auth-response";
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

export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
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

  const userId = ctx.payload.sub;

  try {
    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        // 1. 查找用户参与的所有会话 + lastReadAt
        const memberships = await tx.conversationMember.findMany({
          where: { userId, conversation: { workspaceId: wid } },
          select: { conversationId: true, lastReadAt: true },
        });

        if (memberships.length === 0) {
          return { totalUnread: 0, byConversation: [] };
        }

        // 2. 批量计算每个会话的未读数（消除 N+1：单次 raw SQL 聚合查询）
        //    uuid 列须显式 cast 成 uuid[]：JS 数组会被绑成 text，
        //    IN (text…) 与 uuid 列比较在 PG 直接 42883 operator does not exist
        const conversationIds = memberships.map((m) => m.conversationId);
        const unreadResults = await tx.$queryRaw<
          { conversation_id: string; unread_count: bigint }[]
        >`
          SELECT m.conversation_id, COUNT(*)::bigint AS unread_count
          FROM messages m
          JOIN conversation_members cm
            ON m.conversation_id = cm.conversation_id
           AND cm.user_id = ${userId}::uuid
          WHERE m.conversation_id = ANY(${conversationIds}::uuid[])
            AND m.author_id IS DISTINCT FROM ${userId}::uuid
            AND (cm.last_read_at IS NULL OR m.created_at > cm.last_read_at)
          GROUP BY m.conversation_id`;
        const unreadMap = new Map<string, number>(
          unreadResults.map((r) => [r.conversation_id, Number(r.unread_count)]),
        );

        // 3. 过滤掉 unreadCount=0 的会话，计算总数
        const byConversation = conversationIds
          .map((cid) => ({
            conversationId: cid,
            unreadCount: unreadMap.get(cid) ?? 0,
          }))
          .filter((c) => c.unreadCount > 0);
        const totalUnread = byConversation.reduce((sum, c) => sum + c.unreadCount, 0);

        return { totalUnread, byConversation };
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
