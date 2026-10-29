/**
 * GET /api/v1/im/search — 消息全文搜索
 *
 * 路由：GET /api/v1/im/search?workspaceId=xxx&q=关键词&conversationId=xxx&limit=20
 *
 * 两条匹配取并集，rank 仍由 ts_rank 给（只有子串命中的行 rank 为 0，排在全文命中之后）：
 *  1) `body_tsv @@ plainto_tsquery('simple', q)` —— 走 messages.body_tsv 生成列 + GIN 索引；
 *  2) `body ILIKE '%转义后的 q%' ESCAPE '\'` —— 走 idx_messages_body_trgm（gin_trgm_ops）。
 *
 * 为什么不能只留第 1 条：'simple' 解析器不切词，连续中文整段只生成**一个** lexeme。
 * 实测（postgres:18.6）：
 *   to_tsvector('simple','中文关键词测试')                 → '中文关键词测试':1
 *   to_tsvector('simple','中文关键词测试') @@ plainto_tsquery('simple','关键词') → **f**
 *   to_tsvector('simple','可搜索消息 UniqueToken123 结尾') @@ plainto_tsquery('simple','UniqueToken') → **f**
 * 也就是说对产品的主要语言（中文）而言，全文分支只在「查询串 = 整段无空格文本」时才命中，
 * 用户搜任何子串都是零结果。此前 e2e 是按这个实现能力反推用例的
 * （`web/e2e/im-upgrade.spec.ts` 里把关键词用空格独立成词），属于拿测试迁就缺陷。
 * 第 2 条补上子串语义后，中文查询才有结果；实测加索引后
 * `WHERE body ILIKE '%关键中文子串%'` 的计划为 Bitmap Index Scan on idx_messages_body_trgm。
 *
 * 安全：
 *  - getUserId 认证 → getWorkspaceContextV2 RLS 成员资格校验 → runWithWorkspace 注入 GUC
 *  - checkRateLimit 限流（每分钟 30 次）
 *  - zod 校验 query 参数（workspaceId UUID、q 非空、limit 1-50）
 *  - $queryRawUnsafe 参数化查询，杜绝 SQL 注入
 *  - ILIKE 的模式串经 likeContainsPattern 转义 `\` `%` `_`，否则用户输入的 `%`
 *    会当通配符生效（实测 '100%' 未转义命中 140 行、转义后 0 行）
 *  - 仅返回未撤回（revoked_at IS NULL）的消息
 *
 * 返回信封：{ code, data: MessageSearchResult[], message }
 *
 * 来源：经验 2026-09-15-ai-route-unified-pattern-audit-checklist
 *       （getUserId + checkRateLimit + getWorkspaceContextV2 + runWithWorkspace + apiMsg 统一模式）
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { getWorkspaceContextV2, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";
import { authFailure } from "@/lib/auth-response";
import { likeContainsPattern } from "@/lib/like-escape";
import { withRed } from "@/lib/red-metrics";

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

async function getImSearch(req: NextRequest): Promise<NextResponse> {
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
  const ctx = await getWorkspaceContextV2(req, parsed.workspaceId);
  if (!ctx)
    // V2 契约上从不返回 null（见 lib/auth.ts 的 WorkspaceContextV2 文档：
    // "调用方遇到 null 应按 500 处理（fail-closed，不可当作 401 重试）"）。
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  if (!ctx.ok) return authFailure(ctx, req);

  try {
    // 5) 全文 + 子串并集检索（走 RLS 事务）
    //    plainto_tsquery('simple', $1) 不做词干提取，且连续中文整段只是一个 lexeme，
    //    所以中文子串必须靠第二条 ILIKE 分支命中（见文件头实测）。
    //    仅返回未撤回消息（revoked_at IS NULL）
    //    LEFT JOIN users / conversations 补充作者名与会话标题供前端展示
    const likePattern = likeContainsPattern(parsed.q);
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
         WHERE m.workspace_id = $2::uuid
           AND (m.body_tsv @@ plainto_tsquery('simple', $1)
                OR m.body ILIKE $5 ESCAPE '\\')
           AND m.revoked_at IS NULL
           AND m.conversation_id = $4::uuid
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
         WHERE m.workspace_id = $2::uuid
           AND (m.body_tsv @@ plainto_tsquery('simple', $1)
                OR m.body ILIKE $4 ESCAPE '\\')
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
              likePattern,
            ),
          ctx.payload.sub,
        )
      : await runWithWorkspace(
          parsed.workspaceId,
          (tx) =>
            tx.$queryRawUnsafe<MessageSearchRow[]>(
              sql,
              parsed.q,
              parsed.workspaceId,
              parsed.limit,
              likePattern,
            ),
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

export const GET = withRed(getImSearch);
