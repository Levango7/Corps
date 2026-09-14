import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";

/**
 * 独立 IM 会话详情 API（任务 212）
 *
 * GET    /v1/workspaces/{wid}/conversations/{cid} — 会话详情
 * PATCH  /v1/workspaces/{wid}/conversations/{cid} — 更新会话（owner/admin）
 * DELETE /v1/workspaces/{wid}/conversations/{cid} — 删除/退出会话
 */

/** 用户基本信息投影 */
const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  image: true,
} as const;

/** 最近消息加载条数 */
const RECENT_MESSAGES_TAKE = 50;

/**
 * GET /v1/workspaces/{wid}/conversations/{cid} — 会话详情
 *
 * 验证当前用户是该会话成员，返回会话信息（含成员列表、最近 50 条消息）。
 */
export async function GET(
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
    const userId = ctx.payload.sub;
    const conversation = await runWithWorkspace(
      wid,
      async (tx) => {
        // 验证当前用户是该会话成员（同时确认会话属于本工作区）
        const membership = await tx.conversationMember.findFirst({
          where: { conversationId: cid, userId, conversation: { workspaceId: wid } },
          select: { id: true, role: true, lastReadAt: true, muted: true },
        });
        if (!membership) return null;

        return tx.conversation.findUnique({
          where: { id: cid },
          include: {
            members: {
              include: { user: { select: USER_SELECT } },
              orderBy: { joinedAt: "asc" },
            },
            messages: {
              orderBy: { createdAt: "desc" },
              take: RECENT_MESSAGES_TAKE,
              include: {
                author: { select: { id: true, name: true, image: true } },
              },
            },
          },
        });
      },
      userId,
    );

    if (!conversation) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "conversationNotFound"), data: null },
        { status: 404 },
      );
    }

    // messages 按 desc 取出后反转为正序时间线
    const data = {
      ...conversation,
      messages: [...conversation.messages].reverse(),
    };
    return NextResponse.json({ code: 200, data });
  } catch (error) {
    console.error("[GET conversation] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/** 更新会话请求体校验 */
const updateConversationSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  avatar: z.string().max(10000).optional(),
  description: z.string().max(500).optional(),
});

/**
 * PATCH /v1/workspaces/{wid}/conversations/{cid} — 更新会话
 *
 * 仅 owner/admin 可操作。请求体：{ title?, avatar?, description? }
 */
export async function PATCH(
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
    const body = updateConversationSchema.parse(await req.json());
    const userId = ctx.payload.sub;

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        // 验证当前用户是该会话成员且角色为 owner/admin
        const membership = await tx.conversationMember.findFirst({
          where: { conversationId: cid, userId, conversation: { workspaceId: wid } },
          select: { role: true },
        });
        if (!membership) return { status: "not_found" as const };
        if (membership.role !== "owner" && membership.role !== "admin") {
          return { status: "forbidden" as const };
        }

        // 仅更新传入的字段（Prisma 自动跳过 undefined）
        const updated = await tx.conversation.update({
          where: { id: cid },
          data: {
            ...(body.title !== undefined ? { title: body.title } : {}),
            ...(body.avatar !== undefined ? { avatar: body.avatar } : {}),
            ...(body.description !== undefined ? { description: body.description } : {}),
          },
          include: {
            members: {
              include: { user: { select: USER_SELECT } },
            },
          },
        });
        return { status: "ok" as const, conversation: updated };
      },
      userId,
    );

    if (result.status === "not_found") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "conversationNotFound"), data: null },
        { status: 404 },
      );
    }
    if (result.status === "forbidden") {
      return NextResponse.json(
        {
          code: 403,
          message: apiMsg(req, "onlyOwnerAdminManageConversation"),
          data: null,
        },
        { status: 403 },
      );
    }

    return NextResponse.json({ code: 200, data: result.conversation });
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
    console.error("[PATCH conversation] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * DELETE /v1/workspaces/{wid}/conversations/{cid} — 删除/退出会话
 *
 * - owner：删除整个会话（级联删除成员和消息）
 * - 普通成员：退出会话（删除自己的 ConversationMember）
 * - 群聊最后一人退出时自动删除会话
 */
export async function DELETE(
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
    const userId = ctx.payload.sub;
    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        // 验证当前用户是该会话成员
        const membership = await tx.conversationMember.findFirst({
          where: { conversationId: cid, userId, conversation: { workspaceId: wid } },
          select: { id: true, role: true },
        });
        if (!membership) return { status: "not_found" as const };

        // owner 直接删除整个会话（级联删除成员和消息）
        if (membership.role === "owner") {
          await tx.conversation.delete({ where: { id: cid } });
          return { status: "ok" as const, action: "deleted" as const };
        }

        // 普通成员：退出会话（删除自己的成员记录）
        await tx.conversationMember.delete({ where: { id: membership.id } });

        // 检查剩余成员数：最后一人退出时自动删除会话
        const remainingCount = await tx.conversationMember.count({
          where: { conversationId: cid },
        });
        if (remainingCount === 0) {
          await tx.conversation.delete({ where: { id: cid } });
          return { status: "ok" as const, action: "deleted" as const };
        }

        return { status: "ok" as const, action: "left" as const };
      },
      userId,
    );

    if (result.status === "not_found") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "conversationNotFound"), data: null },
        { status: 404 },
      );
    }

    return NextResponse.json({ code: 200, data: { action: result.action } });
  } catch (error) {
    console.error("[DELETE conversation] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}