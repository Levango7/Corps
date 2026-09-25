/**
 * GET /api/v1/search — 统一全文搜索（消息 + Wiki 页面）
 *
 * 路由：GET /api/v1/search?workspaceId=xxx&q=关键词&type=all|message|wiki&limit=20
 *
 * 同时搜索：
 *  - messages.body_tsv（消息全文，tsvector 生成列 + GIN 索引）
 *  - wiki_pages.content_tsv（Wiki 页面全文，tsvector 生成列 + GIN 索引）
 *
 * type 参数控制搜索范围：
 *  - all（默认）：消息 + Wiki
 *  - message：仅消息
 *  - wiki：仅 Wiki
 *
 * 安全：
 *  - getUserId 认证 → getWorkspaceContext RLS 成员资格校验 → runWithWorkspace 注入 GUC
 *  - checkRateLimit 限流（每分钟 30 次）
 *  - zod 校验 query 参数
 *  - $queryRawUnsafe 参数化查询，杜绝 SQL 注入
 *  - 消息仅返回未撤回（revoked_at IS NULL）
 *
 * 返回信封：{ code, data: { messages: [], wikis: [] }, message }
 *
 * 来源：经验 2026-09-15-ai-route-unified-pattern-audit-checklist
 *       （getUserId + checkRateLimit + getWorkspaceContext + runWithWorkspace + apiMsg 统一模式）
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";

/** query 参数校验 schema */
const searchSchema = z.object({
  workspaceId: z.string().uuid(),
  q: z.string().trim().min(1).max(200),
  type: z.enum(["all", "message", "wiki"]).default("all"),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** 消息搜索结果行（snake_case 来自 PostgreSQL） */
interface MessageSearchRow {
  id: string;
  author_id: string | null;
  body: string;
  conversation_id: string | null;
  created_at: Date;
  rank: number;
  author_name: string | null;
  author_image: string | null;
  conversation_title: string | null;
}

/** Wiki 搜索结果行（snake_case 来自 PostgreSQL） */
interface WikiSearchRow {
  id: string;
  title: string;
  slug: string;
  updated_at: Date;
  rank: number;
}

/** 对外返回的消息搜索结果（camelCase） */
export interface UnifiedMessageResult {
  messageId: string;
  authorId: string | null;
  authorName: string | null;
  authorImage: string | null;
  body: string;
  conversationId: string | null;
  conversationTitle: string | null;
  createdAt: string;
  rank: number;
}

/** 对外返回的 Wiki 搜索结果（camelCase） */
export interface UnifiedWikiResult {
  pageId: string;
  title: string;
  slug: string;
  updatedAt: string;
  rank: number;
}

/** 消息全文检索 SQL（未撤回消息，JOIN 作者名/头像/会话标题） */
const MESSAGE_SQL = `SELECT
  m.id,
  m.author_id,
  m.body,
  m.conversation_id,
  m.created_at,
  ts_rank(m.body_tsv, plainto_tsquery('simple', $1)) AS rank,
  u.name AS author_name,
  u.avatar_url AS author_image,
  c.title AS conversation_title
FROM messages m
LEFT JOIN users u ON u.id = m.author_id
LEFT JOIN conversations c ON c.id = m.conversation_id
WHERE m.workspace_id = $2
  AND m.body_tsv @@ plainto_tsquery('simple', $1)
  AND m.revoked_at IS NULL
ORDER BY rank DESC, m.created_at DESC
LIMIT $3`;

/** Wiki 页面全文检索 SQL */
const WIKI_SQL = `SELECT
  w.id,
  w.title,
  w.slug,
  w.updated_at,
  ts_rank(w.content_tsv, plainto_tsquery('simple', $1)) AS rank
FROM wiki_pages w
WHERE w.workspace_id = $2
  AND w.content_tsv @@ plainto_tsquery('simple', $1)
ORDER BY rank DESC, w.updated_at DESC
LIMIT $3`;

export async function GET(req: NextRequest): Promise<NextResponse> {
  // 1) 认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) 限流：每分钟 30 次
  const limited = await checkRateLimit(req, "unified-search", {
    windowMs: 60_000,
    max: 30,
  });
  if (limited) return limited;

  // 3) query 参数校验
  const url = new URL(req.url);
  const params = {
    workspaceId: url.searchParams.get("workspaceId"),
    q: url.searchParams.get("q"),
    type: url.searchParams.get("type") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  };

  let parsed: z.infer<typeof searchSchema>;
  try {
    parsed = searchSchema.parse(params);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        {
          code: 400,
          message: e.issues[0]?.message ?? apiMsg(req, "validationFailed"),
          data: null,
        },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "invalidParams"), data: null },
      { status: 400 },
    );
  }

  // q 纯空格守卫
  if (!parsed.q.trim()) {
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "searchQueryBlank"), data: null },
      { status: 400 },
    );
  }

  // 4) 工作区认证（RLS 成员资格校验）
  const ctx = await getWorkspaceContext(req, parsed.workspaceId);
  if (!ctx) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  try {
    // 5) 根据 type 并行执行搜索（走 RLS 事务）
    const shouldSearchMessages = parsed.type === "all" || parsed.type === "message";
    const shouldSearchWikis = parsed.type === "all" || parsed.type === "wiki";

    // 两条搜索各自独立事务（不同表，无写操作，并行安全）
    const [messageRows, wikiRows] = await Promise.all([
      shouldSearchMessages
        ? runWithWorkspace(
            parsed.workspaceId,
            (tx) =>
              tx.$queryRawUnsafe<MessageSearchRow[]>(
                MESSAGE_SQL,
                parsed.q,
                parsed.workspaceId,
                parsed.limit,
              ),
            ctx.payload.sub,
          )
        : Promise.resolve([] as MessageSearchRow[]),
      shouldSearchWikis
        ? runWithWorkspace(
            parsed.workspaceId,
            (tx) =>
              tx.$queryRawUnsafe<WikiSearchRow[]>(
                WIKI_SQL,
                parsed.q,
                parsed.workspaceId,
                parsed.limit,
              ),
            ctx.payload.sub,
          )
        : Promise.resolve([] as WikiSearchRow[]),
    ]);

    // 6) 转为 camelCase 返回
    const messages: UnifiedMessageResult[] = messageRows.map((r) => ({
      messageId: r.id,
      authorId: r.author_id,
      authorName: r.author_name,
      authorImage: r.author_image,
      body: r.body,
      conversationId: r.conversation_id,
      conversationTitle: r.conversation_title,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      rank: r.rank,
    }));

    const wikis: UnifiedWikiResult[] = wikiRows.map((r) => ({
      pageId: r.id,
      title: r.title,
      slug: r.slug,
      updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
      rank: r.rank,
    }));

    return NextResponse.json({
      // P1-fix: code: 200 → code: 0，message 用 apiMsg 双语
      code: 0,
      data: { messages, wikis },
      message: apiMsg(req, "ok"),
    });
  } catch (error) {
    console.error("[GET /api/v1/search] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}
