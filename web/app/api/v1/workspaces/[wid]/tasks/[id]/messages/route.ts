import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/permissions";
import { getWorkspaceContextV2, runWithWorkspace } from "@/lib/auth";
import { authFailure } from "@/lib/auth-response";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";

/**
 * GET /v1/workspaces/{wid}/tasks/{id}/messages — 任务聊天消息历史
 *
 * 查询参数：
 *  - since: ISO 8601 时间戳，增量游标。提供时只返回 createdAt > since 的消息。
 *  - 不提供时返回最近 200 条（正序时间线）。
 *
 * MVP 采用轮询方案：前端 5s 间隔用 ?since= 增量拉取新消息。
 * API 设计兼容未来 SSE 升级（响应格式不变）。
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string }> },
) {
  const { wid, id } = await params;
  const ctx = await getWorkspaceContextV2(req, wid);
  if (!ctx)
    // V2 契约上从不返回 null（见 lib/auth.ts 的 WorkspaceContextV2 文档：
    // "调用方遇到 null 应按 500 处理（fail-closed，不可当作 401 重试）"）。
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  if (!ctx.ok) return authFailure(ctx, req);

  try {
    const sinceParam = req.nextUrl.searchParams.get("since");
    const since = sinceParam ? new Date(sinceParam) : null;
    // 防止无效日期导致全表扫描
    const sinceValid = since && !Number.isNaN(since.getTime()) ? since : null;

    const messages = await runWithWorkspace(
      wid,
      async (tx) => {
        if (sinceValid) {
          // 增量拉取：since 之后的所有消息（正序）
          return tx.message.findMany({
            where: {
              taskId: id,
              task: { workspaceId: wid },
              createdAt: { gt: sinceValid },
            },
            include: { author: { select: { id: true, name: true, email: true, image: true } } },
            orderBy: { createdAt: "asc" },
            take: 200,
          });
        }
        // 首次加载：取最近 200 条后反转为正序时间线
        const rows = await tx.message.findMany({
          where: { taskId: id, task: { workspaceId: wid } },
          include: { author: { select: { id: true, name: true, email: true, image: true } } },
          orderBy: { createdAt: "desc" },
          take: 200,
        });
        return rows.reverse();
      },
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 200, data: messages });
  } catch (error) {
    console.error("[GET messages] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

const createMessageSchema = z.object({
  body: z.string().min(1).max(10000),
});

/**
 * POST /v1/workspaces/{wid}/tasks/{id}/messages — 发送聊天消息
 *
 * 请求体：{ body: string }
 * 响应：{ code: 201, data: Message }
 *
 * 消息创建后，同时写入 Notification（通知任务指派人有新消息，排除发送者自己）。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string }> },
) {
  const { wid, id } = await params;
  const ctx = await getWorkspaceContextV2(req, wid);
  if (!ctx)
    // V2 契约上从不返回 null（见 lib/auth.ts 的 WorkspaceContextV2 文档：
    // "调用方遇到 null 应按 500 处理（fail-closed，不可当作 401 重试）"）。
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  if (!ctx.ok) return authFailure(ctx, req);

  // 角色门禁：lib/permissions.ts 声明 messages 对 viewer 仅 "r"，此前只认证不判角色。
  const deniedRole = await requirePermission(ctx, "messages", "create", req);
  if (deniedRole) return deniedRole;

  try {
    const validated = createMessageSchema.parse(await req.json());

    const result = await runWithWorkspace(wid, async (tx) => {
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
        },
        include: { author: { select: { id: true, name: true, email: true, image: true } } },
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
    });

    if (!result)
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "taskNotFound"), data: null },
        { status: 404 },
      );

    return NextResponse.json({ code: 201, data: result }, { status: 201 });
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
    console.error("Create message error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}
