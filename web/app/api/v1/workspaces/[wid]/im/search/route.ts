import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";

/**
 * 独立 IM 消息搜索 API（任务 212）
 *
 * GET /v1/workspaces/{wid}/im/search?q=keyword&cid=conversationId&limit=20
 */

/** 搜索查询参数校验 */
const searchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  cid: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** 搜索结果上下文摘要半径（匹配关键词前后各 50 字符） */
const SNIPPET_RADIUS = 50;

/** 生成匹配上下文 snippet */
function buildSnippet(text: string, query: string): string {
  if (!text) return "";
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return text.slice(0, SNIPPET_RADIUS * 2);
  const start = Math.max(0, idx - SNIPPET_RADIUS);
  const end = Math.min(text.length, idx + query.length + SNIPPET_RADIUS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return prefix + text.slice(start, end) + suffix;
}

/**
 * GET /v1/workspaces/{wid}/im/search — 消息搜索
 *
 * 查询参数：
 *  - q: 搜索关键词（必填，1-200 字符）
 *  - cid: 会话 ID（可选，限定搜索范围到单个会话）
 *  - limit: 返回条数上限（默认 20，最大 100）
 *
 * 搜索范围：当前用户参与的会话中的消息 body（ILIKE 模糊匹配）。
 * 排除已撤回的消息（revokedAt 非空）。
 *
 * 响应：{ code: 200, data: SearchResult[] }
 *
 * 每个 SearchResult 补齐前端期望字段：
 *  - messageId（同 id）
 *  - authorName / authorImage（从 author 展平）
 *  - conversationTitle（从 conversation 展平）
 *  - rank（相关性得分，此处用 0 占位）
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
    const parsed = searchQuerySchema.safeParse({
      q: url.searchParams.get("q"),
      cid: url.searchParams.get("cid") ?? undefined,
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

    const q = parsed.data.q.trim();
    if (!q) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "searchQueryBlank"), data: null },
        { status: 400 },
      );
    }

    const { cid, limit } = parsed.data;
    const userId = ctx.payload.sub;

    const messages = await runWithWorkspace(
      wid,
      async (tx) => {
        // 构建查询条件：当前用户参与的会话中的消息
        const where = {
          workspaceId: wid,
          conversationId: { not: null },
          revokedAt: null,
          body: { contains: q, mode: "insensitive" as const },
          // 消息必须属于当前用户参与的会话
          conversation: {
            members: { some: { userId } },
            ...(cid ? { id: cid } : {}),
          },
        };

        return tx.message.findMany({
          where,
          include: {
            author: {
              select: { id: true, name: true, email: true, image: true },
            },
            conversation: {
              select: {
                id: true,
                type: true,
                title: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
          take: limit,
        });
      },
      userId,
    );

    const items = messages.map((m) => ({
      id: m.id,
      // P1-fix: 补齐前端 SearchResult 期望的字段名
      messageId: m.id,
      conversationId: m.conversationId,
      authorId: m.authorId,
      body: m.body,
      snippet: buildSnippet(m.body, q),
      createdAt: m.createdAt,
      author: m.author,
      authorName: m.author?.name ?? null,
      authorImage: m.author?.image ?? null,
      conversation: m.conversation,
      conversationTitle: m.conversation?.title ?? null,
      rank: 0,
    }));

    // P1-fix: 直接返回数组，避免前端解包得到 { items, total } 对象导致 .map 崩溃
    return NextResponse.json({
      code: 200,
      data: items,
    });
  } catch (error) {
    console.error("[GET im search] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}