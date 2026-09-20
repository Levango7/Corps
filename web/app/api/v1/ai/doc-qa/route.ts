// POST /api/v1/ai/doc-qa — AI 文档问答（RAG 简化版，流式）
// 输入：{ wid, question, docIds? }
// 输出：text/event-stream（Vercel AI SDK UI Message Stream）
//
// RAG 流程：
// 1. 检索相关 WikiPage（指定 docIds 时按 ID 查询；否则按问题关键词 ILIKE 搜索）
// 2. 将检索到的文档作为上下文注入 user prompt
// 3. 调用 deepseek-reasoner 流式生成基于文档的回答
//
// 认证 / 限流 / 使用量跟踪与 knowledge-qa 路由同源，仅模型改为 reasonerModel
// （文档问答需要更强的推理能力来精确定位文档内容并引用来源）。

import { NextRequest, NextResponse } from "next/server";
import { streamText } from "ai";
import { z } from "zod";
import { requireReasonerModel, withCoT } from "@/lib/ai/deepseek";
import {
  getUserId,
  unauthorizedResponse,
  aiNotConfiguredResponse,
  isAiConfigured,
} from "@/lib/ai/shared";
import { fireRecordUsage } from "@/lib/ai/usage-middleware";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  buildDocQaSystemPrompt,
  buildDocQaUserPrompt,
} from "@/lib/ai/prompts/doc-qa";
import { apiMsg } from "@/lib/api-messages";

const schema = z.object({
  wid: z.string().uuid(),
  question: z.string().min(1).max(2000),
  /** 指定文档范围（可选）；不传时按问题关键词搜索 */
  docIds: z.array(z.string().uuid()).optional(),
});

export async function POST(req: NextRequest) {
  // 1) 基础认证（确认登录身份）
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) AI 服务配置检查
  if (!isAiConfigured()) return aiNotConfiguredResponse(req);

  // 3) 速率限制：每分钟 20 次
  const limited = await checkRateLimit(req, "ai-doc-qa", {
    windowMs: 60_000,
    max: 20,
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

  // 5) 工作区成员资格认证（wid 守卫 + RLS）+ 文档检索 + 流式生成
  try {
    const ctx = await getWorkspaceContext(req, body.wid);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }

    // 6) 检索相关文档（RLS 事务内，仅检索用户有权限查看的 WikiPage）
    const documents = await runWithWorkspace(
      body.wid,
      (tx) => {
        if (body.docIds && body.docIds.length > 0) {
          // 指定文档范围：按 ID 查询（最多 10 篇，避免 prompt 膨胀）
          return tx.wikiPage.findMany({
            where: {
              workspaceId: body.wid,
              id: { in: body.docIds },
            },
            select: { id: true, title: true, content: true },
            take: 10,
          });
        }
        // 未指定范围：按问题关键词 ILIKE 搜索 title / content（最多 5 篇）
        return tx.wikiPage.findMany({
          where: {
            workspaceId: body.wid,
            OR: [
              { title: { contains: body.question, mode: "insensitive" } },
              { content: { contains: body.question, mode: "insensitive" } },
            ],
          },
          select: { id: true, title: true, content: true },
          take: 5,
        });
      },
      ctx.payload.sub,
    );

    // 7) 组装 prompt（系统提示 + 含文档上下文的用户提示）
    const userPrompt = buildDocQaUserPrompt(
      body.question,
      documents.map((d) => ({ title: d.title, content: d.content })),
    );
    const systemPrompt = withCoT(buildDocQaSystemPrompt(), requireReasonerModel());

    // 8) 流式生成回答（reasonerModel 提供更强的推理能力用于文档定位与引用）
    const usageStartTime = Date.now();
    const result = streamText({
      model: requireReasonerModel(),
      system: systemPrompt,
      prompt: userPrompt,
      onFinish: ({ usage }) => {
        // 流结束后异步记录 usage（fire-and-forget）
        fireRecordUsage(
          {
            workspaceId: body.wid,
            userId: ctx.payload.sub,
            capability: "doc-qa",
            model: requireReasonerModel().modelId,
          },
          usageStartTime,
          usage,
        );
      },
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    console.error("[ai/doc-qa] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}