import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { emitChatEvent } from "@/lib/chat-events";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";

/**
 * PATCH /v1/workspaces/{wid}/tasks/{id}/messages/read — 批量标记消息已读
 *
 * 请求体：{ messageIds: string[] }
 *  - messageIds: 要标记已读的消息 ID 列表（最多 100 条）
 *
 * 响应：{ code: 200, data: { marked: number } }
 *  - marked: 实际新增的已读记录数（已读过的消息不重复计数）
 *
 * 行为：
 *  - 对每条消息 upsert MessageRead 记录（idempotent，重复标记不报错）
 *  - 排除自己发送的消息（不需要标记自己的消息已读）
 *  - 对每条新标记的已读，emit SSE `{ type: "read", messageId, userId, readAt }` 事件
 *    通知发送者的客户端更新已读回执
 *
 * 认证：从 cookie 读取 access_token，验证工作区成员身份。
 */

const markReadSchema = z.object({
  messageIds: z.array(z.string().uuid()).min(1).max(100),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string }> },
) {
  const { wid, id } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const validated = markReadSchema.parse(await req.json());
    const userId = ctx.payload.sub;

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        // 查询这些消息中属于本任务且不是自己发送的（防跨租户 + 排除自己的消息）
        const messages = await tx.message.findMany({
          where: {
            id: { in: validated.messageIds },
            taskId: id,
            task: { workspaceId: wid },
            authorId: { not: userId },
          },
          select: { id: true },
        });

        if (messages.length === 0) return { marked: 0, newMessageIds: [] as string[] };

        // 先查询已存在的已读记录，计算实际新增数（createMany skipDuplicates 不返回 count）
        const existingReads = await tx.messageRead.findMany({
          where: {
            messageId: { in: messages.map((m) => m.id) },
            userId,
          },
          select: { messageId: true },
        });
        const existingIds = new Set(existingReads.map((r) => r.messageId));
        const newMessages = messages.filter((m) => !existingIds.has(m.id));

        if (newMessages.length === 0) return { marked: 0, newMessageIds: [] as string[] };

        // 批量创建新增的已读记录（已过滤已存在，无需 skipDuplicates）
        const now = new Date();
        await tx.messageRead.createMany({
          data: newMessages.map((m) => ({
            messageId: m.id,
            userId,
            readAt: now,
          })),
        });

        // marked = 实际新增的已读记录数（已读过的消息不重复计数）
        // newMessageIds = 实际新标记的消息 ID（供事务外 emit SSE，M5）
        return { marked: newMessages.length, newMessageIds: newMessages.map((m) => m.id) };
      },
      userId,
    );

    // emit SSE 事件：通知发送者客户端更新已读回执
    // M5 修正：只对实际新标记已读的消息 emit，而非所有请求的 messageIds
    // （已读过的消息重复 emit 会导致发送者客户端收到多余的已读回执）
    const readAtISO = new Date().toISOString();
    for (const messageId of result.newMessageIds) {
      emitChatEvent(id, { type: "read", messageId, userId, readAt: readAtISO });
    }

    return NextResponse.json({ code: 200, data: { marked: result.marked } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"), data: null },
        { status: 400 },
      );
    }
    console.error("Mark read error:", error);
    return NextResponse.json({ code: 500, message: apiMsg(req, "internalError"), data: null }, { status: 500 });
  }
}
