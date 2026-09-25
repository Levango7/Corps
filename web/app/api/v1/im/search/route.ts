/**
 * GET /api/v1/im/search — 消息全文搜索
 *
 * 路由：GET /api/v1/im/search?workspaceId=xxx&q=关键词&conversationId=xxx&limit=20
 *
 * 使用 PostgreSQL tsvector 全文检索（messages.body_tsv 生成列 + GIN 索引），
 * ts_rank 排序，可选 conversationId 过滤指定会话。
 *
 * 安全：
 *  - getUserId 认证 → getWorkspaceContext RLS 成员资格校验 → runWithWorkspace 注入 GUC
 *  - checkRateLimit 限流（每分钟 30 次）
 *  - zod 校验 query 参数（workspaceId UUID、q 非空、limit 1-50）
 *  - $queryRawUnsafe 参数化查询，杜绝 SQL 注入
 *  - 仅返回未撤回（revoked_at IS NULL）的消息
 *
 * 返回信封：{ code, data: MessageSearchResult[], message }
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
  conversationId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** 消息搜索结果行（与 SQL SELECT 列对齐，snake_case 来自 PostgreSQL） */
interface MessageSearchRow {
  id: string;
  author_id: string | null;
  body: string;
  conversation_id: string | null;
  task_id: string | null;
  created_at: Date;
  rank: number;
  author_name: string | null;
  author_image: string | null;
  conversation_title: string | null;
}

/** 对外返回的消息搜索结果（camelCase，前端消费） */
export interface MessageSearchResult {
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

export async function GET(req: NextRequest): Promise<NextResponse> {
  // 1) 认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) 限流：每分钟 30 次（搜索场景中频操作）
  const limited = await checkRateLimit(req, "im-search", {
    windowMs: 60_000,
    max: 30,
  });
  if (limited) return limited;

  // 3) query 参数校验
  const url = new URL(req.url);
  const params = {
    workspaceId: url.searchParams.get("workspaceId"),
    q: url.searchParams.get("q"),
    conversationId: url.searchParams.get("conversationId") ?? undefined,
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

  // q 纯空格守卫（zod trim 后 min(1) 已拦截，此处双保险）
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
    // 5) tsvector 全文检索（走 RLS 事务）
    //    plainto_tsquery('simple', $1) 不做词干提取，适合中文关键词匹配
    //    仅返回未撤回消息（revoked_at IS NULL）
    //    LEFT JOIN users / conversations 补充作者名与会话标题供前端展示
    const hasConvFilter = Boolean(parsed.conversationId);
    const sql = hasConvFilter
      ? `SELECT
           m.id,
           m.author_id,
           m.body,
           m.conversation_id,
           m.task_id,
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
           AND m.conversation_id = $4
         ORDER BY rank DESC, m.created_at DESC
         LIMIT $3`
      : `SELECT
           m.id,
           m.author_id,
           m.body,
           m.conversation_id,
           m.task_id,
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

    const rows: MessageSearchRow[] = hasConvFilter
      ? await runWithWorkspace(
          parsed.workspaceId,
          (tx) =>
            tx.$queryRawUnsafe<MessageSearchRow[]>(
              sql,
              parsed.q,
              parsed.workspaceId,
              parsed.limit,
              parsed.conversationId,
            ),
          ctx.payload.sub,
        )
      : await runWithWorkspace(
          parsed.workspaceId,
          (tx) =>
            tx.$queryRawUnsafe<MessageSearchRow[]>(sql, parsed.q, parsed.workspaceId, parsed.limit),
          ctx.payload.sub,
        );

    // 6) 转为 camelCase 返回
    const results: MessageSearchResult[] = rows.map((r) => ({
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

    // P1-fix: code: 200 → code: 0，message 用 apiMsg 双语
    return NextResponse.json({ code: 0, data: results, message: apiMsg(req, "ok") });
  } catch (error) {
    console.error("[GET /api/v1/im/search] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}
