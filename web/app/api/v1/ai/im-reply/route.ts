// POST /api/v1/ai/im-reply — IM 智能回复建议（非流式）
// 输入：{ wid, conversationId?, taskId?, messageId? }
// 输出：{ code: 200, data: ImReplySuggestion[] }
//
// 使用 deepseek-chat 通用模型分析最近 20 条聊天上下文，
// 为用户生成 3 个不同风格的回复建议（正式/随意/简洁），
// 点击即可填入输入框发送。

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
  buildImReplySystemPrompt,
  buildImReplyUserPrompt,
} from "@/lib/ai/prompts/im-reply";

const schema = z.object({
  wid: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
  messageId: z.string().uuid().optional(),
});

/** AI 返回的回复建议结构 */
interface ImReplySuggestion {
  text: string;
  tone: "formal" | "casual" | "concise";
}


export async function POST(req: NextRequest) {
  // 1) 认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) AI 服务配置检查
  if (!isAiConfigured()) return aiNotConfiguredResponse(req);

  // 3) 速率限制：每分钟 10 次
  const limited = await checkRateLimit(req, "ai-im-reply", {
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
    // 6) 查询最近 20 条消息（按 messageId/conversationId/taskId 过滤）
    const rawMessages = await runWithWorkspace(
      body.wid,
      async (tx) => {
        return tx.message.findMany({
          where: {
            workspaceId: body.wid,
            ...(body.messageId ? { id: body.messageId } : {}),
            ...(body.conversationId ? { conversationId: body.conversationId } : {}),
            ...(body.taskId ? { taskId: body.taskId } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: 20,
          include: { author: { select: { name: true } } },
        });
      },
      ctx.payload.sub,
    );

    // 反转为时间正序，构造 LLM 输入参数
    const messages = rawMessages
      .slice()
      .reverse()
      .map((m) => ({
        author: m.author?.name ?? "未知",
        body: m.body,
        createdAt: m.createdAt.toISOString(),
      }));

    // 7) 调用 deepseek-chat（非流式）
    const result = await withUsageTracking(
      {
        workspaceId: body.wid,
        userId: ctx.payload.sub,
        capability: "im-reply",
        model: requireDefaultModel().modelId,
      },
      async () => {
        const res = await generateText({
          model: requireDefaultModel(),
          system: withCoT(buildImReplySystemPrompt(), requireDefaultModel()),
          prompt: buildImReplyUserPrompt(messages),
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
    let suggestions: ImReplySuggestion[];
    try {
      const parsed = JSON.parse(cleanJsonResponse(result.text)) as unknown;
      suggestions = Array.isArray(parsed)
        ? parsed
            .filter(
              (s): s is ImReplySuggestion =>
                s != null &&
                typeof s.text === "string" &&
                (s.tone === "formal" ||
                  s.tone === "casual" ||
                  s.tone === "concise"),
            )
            .slice(0, 3)
        : [];
    } catch {
      // JSON 解析失败，返回降级空建议
      suggestions = [];
    }

    return NextResponse.json({ code: 200, data: suggestions });
  } catch (error) {
    console.error("[ai/im-reply] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}