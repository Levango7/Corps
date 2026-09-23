import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";
import { imManager } from "@/lib/im/ws-server";
import type { MessagePayload, ServerMessage } from "@/lib/im/types";

/**
 * 独立 IM 消息 API（任务 213）
 *
 * GET  /v1/workspaces/{wid}/conversations/{cid}/messages — 消息列表（游标分页）
 * POST /v1/workspaces/{wid}/conversations/{cid}/messages — 发送消息
 */

/** 作者基本信息投影（列表/广播复用） */
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


/**
 * 将 Prisma Message 行转换为 WebSocket 广播所需的 MessagePayload。
 *
 * - Date → ISO 8601 字符串（与 IM 协议一致）
 * - 撤回消息 body 清空（避免推送已撤回内容给新加入成员）
 * - author 注销后 name/image 为 null
 */
function toMessagePayload(
  msg: {
    id: string;
    conversationId: string | null;
    authorId: string | null;
    author: { name: string | null; image: string | null } | null;
    body: string;
    type: string | null;
    createdAt: Date;
    editedAt: Date | null;
    revokedAt: Date | null;
    replyToId: string | null;
    mentions: string[];
  },
  cid: string,
): MessagePayload {
  return {
    id: msg.id,
    conversationId: msg.conversationId ?? cid,
    authorId: msg.authorId,
    authorName: msg.author?.name ?? null,
    authorImage: msg.author?.image ?? null,
    body: msg.revokedAt ? "" : msg.body,
    type: (msg.type as MessagePayload["type"]) ?? "text",
    createdAt: msg.createdAt.toISOString(),
    editedAt: msg.editedAt?.toISOString() ?? null,
    revokedAt: msg.revokedAt?.toISOString() ?? null,
    replyToId: msg.replyToId,
    mentions: msg.mentions,
  };
}

/** GET 列表游标分页参数 */
const listQuerySchema = z.object({
  before: z.string().datetime().optional(),
  after: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * GET /v1/workspaces/{wid}/conversations/{cid}/messages — 消息列表
 *
 * 游标分页：
 *  - 无 cursor：返回最近 limit 条（正序时间线）
 *  - ?before=ISO：返回 createdAt < before 的消息（向上加载更早消息）
 *  - ?after=ISO：返回 createdAt > after 的消息（增量拉取新消息）
 *
 * 已撤回消息保留记录但 body 置空。include：author、attachments、replyTo（含 author）。
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
    const url = new URL(req.url);
    const parsed = listQuerySchema.safeParse({
      before: url.searchParams.get("before") ?? undefined,
      after: url.searchParams.get("after") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
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
    const { before, after, limit } = parsed.data;
    const userId = ctx.payload.sub;

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        // 验证当前用户是该会话成员（同时确认会话属于本工作区）
        const membership = await tx.conversationMember.findFirst({
          where: { conversationId: cid, userId, conversation: { workspaceId: wid } },
          select: { id: true },
        });
        if (!membership) return null;

        // 游标分页：取 limit+1 条以判断 hasMore
        let raw: Array<{
          id: string;
          conversationId: string | null;
          authorId: string | null;
          body: string;
          editedAt: Date | null;
          revokedAt: Date | null;
          replyToId: string | null;
          mentions: string[];
          createdAt: Date;
          author: { id: string; name: string | null; email: string | null; image: string | null } | null;
          attachments: Array<{
            id: string;
            messageId: string;
            workspaceId: string;
            fileName: string;
            fileSize: number;
            fileType: string;
            url: string;
            thumbnailUrl: string | null;
            createdAt: Date;
          }>;
          replyTo: {
            id: string;
            body: string;
            authorId: string | null;
            author: { id: string; name: string | null; image: string | null } | null;
          } | null;
        }>;

        if (after) {
          // 增量拉取：createdAt > after，正序
          raw = await tx.message.findMany({
            where: { conversationId: cid, createdAt: { gt: new Date(after) } },
            orderBy: { createdAt: "asc" },
            take: limit + 1,
            include: MESSAGE_INCLUDE,
          });
        } else {
          // 最近消息或向上加载：desc 取后反转
          raw = await tx.message.findMany({
            where: before
              ? { conversationId: cid, createdAt: { lt: new Date(before) } }
              : { conversationId: cid },
            orderBy: { createdAt: "desc" },
            take: limit + 1,
            include: MESSAGE_INCLUDE,
          });
        }

        const hasMore = raw.length > limit;
        const page = hasMore ? raw.slice(0, limit) : raw;
        // after 已正序；无 cursor / before 需反转为正序时间线
        const ordered = after ? page : page.reverse();

        // 撤回消息 body 置空（保留记录）
        const messages = ordered.map((m) =>
          m.revokedAt ? { ...m, body: "" } : m,
        );

        return { messages, hasMore };
      },
      userId,
    );

    if (result === null) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "conversationNotFound"), data: null },
        { status: 404 },
      );
    }

    return NextResponse.json({ code: 200, data: result });
  } catch (error) {
    console.error("[GET messages] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * 获取允许的附件域名白名单。
 *
 * 来源：环境变量 ALLOWED_ATTACHMENT_DOMAINS（逗号分隔），默认包含当前应用域名。
 * 用于防止 SSRF / 钓鱼攻击：附件 URL 必须指向受信任的域名。
 */
function getAllowedAttachmentDomains(): string[] {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const defaultDomain = new URL(appUrl).hostname;
  const envDomains = process.env.ALLOWED_ATTACHMENT_DOMAINS;
  if (envDomains) {
    const domains = envDomains
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);
    if (domains.length > 0) return domains;
  }
  return [defaultDomain];
}

/** 验证附件 URL 的域名是否在白名单中 */
function isAttachmentUrlAllowed(url: string): boolean {
  try {
    const parsed = new URL(url);
    const protocol = parsed.protocol;
    if (!["http:", "https:"].includes(protocol)) {
      return false;
    }
    return getAllowedAttachmentDomains().includes(parsed.hostname);
  } catch {
    return false;
  }
}

/** 发送消息请求体校验 */
const sendMessageSchema = z.object({
  body: z.string().min(1).max(10000),
  type: z
    .enum(["text", "system", "call_invite", "call_ended", "call_rejected"])
    .optional()
    .default("text"),
  replyToId: z.string().uuid().optional(),
  mentions: z.array(z.string().uuid()).optional().default([]),
  attachments: z
    .array(
      z.object({
        filename: z.string().min(1).max(255),
        url: z
          .string()
          .url()
          .refine(isAttachmentUrlAllowed, "附件 URL 域名不在允许的白名单中"),
        mimeType: z.string().min(1).max(100),
        size: z.number().int().positive(),
      }),
    )
    .optional()
    .default([]),
});

/**
 * POST /v1/workspaces/{wid}/conversations/{cid}/messages — 发送消息
 *
 * 请求体：{ body, replyToId?, mentions?, attachments? }
 *  - 创建 Message 记录 + 附件
 *  - 更新会话 lastMessageAt、发送者 lastReadAt
 *  - WebSocket 广播新消息（排除发送者）
 *  - 为被 @提及的会话成员创建 mention 通知（排除发送者）
 *
 * 响应：{ code: 201, data: Message }
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
    const body = sendMessageSchema.parse(await req.json());
    const userId = ctx.payload.sub;

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        // 验证当前用户是该会话成员
        const membership = await tx.conversationMember.findFirst({
          where: { conversationId: cid, userId, conversation: { workspaceId: wid } },
          select: { id: true },
        });
        if (!membership) return { status: "not_found" as const };

        // 创建消息
        const message = await tx.message.create({
          data: {
            conversationId: cid,
            workspaceId: wid,
            authorId: userId,
            body: body.body,
            type: body.type,
            replyToId: body.replyToId ?? null,
            mentions: body.mentions,
          },
        });

        // 批量创建附件（Prisma 字段名 fileName/fileType/fileSize，映射自 API 入参）
        if (body.attachments.length > 0) {
          await tx.messageAttachment.createMany({
            data: body.attachments.map((a) => ({
              messageId: message.id,
              workspaceId: wid,
              fileName: a.filename,
              fileSize: a.size,
              fileType: a.mimeType,
              url: a.url,
            })),
          });
        }

        // 更新会话最近活动时间
        await tx.conversation.update({
          where: { id: cid },
          data: { lastMessageAt: new Date() },
        });

        // 更新发送者已读游标（自己发的消息视为已读）
        await tx.conversationMember.update({
          where: { id: membership.id },
          data: { lastReadAt: new Date() },
        });

        // 为被 @提及的会话成员创建 mention 通知（排除发送者）
        if (body.mentions.length > 0) {
          const mentionedMembers = await tx.conversationMember.findMany({
            where: {
              conversationId: cid,
              userId: { in: body.mentions },
            },
            select: { userId: true },
          });
          const notifyUserIds = mentionedMembers
            .map((m) => m.userId)
            .filter((uid) => uid !== userId);
          if (notifyUserIds.length > 0) {
            // entityTitle 截断到 255 字符（Notification.entityTitle 为 varchar(255)）
            const entityTitle = body.body.slice(0, 255);
            await tx.notification.createMany({
              data: notifyUserIds.map((uid) => ({
                userId: uid,
                workspaceId: wid,
                type: "mention",
                entityId: message.id,
                entityTitle,
              })),
            });
          }
        }

        // 查询完整消息（含 author、attachments、replyTo）用于响应和广播
        const fullMessage = await tx.message.findUnique({
          where: { id: message.id },
          include: MESSAGE_INCLUDE,
        });

        return { status: "ok" as const, message: fullMessage };
      },
      userId,
    );

    if (result.status === "not_found") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "conversationNotFound"), data: null },
        { status: 404 },
      );
    }

    // WebSocket 广播新消息给会话其他订阅者（排除发送者避免回声）
    if (result.message) {
      const payload = toMessagePayload(result.message, cid);
      const serverMsg: ServerMessage = {
        type: "message",
        conversationId: cid,
        message: payload,
      };
      imManager.broadcastToConversation(cid, serverMsg, userId);
    }

    return NextResponse.json(
      { code: 201, data: result.message },
      { status: 201 },
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
    console.error("[POST messages] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}