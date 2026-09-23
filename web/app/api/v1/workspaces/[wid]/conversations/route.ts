import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";
import { Prisma } from "@prisma/client";

/**
 * 独立 IM 会话 API（任务 212）
 *
 * GET  /v1/workspaces/{wid}/conversations — 当前用户参与的会话列表
 * POST /v1/workspaces/{wid}/conversations — 创建会话（单聊/群聊）
 */

/** 用户基本信息投影（会话成员列表复用） */
const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  image: true,
} as const;

/** GET 列表分页参数：cursor=上一页最后一条会话 id，limit 默认 20、上限 100 */
const listQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  type: z.enum(["direct", "group", "task"]).optional(),
});

/**
 * GET /v1/workspaces/{wid}/conversations — 会话列表
 *
 * 返回当前用户参与的所有会话，按 lastMessageAt desc 排序（null 排最后）。
 * 每个会话包含：成员列表（含 user 基本信息）、最后一条消息、当前用户的未读数。
 *
 * 分页：cursor-based，cursor 为上一页末尾会话 id。
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
    const url = new URL(req.url);
    const parsed = listQuerySchema.safeParse({
      cursor: url.searchParams.get("cursor") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      type: url.searchParams.get("type") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        {
          code: 400,
          message: apiMsg(req, "validationFailed"),
          errors: parsed.error.errors,
          data: null,
        },
        { status: 400 },
      );
    }
    const { cursor, limit } = parsed.data;
    const userId = ctx.payload.sub;

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        // 查询当前用户参与的会话（含成员、最后一条消息）
        const conversations = await tx.conversation.findMany({
          where: {
            workspaceId: wid,
            members: { some: { userId } },
            ...(parsed.data.type === "task"
              ? { source: "task" }
              : parsed.data.type
                ? { type: parsed.data.type }
                : {}),
          },
          include: {
            members: {
              include: { user: { select: USER_SELECT } },
            },
            messages: {
              orderBy: { createdAt: "desc" },
              take: 1,
              include: { author: { select: { id: true, name: true, image: true } } },
            },
          },
          orderBy: [
            { lastMessageAt: { sort: "desc", nulls: "last" } },
            { id: "desc" },
          ],
          take: limit + 1,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });

        const hasMore = conversations.length > limit;
        const page = hasMore ? conversations.slice(0, limit) : conversations;
        const nextCursor = hasMore ? page[page.length - 1]?.id ?? null : null;

        // 批量计算每个会话的未读数（消除 N+1：单次 raw SQL 聚合查询）
        // 未读定义：createdAt > member.lastReadAt 且 authorId != userId
        // lastReadAt 为 null 时，统计所有非自己发送的消息
        const conversationIds = page.map((conv) => conv.id);
        const unreadResults = conversationIds.length > 0
          ? await tx.$queryRaw<{ conversation_id: string; unread_count: bigint }[]>`
              SELECT m.conversation_id, COUNT(*)::bigint AS unread_count
              FROM messages m
              JOIN conversation_members cm
                ON m.conversation_id = cm.conversation_id
               AND cm.user_id = ${userId}::uuid
              WHERE m.conversation_id IN (${Prisma.join(conversationIds)})
                AND m.author_id IS DISTINCT FROM ${userId}::uuid
                AND (cm.last_read_at IS NULL OR m.created_at > cm.last_read_at)
              GROUP BY m.conversation_id`
          : [];
        const unreadMap = new Map<string, number>(
          unreadResults.map((r) => [r.conversation_id, Number(r.unread_count)]),
        );

        const items = page.map((conv) => {
          const unreadCount = unreadMap.get(conv.id) ?? 0;
          return {
            id: conv.id,
            type: conv.type,
            title: conv.title,
            avatar: conv.avatar,
            description: conv.description,
            createdBy: conv.createdBy,
            createdAt: conv.createdAt,
            updatedAt: conv.updatedAt,
            lastMessageAt: conv.lastMessageAt,
            lastMessage: conv.messages[0] ?? null,
            unreadCount,
            members: conv.members.map((m) => ({
              id: m.id,
              userId: m.userId,
              role: m.role,
              joinedAt: m.joinedAt,
              lastReadAt: m.lastReadAt,
              muted: m.muted,
              user: m.user,
            })),
          };
        });

        return { items, nextCursor, hasMore };
      },
      userId,
    );

    return NextResponse.json({ code: 200, data: result });
  } catch (error) {
    console.error("[GET conversations] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/** 创建会话请求体校验 */
const createConversationSchema = z.object({
  type: z.enum(["direct", "group"]),
  memberIds: z.array(z.string().uuid()).min(2),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional(),
  taskId: z.string().uuid().optional(),
  source: z.enum(["manual", "task", "system"]).optional(),
});

/**
 * POST /v1/workspaces/{wid}/conversations — 创建会话
 *
 * 请求体：{ type: "direct" | "group", memberIds: string[], title?: string, description?: string }
 *  - 单聊：memberIds 恰好 2 人（含自己）。若已有相同 2 人的单聊会话则直接返回。
 *  - 群聊：memberIds 至少 2 人（含自己），title 必填。
 *  - 创建者角色为 owner，其他成员为 member。
 *
 * 响应：{ code: 201, data: Conversation }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const body = createConversationSchema.parse(await req.json());
    const userId = ctx.payload.sub;

    // 单聊成员数校验：恰好 2 人
    if (body.type === "direct" && body.memberIds.length !== 2) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "directChatMembersInvalid"), data: null },
        { status: 400 },
      );
    }
    // 群聊标题必填
    if (body.type === "group" && !body.title) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "groupChatTitleRequired"), data: null },
        { status: 400 },
      );
    }
    // 创建者必须在 memberIds 中
    if (!body.memberIds.includes(userId)) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "directChatMembersInvalid"), data: null },
        { status: 400 },
      );
    }

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        // 验证所有 userIds 都是当前工作区的成员
        const workspaceMembers = await tx.member.findMany({
          where: { workspaceId: wid, userId: { in: body.memberIds } },
          select: { userId: true },
        });
        const memberIdsSet = new Set(workspaceMembers.map((m) => m.userId));
        const nonMemberIds = body.memberIds.filter((uid) => !memberIdsSet.has(uid));
        if (nonMemberIds.length > 0) {
          return { created: false, error: "not_workspace_member" as const, nonMemberIds };
        }

        // 单聊去重：查找已存在的、包含相同 2 名成员的 direct 会话
        if (body.type === "direct") {
          const [a, b] = body.memberIds;
          // 查找当前用户参与的 direct 会话，且另一成员也在其中
          const existing = await tx.conversation.findFirst({
            where: {
              workspaceId: wid,
              type: "direct",
              AND: [
                { members: { some: { userId: a } } },
                { members: { some: { userId: b } } },
              ],
            },
            include: {
              members: {
                include: { user: { select: USER_SELECT } },
              },
            },
          });
          if (existing) {
            return { created: false, conversation: existing };
          }
        }

        // 创建会话 + 成员
        const conversation = await tx.conversation.create({
          data: {
            workspaceId: wid,
            type: body.type,
            title: body.title ?? null,
            description: body.description ?? null,
            createdBy: userId,
            ...(body.taskId ? { taskId: body.taskId } : {}),
            ...(body.source ? { source: body.source } : {}),
            members: {
              create: body.memberIds.map((memberUserId) => ({
                userId: memberUserId,
                role: memberUserId === userId ? "owner" : "member",
              })),
            },
          },
          include: {
            members: {
              include: { user: { select: USER_SELECT } },
            },
          },
        });

        return { created: true, conversation };
      },
      userId,
    );

    if ("error" in result && result.error === "not_workspace_member") {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "usersNotWorkspaceMembers"), data: { nonMemberIds: result.nonMemberIds } },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { code: result.created ? 201 : 200, data: result.conversation },
      { status: result.created ? 201 : 200 },
    );
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
    console.error("[POST conversations] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}