import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendMentionEmail, isEmailConfigured } from "@/lib/email";
import { z } from "zod";

/** GET /v1/workspaces/{wid}/tasks/{id}/comments — 评论时间线（正序） */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string }> },
) {
  const { wid, id } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });

  const comments = await runWithWorkspace(wid, async (tx) => {
    const rows = await tx.comment.findMany({
      where: { taskId: id, task: { workspaceId: wid } },
      include: { author: { select: { id: true, name: true, email: true, image: true } } },
      orderBy: { createdAt: "desc" },
      // 上限保护：取最近 200 条后反转为正序时间线；游标分页列入 v2
      take: 200,
    });
    return rows.reverse();
  });

  return NextResponse.json({ code: 200, data: comments });
}

const createCommentSchema = z.object({
  body: z.string().min(1).max(10000),
  mentions: z.array(z.string().uuid()).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string }> },
) {
  const { wid, id } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });

  try {
    const validated = createCommentSchema.parse(await req.json());

    const comment = await runWithWorkspace(wid, async (tx) => {
      // 校验任务确实属于本工作区（防跨租户写入）
      const task = await tx.task.findFirst({
        where: { id, workspaceId: wid },
        select: { id: true, assigneeId: true, title: true },
      });
      if (!task) return null;

      const created = await tx.comment.create({
        data: {
          taskId: id,
          workspaceId: wid,
          authorId: ctx.payload.sub,
          body: validated.body,
          mentions: validated.mentions ?? [],
        },
        include: { author: { select: { id: true, name: true, email: true, image: true } } },
      });

      // A-3: 通知 —— mention 通知（每个被提及的用户，排除评论作者自己）
      // T2.8：过滤非本工作区成员，防止向外部用户发送通知
      const mentions = validated.mentions ?? [];
      const validMentions: string[] = [];
      if (mentions.length > 0) {
        const members = await tx.member.findMany({
          where: { workspaceId: wid, userId: { in: mentions } },
          select: { userId: true },
        });
        const memberSet = new Set(members.map((m) => m.userId));
        for (const uid of mentions) {
          if (memberSet.has(uid)) validMentions.push(uid);
        }
      }
      for (const mentionedUserId of validMentions) {
        if (mentionedUserId && mentionedUserId !== ctx.payload.sub) {
          await tx.notification.create({
            data: {
              userId: mentionedUserId,
              workspaceId: wid,
              type: "mention",
              entityId: id,
              entityTitle: task.title,
            },
          });
        }
      }

      // A-3: 通知 —— comment_added（任务指派人，如果不是评论作者）
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

      return { created, validMentions, taskTitle: task.title };
    });

    if (!comment) return NextResponse.json({ code: 404, message: "任务不存在" }, { status: 404 });

    // @提及邮件通知（邮件已配置 + 被提及者非评论作者时，失败不阻塞）
    if (isEmailConfigured() && comment.validMentions.length > 0) {
      try {
        const [mentioner, workspace, mentionedUsers] = await Promise.all([
          prisma.user.findUnique({
            where: { id: ctx.payload.sub },
            select: { name: true, email: true },
          }),
          prisma.workspace.findUnique({ where: { id: wid }, select: { name: true } }),
          prisma.user.findMany({
            where: { id: { in: comment.validMentions } },
            select: { id: true, name: true, email: true },
          }),
        ]);
        if (mentioner && workspace) {
          const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
          const taskUrl = `${appUrl}/w/${wid}/task/${id}`;
          // 评论摘要：截断到 200 字符以内
          const snippet =
            validated.body.length > 200
              ? `${validated.body.slice(0, 200)}…`
              : validated.body;
          await Promise.all(
            mentionedUsers.map((u) =>
              sendMentionEmail({
                to: u.email,
                mentioneeName: u.name ?? u.email,
                taskTitle: comment.taskTitle,
                workspaceName: workspace.name,
                mentionerName: mentioner.name ?? mentioner.email,
                commentSnippet: snippet,
                taskUrl,
              }).catch((err) =>
                console.error("[comment] sendMentionEmail failed (non-blocking):", err),
              ),
            ),
          );
        }
      } catch (err) {
        console.error("[comment] post-create mention notify failed (non-blocking):", err);
      }
    }

    return NextResponse.json({ code: 201, data: comment.created }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: error.issues[0]?.message ?? "参数校验失败" },
        { status: 400 },
      );
    }
    console.error("Create comment error:", error);
    return NextResponse.json({ code: 500, message: "Internal server error" }, { status: 500 });
  }
}
