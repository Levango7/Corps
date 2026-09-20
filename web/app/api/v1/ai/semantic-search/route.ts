// POST /api/v1/ai/semantic-search — AI 语义搜索（非流式）
// 输入：{ wid, query, scope?, limit? }
// 输出：{ code: 0, data: { messages, wikis, todos, decisions, expandedKeywords, intent } }
//
// 流程：
// 1. 用 reasonerModel（deepseek-reasoner）理解查询意图，生成 3-5 个扩展关键词
// 2. 用扩展关键词在工作区内对消息/Wiki/待办/决策做多源 contains 搜索
// 3. 合并去重，按关键词匹配次数排序，返回统一格式

import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { z } from "zod";
import { requireReasonerModel, withCoT } from "@/lib/ai/deepseek";
import {
  getUserId,
  unauthorizedResponse,
  aiNotConfiguredResponse,
  isAiConfigured,
} from "@/lib/ai/shared";
import { withUsageTracking } from "@/lib/ai/usage-middleware";
import { checkRateLimit } from "@/lib/rate-limit";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { cleanJsonResponse } from "@/lib/ai/orchestrator";
import { apiMsg } from "@/lib/api-messages";
import {
  buildSemanticSearchSystemPrompt,
  buildSemanticSearchUserPrompt,
} from "@/lib/ai/prompts/semantic-search";
import { logger } from "@/lib/logger";

/** 搜索范围枚举：消息 / 文档 / 待办 / 决策 */
type SearchScope = "messages" | "wikis" | "todos" | "decisions";

const schema = z.object({
  wid: z.string().uuid(),
  query: z.string().trim().min(1).max(200),
  scope: z
    .array(z.enum(["messages", "wikis", "todos", "decisions"]))
    .default(["messages", "wikis", "todos", "decisions"]),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** AI 返回的关键词扩展结构 */
interface KeywordExpansion {
  expandedKeywords: string[];
  intent: string;
}

/** 统一消息搜索结果 */
interface MessageResult {
  id: string;
  body: string;
  createdAt: string;
  authorName: string | null;
  authorAvatar: string | null;
  matchCount: number;
}

/** 统一 Wiki 搜索结果 */
interface WikiResult {
  id: string;
  title: string;
  slug: string;
  content: string;
  updatedAt: string;
  matchCount: number;
}

/** 统一待办搜索结果 */
interface TodoResult {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  createdAt: string;
  assigneeName: string | null;
  matchCount: number;
}

/** 统一决策搜索结果 */
interface DecisionResult {
  id: string;
  taskTitle: string;
  markdown: string;
  version: number;
  createdAt: string;
  matchCount: number;
}

/** 语义搜索聚合结果 */
interface SemanticSearchData {
  messages: MessageResult[];
  wikis: WikiResult[];
  todos: TodoResult[];
  decisions: DecisionResult[];
  expandedKeywords: string[];
  intent: string;
}

/**
 * 统计文本匹配的关键词数量（大小写不敏感的子串匹配）。
 * 用于在 JS 端为每条记录计算 matchCount，支持按匹配度排序。
 */
function countKeywordMatches(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  let count = 0;
  for (const kw of keywords) {
    if (kw && lower.includes(kw.toLowerCase())) count++;
  }
  return count;
}

export async function POST(req: NextRequest) {
  // 1) 认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) AI 服务配置检查
  if (!isAiConfigured()) return aiNotConfiguredResponse(req);

  // 3) 速率限制：每分钟 10 次
  const limited = await checkRateLimit(req, "ai-semantic-search", {
    windowMs: 60_000,
    max: 10,
  });
  if (limited) return limited;

  // 4) body 校验
  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await req.json());
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
      { code: 400, message: apiMsg(req, "invalidBody"), data: null },
      { status: 400 },
    );
  }

  // 5) 工作区认证（RLS 成员资格校验）
  const ctx = await getWorkspaceContext(req, body.wid);
  if (!ctx) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  try {
    // 6) 用 reasonerModel 理解查询意图，生成扩展关键词（非流式）
    const expansionResult = await withUsageTracking(
      {
        workspaceId: body.wid,
        userId: ctx.payload.sub,
        capability: "semantic-search",
        model: requireReasonerModel().modelId,
      },
      async () => {
        const res = await generateText({
          model: requireReasonerModel(),
          system: withCoT(buildSemanticSearchSystemPrompt(), requireReasonerModel()),
          prompt: buildSemanticSearchUserPrompt(body.query),
        });
        return {
          result: res,
          usage: res.usage
            ? {
                inputTokens: res.usage.inputTokens ?? 0,
                outputTokens: res.usage.outputTokens ?? 0,
              }
            : undefined,
        };
      },
    );

    // 7) 解析 AI 返回的扩展关键词
    let expansion: KeywordExpansion;
    try {
      const parsed = JSON.parse(cleanJsonResponse(expansionResult.text)) as unknown;
      if (
        parsed != null &&
        typeof parsed === "object" &&
        Array.isArray((parsed as Record<string, unknown>).expandedKeywords) &&
        typeof (parsed as Record<string, unknown>).intent === "string"
      ) {
        const obj = parsed as Record<string, unknown>;
        const keywords = (obj.expandedKeywords as unknown[])
          .filter((k): k is string => typeof k === "string" && k.trim().length > 0)
          .map((k) => k.trim().slice(0, 50));
        // 确保原始查询在关键词列表中
        if (!keywords.some((k) => k.toLowerCase() === body.query.toLowerCase())) {
          keywords.unshift(body.query);
        }
        expansion = {
          expandedKeywords: keywords.slice(0, 8),
          intent: (obj.intent as string).slice(0, 200),
        };
      } else {
        // 降级：仅用原始查询
        expansion = { expandedKeywords: [body.query], intent: "通用搜索" };
      }
    } catch {
      // JSON 解析失败，降级为仅用原始查询
      expansion = { expandedKeywords: [body.query], intent: "通用搜索" };
    }

    const keywords = expansion.expandedKeywords;
    const scopeSet = new Set<SearchScope>(body.scope as SearchScope[]);

    // 8) 用扩展关键词在工作区内搜索（RLS 事务内）
    //    对每个数据源用 OR 条件一次查询所有关键词，然后在 JS 端统计 matchCount 去重排序。
    const raw = await runWithWorkspace(
      body.wid,
      async (tx) => {
        const orBody = keywords.map((k) => ({ body: { contains: k } }));
        const orWiki = keywords.map((k) => ({
          OR: [{ title: { contains: k } }, { content: { contains: k } }],
        }));
        const orTodo = keywords.map((k) => ({
          OR: [{ title: { contains: k } }, { description: { contains: k } }],
        }));
        const orDecision = keywords.map((k) => ({ markdown: { contains: k } }));

        const [messages, wikis, todos, decisions] = await Promise.all([
          scopeSet.has("messages")
            ? tx.message.findMany({
                where: { workspaceId: body.wid, OR: orBody },
                take: body.limit * 3,
                orderBy: { createdAt: "desc" },
                include: { author: { select: { name: true, image: true } } },
              })
            : [],
          scopeSet.has("wikis")
            ? tx.wikiPage.findMany({
                where: { workspaceId: body.wid, OR: orWiki },
                take: body.limit * 3,
                orderBy: { updatedAt: "desc" },
              })
            : [],
          scopeSet.has("todos")
            ? tx.task.findMany({
                where: { workspaceId: body.wid, OR: orTodo },
                take: body.limit * 3,
                orderBy: { createdAt: "desc" },
                include: { assignee: { select: { name: true } } },
              })
            : [],
          scopeSet.has("decisions")
            ? tx.decision.findMany({
                where: { workspaceId: body.wid, OR: orDecision },
                take: body.limit * 3,
                orderBy: { createdAt: "desc" },
                include: { task: { select: { title: true } } },
              })
            : [],
        ]);

        return { messages, wikis, todos, decisions };
      },
      ctx.payload.sub,
    );

    // 9) 合并去重，按 matchCount 降序 + 时间降序排序，截取 limit
    const messages: MessageResult[] = raw.messages
      .map((m) => ({
        id: m.id,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
        authorName: m.author?.name ?? null,
        authorAvatar: m.author?.image ?? null,
        matchCount: countKeywordMatches(m.body, keywords),
      }))
      .sort((a, b) => b.matchCount - a.matchCount || b.createdAt.localeCompare(a.createdAt))
      .slice(0, body.limit);

    const wikis: WikiResult[] = raw.wikis
      .map((w) => ({
        id: w.id,
        title: w.title,
        slug: w.slug,
        content: w.content,
        updatedAt: w.updatedAt.toISOString(),
        matchCount:
          countKeywordMatches(w.title, keywords) +
          countKeywordMatches(w.content, keywords),
      }))
      .sort((a, b) => b.matchCount - a.matchCount || b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, body.limit);

    const todos: TodoResult[] = raw.todos
      .map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        createdAt: t.createdAt.toISOString(),
        assigneeName: t.assignee?.name ?? null,
        matchCount:
          countKeywordMatches(t.title, keywords) +
          countKeywordMatches(t.description ?? "", keywords),
      }))
      .sort((a, b) => b.matchCount - a.matchCount || b.createdAt.localeCompare(a.createdAt))
      .slice(0, body.limit);

    const decisions: DecisionResult[] = raw.decisions
      .map((d) => ({
        id: d.id,
        taskTitle: d.task.title,
        markdown: d.markdown,
        version: d.version,
        createdAt: d.createdAt.toISOString(),
        matchCount: countKeywordMatches(d.markdown, keywords),
      }))
      .sort((a, b) => b.matchCount - a.matchCount || b.createdAt.localeCompare(a.createdAt))
      .slice(0, body.limit);

    const data: SemanticSearchData = {
      messages,
      wikis,
      todos,
      decisions,
      expandedKeywords: keywords,
      intent: expansion.intent,
    };

    return NextResponse.json({
      code: 0,
      data,
      message: apiMsg(req, "ok"),
    });
  } catch (error) {
    logger.error("semantic search failed", { error: String(error) });
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}