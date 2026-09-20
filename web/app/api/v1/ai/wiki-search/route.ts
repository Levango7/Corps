// POST /api/v1/ai/wiki-search — Wiki 语义搜索（非流式）
// 输入：{ wid, query, limit? }
// 输出：{ code: 200, data: { results: [{ pageId, title, relevanceScore, summary, highlight }] } }
//
// 先用 PostgreSQL ILIKE 全文检索获取候选 WikiPage（最多 20 条），
// 再调用 deepseek-chat 对候选结果进行语义重排与摘要，返回按相关性排序的结果。

import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { z } from "zod";
import { requireDefaultModel, withCoT } from "@/lib/ai/deepseek";
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
  buildWikiSearchSystemPrompt,
  buildWikiSearchUserPrompt,
} from "@/lib/ai/prompts/wiki-search";

const schema = z.object({
  wid: z.string().uuid(),
  query: z.string().min(1).max(500),
  limit: z.number().int().min(1).max(20).default(10),
});

/** AI 返回的单条搜索结果 */
interface WikiSearchResult {
  pageId: string;
  title: string;
  relevanceScore: number;
  summary: string;
  highlight: string;
}


export async function POST(req: NextRequest) {
  // 1) 认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) AI 服务配置检查
  if (!isAiConfigured()) return aiNotConfiguredResponse(req);

  // 3) 速率限制：每分钟 10 次
  const limited = await checkRateLimit(req, "ai-wiki-search", {
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
    // 6) PostgreSQL ILIKE 全文检索候选 WikiPage（最多 20 条）
    const pages = await runWithWorkspace(
      body.wid,
      (tx) =>
        tx.wikiPage.findMany({
          where: {
            workspaceId: body.wid,
            OR: [
              { title: { contains: body.query, mode: "insensitive" } },
              { content: { contains: body.query, mode: "insensitive" } },
            ],
          },
          take: 20,
          select: { id: true, title: true, content: true },
        }),
      ctx.payload.sub,
    );

    // 无候选结果，直接返回空数组
    if (pages.length === 0) {
      return NextResponse.json({
        code: 200,
        data: { results: [] },
      });
    }

    // 7) 调用 deepseek-chat 对候选结果语义重排与摘要（非流式）
    const result = await withUsageTracking(
      {
        workspaceId: body.wid,
        userId: ctx.payload.sub,
        capability: "wiki-search",
        model: requireDefaultModel().modelId,
      },
      async () => {
        const res = await generateText({
          model: requireDefaultModel(),
          system: withCoT(buildWikiSearchSystemPrompt(), requireDefaultModel()),
          prompt: buildWikiSearchUserPrompt(body.query, pages),
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

    // 8) 解析 JSON 返回
    let results: WikiSearchResult[] = [];
    try {
      const parsed = JSON.parse(cleanJsonResponse(result.text)) as { results?: unknown };
      if (Array.isArray(parsed.results)) {
        results = parsed.results
          .filter(
            (r): r is WikiSearchResult =>
              r != null &&
              typeof r.pageId === "string" &&
              typeof r.title === "string" &&
              typeof r.relevanceScore === "number" &&
              typeof r.summary === "string" &&
              typeof r.highlight === "string",
          )
          .slice(0, body.limit);
      }
    } catch {
      // JSON 解析失败，返回空结果
      results = [];
    }

    return NextResponse.json({
      code: 200,

      data: { results },
    });
  } catch (error) {
    console.error("[ai/wiki-search] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}