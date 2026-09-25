import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";
import { imManager } from "@/lib/im/ws-server";
import type { ServerMessage } from "@/lib/im/types";

/**
 * 独立 IM 单条消息 API（任务 213）
 *
 * PATCH  /v1/workspaces/{wid}/conversations/{cid}/messages/{mid} — 编辑消息
 * DELETE /v1/workspaces/{wid}/conversations/{cid}/messages/{mid} — 撤回消息
 */

/** 作者基本信息投影 */
const AUTHOR_SELECT = {
  id: true,
  name: true,
  email: true,
  image: true,
} as const;

/** 消息查询 include：作者 + 附件 + 被回复消息（含其作者） */
const MESSAGE_INCLUDE = {
  author: { select: AUTHOR_SELECT },
  attachments: true,
  replyTo: {
    include: { author: { select: { id: true, name: true, image: true } } },
  },
} as const;

/** 编辑/撤回时间窗口（毫秒）：5 分钟（与 im/messages/[id] 端点统一） */
const EDIT_WINDOW_MS = 5 * 60 * 1000;

/** 编辑消息请求体校验 */
const editMessageSchema = z.object({
  body: z.string().min(1).max(10000),
});

/**
 * PATCH /v1/workspaces/{wid}/conversations/{cid}/messages/{mid} — 编辑消息
 *
 * 权限：仅消息作者可编辑自己的消息，且消息未被撤回，5 分钟内可编辑。
 * 更新 body + editedAt = now()，WebSocket 广播 edit 事件。
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; cid: string; mid: string }> },
) {
  const { wid, cid, mid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const body = editMessageSchema.parse(await req.json());
    const userId = ctx.payload.sub;

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        // 验证当前用户是该会话成员
        const membership = await tx.conversationMember.findFirst({
          where: { conversationId: cid, userId, conversation: { workspaceId: wid } },
          select: { id: true },
        });
        if (!membership) return { status: "not_member" as const };

        // 查询消息（确认属于该会话）
        const message = await tx.message.findFirst({
          where: { id: mid, conversationId: cid, workspaceId: wid },
          select: { id: true, authorId: true, revokedAt: true, createdAt: true },
        });
        if (!message) return { status: "not_found" as const };

        // 仅作者可编辑
        if (message.authorId !== userId) {
          return { status: "forbidden_edit" as const };
        }
        // 已撤回消息不可编辑
        if (message.revokedAt) {
          return { status: "revoked" as const };
        }
        // 5 分钟时间窗口校验
        if (Date.now() - message.createdAt.getTime() > EDIT_WINDOW_MS) {
          return { status: "time_exceeded" as const };
        }

        // 更新 body + editedAt
        const updated = await tx.message.update({
          where: { id: mid },
          data: { body: body.body, editedAt: new Date() },
          include: MESSAGE_INCLUDE,
        });

        return { status: "ok" as const, message: updated };
      },
      userId,
    );

    if (result.status === "not_member") {
      return NextResponse.json(
        { code: 403, message: apiMsg(req, "notConversationMember"), data: null },
        { status: 403 },
      );
    }
    if (result.status === "not_found") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "messageNotFound"), data: null },
        { status: 404 },
      );
    }
    if (result.status === "forbidden_edit") {
      return NextResponse.json(
        { code: 403, message: apiMsg(req, "canOnlyEditOwnMessage"), data: null },
        { status: 403 },
      );
    }
    if (result.status === "revoked") {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "messageRevoked"), data: null },
        { status: 400 },
      );
    }
    if (result.status === "time_exceeded") {
      return NextResponse.json(
        { code: 403, message: apiMsg(req, "revokeTimeExceeded"), data: null },
        { status: 403 },
      );
    }

    // WebSocket 广播编辑事件给会话其他订阅者（排除发送者）
    const editMsg: ServerMessage = {
      type: "edit",
      conversationId: cid,
      messageId: mid,
      body: body.body,
      editedAt: result.message.editedAt!.toISOString(),
    };
    imManager.broadcastToConversation(cid, editMsg, userId);

    return NextResponse.json({ code: 200, data: result.message });
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
    console.error("[PATCH message] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * DELETE /v1/workspaces/{wid}/conversations/{cid}/messages/{mid} — 撤回消息
 *
 * 权限：
 *  - 消息作者：5 分钟内可撤回
 *  - 会话 owner/admin：可撤回他人消息，不受时间限制
 *
 * 更新 revokedAt + revokedBy，WebSocket 广播 revoke 事件。
 * 返回的消息 body 已清空。
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; cid: string; mid: string }> },
) {
  const { wid, cid, mid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const userId = ctx.payload.sub;

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        // 验证当前用户是该会话成员（含角色，用于管理员撤回判断）
        const membership = await tx.conversationMember.findFirst({
          where: { conversationId: cid, userId, conversation: { workspaceId: wid } },
          select: { id: true, role: true },
        });
        if (!membership) return { status: "not_member" as const };

        // 查询消息（确认属于该会话）
        const message = await tx.message.findFirst({
          where: { id: mid, conversationId: cid, workspaceId: wid },
          select: { id: true, authorId: true, revokedAt: true, createdAt: true },
        });
        if (!message) return { status: "not_found" as const };

        // 已撤回消息不可重复撤回
        if (message.revokedAt) {
          return { status: "revoked" as const };
        }

        const isAuthor = message.authorId === userId;
        const isAdmin = membership.role === "owner" || membership.role === "admin";

        // 权限校验：作者或管理员可撤回
        if (!isAuthor && !isAdmin) {
          return { status: "forbidden_revoke" as const };
        }

        // 撤回时间限制：作者 5 分钟内，管理员不受限
        if (isAuthor && !isAdmin) {
          const elapsed = Date.now() - message.createdAt.getTime();
          if (elapsed > EDIT_WINDOW_MS) {
            return { status: "time_exceeded" as const };
          }
        }

        // 撤回：更新 revokedAt + revokedBy
        const now = new Date();
        const updated = await tx.message.update({
          where: { id: mid },
          data: { revokedAt: now, revokedBy: userId },
          include: MESSAGE_INCLUDE,
        });

        return { status: "ok" as const, message: updated, revokedAt: now };
      },
      userId,
    );

    if (result.status === "not_member") {
      return NextResponse.json(
        { code: 403, message: apiMsg(req, "notConversationMember"), data: null },
        { status: 403 },
      );
    }
    if (result.status === "not_found") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "messageNotFound"), data: null },
        { status: 404 },
      );
    }
    if (result.status === "revoked") {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "messageRevoked"), data: null },
        { status: 400 },
      );
    }
    if (result.status === "forbidden_revoke") {
      return NextResponse.json(
        { code: 403, message: apiMsg(req, "forbidden"), data: null },
        { status: 403 },
      );
    }
    if (result.status === "time_exceeded") {
      return NextResponse.json(
        { code: 403, message: apiMsg(req, "revokeTimeExceeded"), data: null },
        { status: 403 },
      );
    }

    // WebSocket 广播撤回事件给会话其他订阅者（排除操作者）
    const revokeMsg: ServerMessage = {
      type: "revoke",
      conversationId: cid,
      messageId: mid,
      revokedAt: result.revokedAt.toISOString(),
    };
    imManager.broadcastToConversation(cid, revokeMsg, userId);

    // 返回的消息 body 已清空（撤回后不返回原内容）
    const sanitizedMessage = { ...result.message, body: "" };

    return NextResponse.json({ code: 200, data: sanitizedMessage });
  } catch (error) {
    console.error("[DELETE message] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
