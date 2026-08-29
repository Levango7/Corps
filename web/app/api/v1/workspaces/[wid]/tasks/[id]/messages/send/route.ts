import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { emitChatEvent } from "@/lib/chat-events";
import { z } from "zod";

/**
 * POST /v1/workspaces/{wid}/tasks/{id}/messages/send — 发送聊天消息（含 SSE 推送）
 *
 * 与现有 messages/route.ts POST 端点的区别：
 *  - 本端点在消息创建后 emit SSE 事件，触发实时推送给在线成员
 *  - 支持附带文件附件元数据（已通过 attachments 端点上传的文件）
 *  - 现有 POST 端点保持不变（向后兼容，不修改）
 *  - 重构后的 ChatPanel 调用本端点
 *
 * 请求体：{
 *   body: string,
 *   attachments?: Array<{ fileName, fileSize, fileType, url, thumbnailUrl? }>
 * }
 *  - body: 消息文本（1-10000 字符，有附件时可为 "📎 fileName"）
 *  - attachments: 可选，附件元数据列表（由 attachments 端点上传后返回）
 *
 * 响应：{ code: 201, data: Message }
 *
 * 消息创建后：
 *  1. 通知任务指派人有新消息（排除发送者自己）
 *  2. emit SSE `{ type: "message", message }` 事件
 */

const attachmentSchema = z.object({
  fileName: z.string().max(255),
  fileSize: z
    .number()
    .int()
    .positive()
    .max(10 * 1024 * 1024),
  fileType: z.string().max(100),
  url: z.string(),
  thumbnailUrl: z.string().nullable().optional(),
});

const sendMessageSchema = z.object({
  body: z.string().min(1).max(10000),
  attachments: z.array(attachmentSchema).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string }> },
) {
  const { wid, id } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });

  try {
    const validated = sendMessageSchema.parse(await req.json());

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        // 校验任务确实属于本工作区（防跨租户写入）
        const task = await tx.task.findFirst({
          where: { id, workspaceId: wid },
          select: { id: true, assigneeId: true, title: true },
        });
        if (!task) return null;

        const created = await tx.message.create({
          data: {
            taskId: id,
            workspaceId: wid,
            authorId: ctx.payload.sub,
            body: validated.body,
            // 同时创建附件记录（如果有）——写入租户归属（workspaceId），
            // 下载端点据此做归属校验（20260831000000 迁移配套）
            ...(validated.attachments && validated.attachments.length > 0
              ? {
                  attachments: {
                    create: validated.attachments.map((a) => ({
                      // 租户归属用关系 connect（Prisma checked 嵌套 create 类型要求关系
                      // 而非标量 workspaceId；RLS 谓词与下载归属校验均依赖该列）
                      workspace: { connect: { id: wid } },
                      fileName: a.fileName,
                      fileSize: a.fileSize,
                      fileType: a.fileType,
                      url: a.url,
                      thumbnailUrl: a.thumbnailUrl ?? null,
                    })),
                  },
                }
              : {}),
          },
          include: {
            author: { select: { id: true, name: true, email: true, image: true } },
            reads: { select: { userId: true, readAt: true } },
            attachments: true,
          },
        });

        // 通知任务指派人有新聊天消息（排除发送者自己）
        if (task.assigneeId && task.assigneeId !== ctx.payload.sub) {
          await tx.notification.create({
            data: {
              userId: task.assigneeId,
              workspaceId: wid,
              type: "comment_added",
              entityId: id,
              entityTitle: task.title,
            },
          });
        }

        return created;
      },
      ctx.payload.sub,
    );

    if (!result) return NextResponse.json({ code: 404, message: "任务不存在" }, { status: 404 });

    // emit SSE 事件：推送新消息给所有在线订阅者
    emitChatEvent(id, { type: "message", message: result });

    return NextResponse.json({ code: 201, data: result }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: error.issues[0]?.message ?? "参数校验失败" },
        { status: 400 },
      );
    }
    console.error("Send message error:", error);
    return NextResponse.json({ code: 500, message: "Internal server error" }, { status: 500 });
  }
}
