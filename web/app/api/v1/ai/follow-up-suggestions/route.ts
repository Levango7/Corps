// POST /api/v1/ai/follow-up-suggestions — 生成追问建议（非流式）
// 输入：{ wid, question, answer }
// 输出：{ code: 200, data: { suggestions: string[] } }
//
// 使用 generateText + cleanJsonResponse + JSON.parse，模型 defaultModel。
// 速率限制：10/min。

import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { z } from "zod";
import { defaultModel, withCoT } from "@/lib/ai/deepseek";
import {
  getUserId,
  unauthorizedResponse,
  aiNotConfiguredResponse,
  isAiConfigured,
} from "@/lib/ai/shared";
import { withUsageTracking } from "@/lib/ai/usage-middleware";
import { getWorkspaceContext } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { cleanJsonResponse } from "@/lib/ai/orchestrator";
import {
  buildFollowUpSystemPrompt,
  buildFollowUpUserPrompt,
} from "@/lib/ai/prompts/follow-up";
import { apiMsg } from "@/lib/api-messages";

const schema = z.object({
  wid: z.string().uuid(),
  question: z.string().min(1).max(2000),
  answer: z.string().min(1).max(10000),
});

/**

 * 解析追问建议 JSON 数组，含格式校验与降级。
 *
 * @returns 最多 3 个追问字符串数组；解析失败返回空数组
 */
function parseSuggestions(raw: string): string[] {
  try {
    const cleaned = cleanJsonResponse(raw);
    const parsed: unknown = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .slice(0, 3);
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) AI 服务配置检查
  if (!isAiConfigured()) return aiNotConfiguredResponse(req);

  // 3) 速率限制：每分钟 10 次
  const limited = await checkRateLimit(req, "ai-follow-up-suggestions", {
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

  // 5) 工作区成员资格认证 + 生成追问建议
  try {
    const ctx = await getWorkspaceContext(req, body.wid);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }

    // 非流式生成追问建议
    const result = await withUsageTracking(
      {
        workspaceId: body.wid,
        userId: ctx.payload.sub,
        capability: "follow-up-suggestions",
        model: defaultModel.modelId,
      },
      async () => {
        const res = await generateText({
          model: defaultModel,
          system: withCoT(buildFollowUpSystemPrompt(), defaultModel),
          prompt: buildFollowUpUserPrompt(body.question, body.answer),
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

    const suggestions = parseSuggestions(result.text);

    return NextResponse.json({
      code: 200,
      data: { suggestions },
    });
  } catch (error) {
    console.error("[follow-up-suggestions] 生成失败:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}