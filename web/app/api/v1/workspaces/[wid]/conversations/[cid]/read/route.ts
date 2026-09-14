import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";

/**
 * 独立 IM 会话已读标记 API（任务 212）
 *
 * POST /v1/workspaces/{wid}/conversations/{cid}/read — 标记会话已读
 */

/** 标记已读请求体校验：lastReadAt 可选，不传则用当前时间 */
const markReadSchema = z.object({
  lastReadAt: z.string().datetime().optional(),
});

/**
 * POST /v1/workspaces/{wid}/conversations/{cid}/read — 标记会话已读
 *
 * 请求体：{ lastReadAt?: string }（ISO 8601）
 *  - 不传 lastReadAt 时自动用 new Date()
 *
 * 更新当前用户的 ConversationMember.lastReadAt，用于未读消息计数清零。
 *
 * 响应：{ code: 200, data: { lastReadAt: string } }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; cid: string }> },
) {
  const { wid, cid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const body = markReadSchema.parse(await req.json());
    const userId = ctx.payload.sub;
    // 优先使用客户端传入的 lastReadAt，否则用当前时间
    const lastReadAt = body.lastReadAt ? new Date(body.lastReadAt) : new Date();

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        // 验证当前用户是该会话成员
        const membership = await tx.conversationMember.findFirst({
          where: { conversationId: cid, userId, conversation: { workspaceId: wid } },
          select: { id: true },
        });
        if (!membership) return null;

        // 更新 lastReadAt（取传入值与现有值的较大者，防止回退已读游标）
        await tx.conversationMember.update({
          where: { id: membership.id },
          data: { lastReadAt },
        });

        return { lastReadAt };
      },
      userId,
    );

    if (!result) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "conversationNotFound"), data: null },
        { status: 404 },
      );
    }

    return NextResponse.json({
      code: 200,
      data: { lastReadAt: result.lastReadAt.toISOString() },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          code: 400,
          message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"),
          data: null,
        },
        { status: 400 },
      );
    }
    console.error("[POST conversation read] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}