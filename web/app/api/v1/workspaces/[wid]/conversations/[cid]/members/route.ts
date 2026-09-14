import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";

/**
 * 独立 IM 会话成员管理 API（任务 212）
 *
 * GET  /v1/workspaces/{wid}/conversations/{cid}/members — 成员列表
 * POST /v1/workspaces/{wid}/conversations/{cid}/members — 添加成员（owner/admin）
 */

/** 用户基本信息投影 */
const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  image: true,
} as const;

/**
 * GET /v1/workspaces/{wid}/conversations/{cid}/members — 成员列表
 *
 * 验证当前用户是该会话成员，返回所有成员（含 user 基本信息、role、joinedAt、lastReadAt）。
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
    const members = await runWithWorkspace(
      wid,
      async (tx) => {
        // 验证当前用户是该会话成员
        const membership = await tx.conversationMember.findFirst({
          where: { conversationId: cid, userId, conversation: { workspaceId: wid } },
          select: { id: true },
        });
        if (!membership) return null;

        return tx.conversationMember.findMany({
          where: { conversationId: cid },
          include: { user: { select: USER_SELECT } },
          orderBy: { joinedAt: "asc" },
        });
      },
      userId,
    );

    if (members === null) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "conversationNotFound"), data: null },
        { status: 404 },
      );
    }

    return NextResponse.json({
      code: 200,
      data: {
        items: members.map((m) => ({
          id: m.id,
          userId: m.userId,
          role: m.role,
          joinedAt: m.joinedAt,
          lastReadAt: m.lastReadAt,
          muted: m.muted,
          user: m.user,
        })),
        total: members.length,
      },
    });
  } catch (error) {
    console.error("[GET conversation members] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/** 添加成员请求体校验 */
const addMembersSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(100),
});

/**
 * POST /v1/workspaces/{wid}/conversations/{cid}/members — 添加成员
 *
 * 仅 owner/admin 可操作。请求体：{ userIds: string[] }
 * 已存在的成员跳过（createMany skipDuplicates）。
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
    const body = addMembersSchema.parse(await req.json());
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

        // 查询已存在的成员，计算实际新增数
        const existing = await tx.conversationMember.findMany({
          where: { conversationId: cid, userId: { in: body.userIds } },
          select: { userId: true },
        });
        const existingIds = new Set(existing.map((e) => e.userId));
        const newUserIds = body.userIds.filter((uid) => !existingIds.has(uid));

        if (newUserIds.length > 0) {
          // 批量创建新成员（role=member）
          await tx.conversationMember.createMany({
            data: newUserIds.map((uid) => ({
              conversationId: cid,
              userId: uid,
              role: "member",
            })),
            skipDuplicates: true,
          });
        }

        return {
          status: "ok" as const,
          added: newUserIds.length,
          skipped: existingIds.size,
        };
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

    return NextResponse.json({
      code: 201,
      data: { added: result.added, skipped: result.skipped },
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
    console.error("[POST conversation members] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}