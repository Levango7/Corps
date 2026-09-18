import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";

/**
 * 独立 IM 会话单个成员管理 API（任务 212）
 *
 * DELETE /v1/workspaces/{wid}/conversations/{cid}/members/{uid} — 移除成员
 * PATCH  /v1/workspaces/{wid}/conversations/{cid}/members/{uid} — 更新成员角色
 */

/**
 * DELETE /v1/workspaces/{wid}/conversations/{cid}/members/{uid} — 移除成员
 *
 * 权限：
 *  - owner/admin 可移除其他成员（但不能移除 owner）
 *  - 成员可移除自己（退出会话）
 *
 * 群聊最后一人退出时自动删除会话。
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; cid: string; uid: string }> },
) {
  const { wid, cid, uid } = await params;
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
        const myMembership = await tx.conversationMember.findFirst({
          where: { conversationId: cid, userId, conversation: { workspaceId: wid } },
          select: { id: true, role: true },
        });
        if (!myMembership) return { status: "not_found" as const };

        // 查询目标成员
        const targetMembership = await tx.conversationMember.findFirst({
          where: { conversationId: cid, userId: uid },
          select: { id: true, role: true },
        });
        if (!targetMembership) return { status: "target_not_found" as const };

        // 权限判定：
        // 1. 成员可移除自己（退出）—— uid === userId
        // 2. owner/admin 可移除其他成员，但不能移除 owner
        const isSelf = uid === userId;
        const isManager = myMembership.role === "owner" || myMembership.role === "admin";
        if (!isSelf && !isManager) {
          return { status: "forbidden" as const };
        }
        // 不能移除 owner（owner 只能通过删除会话退出）
        if (targetMembership.role === "owner" && !isSelf) {
          return { status: "cannot_remove_owner" as const };
        }

        // 删除成员记录
        await tx.conversationMember.delete({ where: { id: targetMembership.id } });

        // 如果是 owner 自己退出，需要将会话所有权转让或删除会话
        // 这里选择：owner 自退出时删除整个会话（简化处理，避免无主会话）
        if (targetMembership.role === "owner" && isSelf) {
          await tx.conversation.delete({ where: { id: cid } });
          return { status: "ok" as const, action: "deleted" as const };
        }

        // 检查剩余成员数：最后一人退出时自动删除会话
        const remainingCount = await tx.conversationMember.count({
          where: { conversationId: cid },
        });
        if (remainingCount === 0) {
          await tx.conversation.delete({ where: { id: cid } });
          return { status: "ok" as const, action: "deleted" as const };
        }

        return { status: "ok" as const, action: "removed" as const };
      },
      userId,
    );

    if (result.status === "not_found" || result.status === "target_not_found") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "memberNotFound"), data: null },
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
    if (result.status === "cannot_remove_owner") {
      return NextResponse.json(
        {
          code: 403,
          message: apiMsg(req, "cannotRemoveConversationOwner"),
          data: null,
        },
        { status: 403 },
      );
    }

    return NextResponse.json({ code: 200, data: { action: result.action } });
  } catch (error) {
    console.error("[DELETE conversation member] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/** 更新成员请求体校验（角色变更 / 静音切换，至少提供一个字段） */
const updateMemberSchema = z
  .object({
    role: z.enum(["owner", "admin", "member"]).optional(),
    muted: z.boolean().optional(),
  })
  .refine((data) => data.role !== undefined || data.muted !== undefined, {
    message: "role or muted is required",
  });

/**
 * PATCH /v1/workspaces/{wid}/conversations/{cid}/members/{uid} — 更新成员角色 / 静音状态
 *
 * 两种用途：
 *  1. 静音切换（{ muted: boolean }）：仅允许用户更新自己的静音状态，无需 owner 权限。
 *  2. 角色变更（{ role: "owner" | "admin" | "member" }）：仅 owner 可操作。
 *
 * 角色变更特殊处理：
 *  - 若将他人设为 owner，当前 owner 自动降级为 admin（所有权转让）
 *  - 不能修改自己的角色（owner 通过转让所有权变更，而非直接改自己）
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; cid: string; uid: string }> },
) {
  const { wid, cid, uid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const body = updateMemberSchema.parse(await req.json());
    const userId = ctx.payload.sub;

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        // 静音切换：仅允许用户更新自己的静音状态（自我操作，无需 owner 权限）
        if (body.muted !== undefined) {
          if (uid !== userId) {
            return { status: "forbidden" as const };
          }
          const myMembership = await tx.conversationMember.findFirst({
            where: { conversationId: cid, userId, conversation: { workspaceId: wid } },
            select: { id: true },
          });
          if (!myMembership) return { status: "not_found" as const };
          await tx.conversationMember.update({
            where: { id: myMembership.id },
            data: { muted: body.muted },
          });
          return { status: "ok" as const, transferred: false };
        }

        // 角色变更分支：此时 body.role 必有值（schema refine 保证 role 或 muted 至少一个，muted 分支已 return）
        const newRole = body.role!;

        // 验证当前用户是该会话成员且角色为 owner
        const myMembership = await tx.conversationMember.findFirst({
          where: { conversationId: cid, userId, conversation: { workspaceId: wid } },
          select: { id: true, role: true },
        });
        if (!myMembership) return { status: "not_found" as const };
        if (myMembership.role !== "owner") {
          return { status: "forbidden" as const };
        }

        // 不能修改自己的角色（owner 通过转让所有权变更）
        if (uid === userId) {
          return { status: "cannot_change_self" as const };
        }

        // 查询目标成员
        const targetMembership = await tx.conversationMember.findFirst({
          where: { conversationId: cid, userId: uid },
          select: { id: true, role: true },
        });
        if (!targetMembership) return { status: "target_not_found" as const };

        // 所有权转让：将目标设为 owner，当前 owner 降级为 admin
        if (newRole === "owner") {
          await tx.conversationMember.update({
            where: { id: myMembership.id },
            data: { role: "admin" },
          });
          await tx.conversationMember.update({
            where: { id: targetMembership.id },
            data: { role: "owner" },
          });
          return { status: "ok" as const, transferred: true };
        }

        // 普通角色变更
        await tx.conversationMember.update({
          where: { id: targetMembership.id },
          data: { role: newRole },
        });
        return { status: "ok" as const, transferred: false };
      },
      userId,
    );

    if (result.status === "not_found" || result.status === "target_not_found") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "memberNotFound"), data: null },
        { status: 404 },
      );
    }
    if (result.status === "forbidden") {
      return NextResponse.json(
        {
          code: 403,
          message: apiMsg(req, "onlyOwnerChangeConversationRole"),
          data: null,
        },
        { status: 403 },
      );
    }
    if (result.status === "cannot_change_self") {
      return NextResponse.json(
        { code: 403, message: apiMsg(req, "cannotChangeOwnRole"), data: null },
        { status: 403 },
      );
    }

    return NextResponse.json({
      code: 200,
      data: { transferred: result.transferred },
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
    console.error("[PATCH conversation member] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}