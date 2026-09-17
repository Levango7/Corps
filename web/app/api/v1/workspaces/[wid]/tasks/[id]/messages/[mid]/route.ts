import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { apiMsg, type ApiMsgKey } from "@/lib/api-messages";
import { logger } from "@/lib/logger";

const paramsSchema = z.object({ wid: z.string().uuid(), id: z.string().uuid(), mid: z.string().uuid() });
const updateSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("recall") }).strict(),
  z.object({ action: z.literal("edit"), body: z.string().trim().min(1).max(10000) }).strict(),
]);
const recallWindowMs = 30 * 60 * 1000;

/** 任务消息仅允许作者编辑/撤回；撤回窗口为发送后 30 分钟。 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string; mid: string }> },
) {
  const fail = (status: number, key: ApiMsgKey, reason?: string) => NextResponse.json(
    { code: status, data: null, message: apiMsg(req, key), ...(reason ? { reason } : {}) },
    { status },
  );
  try {
    const { wid, id, mid } = paramsSchema.parse(await params);
    // 本项目通过工作区上下文同时验证登录身份、令牌工作区及成员资格。
    const ctx = await getWorkspaceContext(req, wid);
    if (!ctx) return fail(401, "unauthorized");
    const input = updateSchema.parse(await req.json());
    const userId = ctx.payload.sub;
    const result = await runWithWorkspace(wid, async (tx) => {
      const message = await tx.message.findFirst({
        where: { id: mid, taskId: id, workspaceId: wid, task: { workspaceId: wid } },
      });
      if (!message) return { status: "notFound" as const };
      if (message.authorId !== userId) return { status: "forbidden" as const };
      if (message.isRecalled || message.revokedAt) return { status: "recalled" as const };
      const now = new Date();
      if (input.action === "recall" && now.getTime() - message.createdAt.getTime() > recallWindowMs) {
        return { status: "expired" as const };
      }
      // 在写入条件中重复状态约束，避免并发编辑覆盖已经撤回的消息。
      const changed = await tx.message.updateMany({
        where: {
          id: mid, taskId: id, workspaceId: wid, authorId: userId,
          isRecalled: false, revokedAt: null,
          ...(input.action === "recall" ? { createdAt: { gte: new Date(now.getTime() - recallWindowMs) } } : {}),
        },
        data: input.action === "recall"
          ? { isRecalled: true, revokedAt: now, revokedBy: userId, body: "" }
          : { body: input.body, editedAt: now },
      });
      if (changed.count === 0) return { status: "recalled" as const };
      const updated = await tx.message.findUniqueOrThrow({
        where: { id: mid },
        include: {
          author: { select: { id: true, name: true, email: true, image: true } },
          reads: { select: { userId: true, readAt: true } },
          attachments: true,
        },
      });
      return { status: "ok" as const, message: updated.isRecalled ? { ...updated, attachments: [] } : updated };
    }, userId);

    if (result.status === "notFound") return fail(404, "messageNotFound");
    if (result.status === "forbidden") return fail(403, "forbidden");
    if (result.status === "recalled") return fail(409, "messageRevoked", "recalled");
    // 现有 revokeTimeExceeded 文案固定为 2 分钟，不能用于本端点。
    if (result.status === "expired") return fail(403, "forbidden", "recallExpired");
    return NextResponse.json({ code: 0, data: result.message, message: apiMsg(req, "ok") });
  } catch (error) {
    if (error instanceof z.ZodError) return fail(400, "validationFailed");
    if (error instanceof SyntaxError) return fail(400, "invalidBody");
    logger.error("任务消息更新失败", { error: error instanceof Error ? error.message : String(error) });
    return fail(500, "internalError");
  }
}