import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";
import { logger } from "@/lib/logger";

/**
 * GET /v1/workspaces/{wid}/tasks/{id}/messages/search — 搜索任务聊天消息
 *
 * 查询参数：
 *  - q: 关键词（必填，去空格后长度 ≥ 1）
 *  - limit: 返回条数上限，默认 20，最大 100
 *
 * 行为：
 *  - 在 prisma.message.findMany 中按 body contains q 做大小写不敏感搜索
 *    （PostgreSQL 默认 ILIKE 语义由 Prisma contains + insensitive 提供）
 *  - 仅返回当前任务（taskId = id 且 task.workspaceId = wid）的消息
 *  - 按 createdAt desc 排序（最新匹配在前）
 *  - 包含 author 投影，便于前端直接渲染头像/昵称
 *
 * 响应信封：{ code: 0, data: Message[], message: "OK" }
 *  - data：匹配消息数组（已按时间倒序）
 *
 * 认证：从 cookie 读取 access_token，验证工作区成员身份。
 */
const querySchema = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string }> },
) {
  const { wid, id } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  try {
    const raw = {
      q: req.nextUrl.searchParams.get("q") ?? "",
      limit: req.nextUrl.searchParams.get("limit") ?? undefined,
    };
    const parsed = querySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        {
          code: 400,
          message: parsed.error.issues[0]?.message ?? apiMsg(req, "validationFailed"),
          data: null,
        },
        { status: 400 },
      );
    }
    const { q, limit } = parsed.data;

    const messages = await runWithWorkspace(
      wid,
      async (tx) => {
        return tx.message.findMany({
          where: {
            taskId: id,
            task: { workspaceId: wid },
            body: { contains: q, mode: "insensitive" },
          },
          include: {
            author: { select: { id: true, name: true, email: true, image: true } },
          },
          orderBy: { createdAt: "desc" },
          take: limit,
        });
      },
      ctx.payload.sub,
    );

    logger.info("messages search", {
      wid,
      taskId: id,
      qLen: q.length,
      hits: messages.length,
    });

    return NextResponse.json({ code: 0, data: messages, message: apiMsg(req, "ok") });
  } catch (error) {
    logger.error("messages search failed", {
      wid,
      taskId: id,
      err: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
