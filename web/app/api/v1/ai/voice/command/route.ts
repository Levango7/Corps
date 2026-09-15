// POST /api/v1/ai/voice/command — 处理语音命令（非流式）
// 输入：{ workspaceId, transcript }
// 输出：{ code: 200, data: { id, intent, parameters, confidence, response, executed } }
//
// 流程：
//  1) 认证 + AI 配置检查 + 速率限制
//  2) 工作区成员资格认证
//  3) AI 意图解析（generateText + defaultModel + cleanJsonResponse + JSON.parse）
//  4) 记入 AiVoiceCommand（transcript + intent + parameters + executed=false）
//  5) 返回意图 + 参数 + 响应（前端确认后调用 PATCH 标记 executed=true）
//
// 安全约束：AI 仅解析意图，不直接执行操作；前端需用户确认后才调用对应业务 API。
// 用 withUsageTracking 包装；DEEPSEEK_API_KEY 未配置时返回 503。

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateText } from "ai";
import { Prisma } from "@prisma/client";
import { defaultModel, withCoT } from "@/lib/ai/deepseek";
import {
  getUserId,
  unauthorizedResponse,
  aiNotConfiguredResponse,
  isAiConfigured,
} from "@/lib/ai/shared";
import { withUsageTracking } from "@/lib/ai/usage-middleware";
import { cleanJsonResponse } from "@/lib/ai/orchestrator";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg, apiLocale } from "@/lib/api-messages";
import {
  buildVoiceIntentSystemPrompt,
  buildVoiceIntentPrompt,
  type VoiceIntent,
  type VoiceIntentResult,
} from "@/lib/ai/prompts/voice-intent-parse";

/** POST schema */
const schema = z.object({
  workspaceId: z.string().uuid(),
  transcript: z.string().min(1).max(4000),
});

/** 合法意图类型集合 */
const VALID_INTENTS: ReadonlySet<string> = new Set<VoiceIntent>([
  "create_task",
  "query_schedule",
  "send_message",
  "generate_report",
  "search_knowledge",
  "open_page",
  "unknown",
]);

/** 命令处理结果（返回给前端） */
interface CommandResult {
  id: string;
  intent: VoiceIntent;
  parameters: Record<string, unknown>;
  confidence: number;
  response: string;
  executed: boolean;
}

/**
 * 安全解析 JSON：cleanJsonResponse → JSON.parse，失败返回 null。
 */
function safeParseJson(text: string): unknown | null {
  try {
    return JSON.parse(cleanJsonResponse(text));
  } catch {
    return null;
  }
}

/**
 * 规范化意图解析结果。
 *
 * 校验：intent 为合法枚举；parameters 为对象；confidence 为 0-1 数值；response 为字符串。
 * fallback 响应按请求语言（locale）返回中/英文，避免英文用户拿到中文提示。
 */
function normalizeIntentResult(raw: unknown, locale: "zh" | "en"): VoiceIntentResult {
  const fallbackResponse =
    locale === "zh"
      ? "抱歉，意图解析失败，请再说一遍。"
      : "Sorry, intent parsing failed. Please try again.";
  const fallback: VoiceIntentResult = {
    intent: "unknown",
    parameters: {},
    confidence: 0,
    response: fallbackResponse,
  };
  if (raw == null || typeof raw !== "object") return fallback;
  const obj = raw as Record<string, unknown>;

  const intent =
    typeof obj.intent === "string" && VALID_INTENTS.has(obj.intent)
      ? (obj.intent as VoiceIntent)
      : "unknown";

  const parameters: Record<string, unknown> =
    obj.parameters != null && typeof obj.parameters === "object"
      ? (obj.parameters as Record<string, unknown>)
      : {};

  const confidence =
    typeof obj.confidence === "number" && obj.confidence >= 0 && obj.confidence <= 1
      ? obj.confidence
      : 0;

  const response =
    typeof obj.response === "string" ? obj.response.slice(0, 1000) : fallback.response;

  return { intent, parameters, confidence, response };
}

export async function POST(req: NextRequest) {
  // 1) 认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) AI 服务配置检查
  if (!isAiConfigured()) return aiNotConfiguredResponse(req);

  // 3) 速率限制：每分钟 10 次
  const limited = await checkRateLimit(req, "ai-voice-command", {
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

  // 5) 工作区成员资格认证
  const ctx = await getWorkspaceContext(req, body.workspaceId);
  if (!ctx) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  // 6) AI 意图解析 + 持久化
  try {
    const result = await withUsageTracking(
      {
        workspaceId: body.workspaceId,
        userId: ctx.payload.sub,
        capability: "voice-command",
        model: defaultModel.modelId,
      },
      async () => {
        // 6.1) 调用 AI 解析意图
        const res = await generateText({
          model: defaultModel,
          system: withCoT(buildVoiceIntentSystemPrompt(), defaultModel),
          prompt: buildVoiceIntentPrompt(body.transcript, ""),
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

    // 6.2) 解析 AI 输出（fallback 响应按请求语言）
    const parsed = normalizeIntentResult(safeParseJson(result.text), apiLocale(req));

    // 6.3) 持久化到 AiVoiceCommand
    const command = await runWithWorkspace(
      body.workspaceId,
      (tx) =>
        tx.aiVoiceCommand.create({
          data: {
            workspaceId: body.workspaceId,
            userId: ctx.payload.sub,
            transcript: body.transcript,
            intent: parsed.intent,
            parameters: parsed.parameters as Prisma.InputJsonValue,
            executed: false,
          },
          select: {
            id: true,
            executed: true,
          },
        }),
      ctx.payload.sub,
    );

    // 6.4) 返回结果
    const data: CommandResult = {
      id: command.id,
      intent: parsed.intent,
      parameters: parsed.parameters,
      confidence: parsed.confidence,
      response: parsed.response,
      executed: command.executed,
    };

    return NextResponse.json({ code: 200, data, message: "OK" });
  } catch (error) {
    console.error("[POST ai/voice/command] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}