// POST /api/v1/ai/mail-assistant — AI 邮件助手（起草 / 摘要 / 分类 / 回复）
//
// 输入：{ wid, action: "draft"|"summarize"|"classify"|"reply", content, context? }
// 输出：
//   - draft：text/event-stream（Vercel AI SDK UI Message Stream，逐字流式邮件正文）
//   - summarize：{ code: 0, data: { summary: string }, message }
//   - classify：{ code: 0, data: { category, confidence, reason }, message }
//   - reply：{ code: 0, data: { suggestions: [{ text, tone }] }, message }
//
// 模型选择：
//   - draft / summarize / reply：defaultModel（deepseek-chat，通用对话/续写）
//   - classify：reasonerModel（deepseek-reasoner，分类需要轻量推理）
//
// 限流：每分钟 10 次（按用户维度）；与 im-reply / announcement-draft 等同量级。

import { NextRequest, NextResponse } from "next/server";
import { streamText, generateText } from "ai";
import { z } from "zod";
import { defaultModel, reasonerModel, withCoT } from "@/lib/ai/deepseek";
import {
  getUserId,
  unauthorizedResponse,
  aiNotConfiguredResponse,
  isAiConfigured,
} from "@/lib/ai/shared";
import { withUsageTracking, fireRecordUsage } from "@/lib/ai/usage-middleware";
import { checkRateLimit } from "@/lib/rate-limit";
import { getWorkspaceContext } from "@/lib/auth";
import { cleanJsonResponse } from "@/lib/ai/orchestrator";
import { apiMsg } from "@/lib/api-messages";
import {
  buildMailDraftSystemPrompt,
  buildMailDraftUserPrompt,
  buildMailSummarizeSystemPrompt,
  buildMailSummarizeUserPrompt,
  buildMailClassifySystemPrompt,
  buildMailClassifyUserPrompt,
  buildMailReplySystemPrompt,
  buildMailReplyUserPrompt,
  type MailCategory,
  type MailReplyTone,
} from "@/lib/ai/prompts/mail-assistant";
import { logger } from "@/lib/logger";

/** 邮件助手支持的操作类型 */
type MailAction = "draft" | "summarize" | "classify" | "reply";

const schema = z.object({
  wid: z.string().uuid(),
  action: z.enum(["draft", "summarize", "classify", "reply"]),
  content: z.string().min(1).max(20_000),
  context: z.string().max(5000).optional(),
});

/** 分类结果结构（与 prompt 输出契约一致） */
interface ClassifyResult {
  category: MailCategory;
  confidence: number;
  reason: string;
}

/** 单条回复建议结构 */
interface ReplySuggestion {
  text: string;
  tone: MailReplyTone;
}

/** 合法类别白名单（用于运行时校验 LLM 输出） */
const VALID_CATEGORIES: ReadonlySet<MailCategory> = new Set([
  "work",
  "notice",
  "personal",
  "urgent",
  "other",
]);

/** 合法语气白名单 */
const VALID_TONES: ReadonlySet<MailReplyTone> = new Set([
  "formal",
  "casual",
  "concise",
]);

export async function POST(req: NextRequest) {
  // 1) 认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) AI 服务配置检查
  if (!isAiConfigured()) return aiNotConfiguredResponse(req);

  // 3) 速率限制：每分钟 10 次
  const limited = await checkRateLimit(req, "ai-mail-assistant", {
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

  const action: MailAction = body.action;
  const content = body.content;
  const context = body.context;

  try {
    // ─── 起草：流式生成邮件正文 ───
    if (action === "draft") {
      const usageStartTime = Date.now();
      const result = streamText({
        model: defaultModel,
        system: withCoT(buildMailDraftSystemPrompt(), defaultModel),
        prompt: buildMailDraftUserPrompt(content, context),
        onFinish: ({ usage }) => {
          fireRecordUsage(
            {
              workspaceId: body.wid,
              userId: ctx.payload.sub,
              capability: "mail-assistant-draft",
              model: defaultModel.modelId,
            },
            usageStartTime,
            usage,
          );
        },
      });
      return result.toUIMessageStreamResponse();
    }

    // ─── 摘要：非流式生成要点列表 ───
    if (action === "summarize") {
      const summary = await withUsageTracking(
        {
          workspaceId: body.wid,
          userId: ctx.payload.sub,
          capability: "mail-assistant-summarize",
          model: defaultModel.modelId,
        },
        async () => {
          const res = await generateText({
            model: defaultModel,
            system: withCoT(buildMailSummarizeSystemPrompt(), defaultModel),
            prompt: buildMailSummarizeUserPrompt(content),
          });
          return {
            result: res.text,
            usage: res.usage
              ? {
                  inputTokens: res.usage.inputTokens ?? 0,
                  outputTokens: res.usage.outputTokens ?? 0,
                }
              : undefined,
          };
        },
      );

      return NextResponse.json({
        code: 0,
        data: { summary: summary.trim() },
        message: apiMsg(req, "ok"),
      });
    }

    // ─── 分类：reasoner 模型 + JSON 输出 ───
    if (action === "classify") {
      const resultText = await withUsageTracking(
        {
          workspaceId: body.wid,
          userId: ctx.payload.sub,
          capability: "mail-assistant-classify",
          model: reasonerModel.modelId,
        },
        async () => {
          const res = await generateText({
            model: reasonerModel,
            system: withCoT(buildMailClassifySystemPrompt(), reasonerModel),
            prompt: buildMailClassifyUserPrompt(content),
          });
          return {
            result: res.text,
            usage: res.usage
              ? {
                  inputTokens: res.usage.inputTokens ?? 0,
                  outputTokens: res.usage.outputTokens ?? 0,
                }
              : undefined,
          };
        },
      );

      // 解析 JSON 并校验
      let classifyResult: ClassifyResult;
      try {
        const parsed = JSON.parse(cleanJsonResponse(resultText)) as unknown;
        if (
          parsed != null &&
          typeof parsed === "object" &&
          typeof (parsed as Record<string, unknown>).category === "string" &&
          VALID_CATEGORIES.has((parsed as Record<string, unknown>).category as MailCategory) &&
          typeof (parsed as Record<string, unknown>).confidence === "number" &&
          typeof (parsed as Record<string, unknown>).reason === "string"
        ) {
          const obj = parsed as {
            category: MailCategory;
            confidence: number;
            reason: string;
          };
          classifyResult = {
            category: obj.category,
            confidence: Math.min(Math.max(obj.confidence, 0), 1),
            reason: obj.reason,
          };
        } else {
          // JSON 结构不合法，降级为 other
          classifyResult = {
            category: "other",
            confidence: 0,
            reason: "",
          };
        }
      } catch {
        // JSON 解析失败，降级为 other
        classifyResult = {
          category: "other",
          confidence: 0,
          reason: "",
        };
      }

      return NextResponse.json({
        code: 0,
        data: classifyResult,
        message: apiMsg(req, "ok"),
      });
    }

    // ─── 回复：非流式生成 3 个回复建议 ───
    // action === "reply"
    const resultText = await withUsageTracking(
      {
        workspaceId: body.wid,
        userId: ctx.payload.sub,
        capability: "mail-assistant-reply",
        model: defaultModel.modelId,
      },
      async () => {
        const res = await generateText({
          model: defaultModel,
          system: withCoT(buildMailReplySystemPrompt(), defaultModel),
          prompt: buildMailReplyUserPrompt(content, context),
        });
        return {
          result: res.text,
          usage: res.usage
            ? {
                inputTokens: res.usage.inputTokens ?? 0,
                outputTokens: res.usage.outputTokens ?? 0,
              }
            : undefined,
        };
      },
    );

    // 解析 JSON 数组并校验
    let suggestions: ReplySuggestion[];
    try {
      const parsed = JSON.parse(cleanJsonResponse(resultText)) as unknown;
      suggestions = Array.isArray(parsed)
        ? parsed
            .filter(
              (s): s is ReplySuggestion =>
                s != null &&
                typeof s.text === "string" &&
                typeof s.tone === "string" &&
                VALID_TONES.has(s.tone as MailReplyTone),
            )
            .slice(0, 3)
        : [];
    } catch {
      // JSON 解析失败，返回降级空建议
      suggestions = [];
    }

    return NextResponse.json({
      code: 0,
      data: { suggestions },
      message: apiMsg(req, "ok"),
    });
  } catch (error) {
    logger.error("mail assistant failed", { error: String(error) });
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}