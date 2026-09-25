// POST /api/v1/ai/knowledge/query — 基于知识图谱的深度问答（非流式）
// 输入：{ wid, question: string }
// 输出：{ code: 200, data: { answer: string, relatedNodes: KnowledgeNode[] } }
//
// 流程：
//   1. 认证 + AI 配置检查 + 限流 + body 校验 + 工作区上下文校验
//   2. 在 RLS 事务内检索相关节点（关键词匹配 label/content）
//   3. generateText（defaultModel + withCoT）基于检索到的知识点生成回答
//   4. withUsageTracking 包装

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
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";

const schema = z.object({
  wid: z.string().uuid(),
  question: z.string().min(1).max(2000),
});

/** 检索相关节点的最大数量 */
const MAX_RELATED_NODES = 20;
/** 单个关键词最大长度 */
const MAX_KEYWORD_LEN = 50;

/**
 * 从问题中提取检索关键词（简单分词）。
 * 按空格/标点分割，过滤空字符串和过长 token。
 */
function extractKeywords(question: string): string[] {
  return question
    .split(/][\s,，。.!?！？;；:：、（）()【[]{}""''`]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= MAX_KEYWORD_LEN)
    .slice(0, 10);
}

export async function POST(req: NextRequest) {
  // 1) 认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) AI 服务配置检查
  if (!isAiConfigured()) return aiNotConfiguredResponse(req);

  // 3) 速率限制：每分钟 10 次
  const limited = await checkRateLimit(req, "ai-knowledge-query", {
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

  // 5) 工作区上下文校验
  const ctx = await getWorkspaceContext(req, body.wid);
  if (!ctx) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  // 6) 检索相关节点 + AI 生成回答
  try {
    // 6.1) 在 RLS 事务内检索相关节点（关键词匹配 label/content）
    const keywords = extractKeywords(body.question);

    const relatedNodes = await runWithWorkspace(
      body.wid,
      async (tx) => {
        if (keywords.length === 0) return [];

        // 用 OR 条件检索：label 或 content 包含任一关键词
        // Prisma 的 contains + mode: insensitive 支持大小写不敏感
        const orConditions = keywords.flatMap((kw) => [
          { label: { contains: kw, mode: "insensitive" as const } },
          { content: { contains: kw, mode: "insensitive" as const } },
        ]);

        return tx.knowledgeNode.findMany({
          where: {
            workspaceId: body.wid,
            OR: orConditions,
          },
          take: MAX_RELATED_NODES,
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            type: true,
            label: true,
            content: true,
            sourceType: true,
            sourceId: true,
          },
        });
      },
      ctx.payload.sub,
    );

    // 6.2) 组装上下文
    const contextMarkdown =
      relatedNodes.length > 0
        ? relatedNodes
            .map((n) => `### ${n.label}（类型：${n.type}）\n${n.content}\n来源：${n.sourceType}`)
            .join("\n\n")
        : "（未检索到相关知识点）";

    const systemPrompt = withCoT(
      `你是企业知识图谱问答助手。基于检索到的知识图谱节点回答用户问题。

## 回答规则
1. 仅基于提供的知识点回答，不要编造不存在的信息
2. 如果知识点不足以回答，明确告知用户并建议补充更多知识来源
3. 回答用 Markdown 格式，结构清晰
4. 引用知识点时标注其类型和来源
5. 中文回答

## 检索到的知识点
${contextMarkdown}`,
      requireDefaultModel(),
    );

    // 6.3) AI 生成回答（非流式，withUsageTracking 包装）
    const answer = await withUsageTracking(
      {
        workspaceId: body.wid,
        userId: ctx.payload.sub,
        capability: "knowledge-query",
        model: requireDefaultModel().modelId,
      },
      async () => {
        const llmResult = await generateText({
          model: requireDefaultModel(),
          system: systemPrompt,
          prompt: body.question,
        });
        return {
          result: llmResult.text,
          usage: {
            inputTokens: llmResult.usage.inputTokens ?? 0,
            outputTokens: llmResult.usage.outputTokens ?? 0,
          },
        };
      },
    );

    return NextResponse.json({
      code: 200,
      data: { answer, relatedNodes },
    });
  } catch (error) {
    console.error("[ai/knowledge/query] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}
