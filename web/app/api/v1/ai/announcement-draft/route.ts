// POST /api/v1/ai/announcement-draft — AI 公告智能起草（流式）
// 输入：{ wid, topic?, scope? }
// 输出：text/event-stream（Vercel AI SDK UI Message Stream）
//
// 聚合工作区近期进展（公告/决策/任务/会议等），调用 deepseek-chat 生成公告草稿。

import { NextRequest, NextResponse } from "next/server";
import { streamText } from "ai";
import { z } from "zod";
import { requireDefaultModel, withCoT } from "@/lib/ai/deepseek";
import {
  getUserId,
  unauthorizedResponse,
  aiNotConfiguredResponse,
  isAiConfigured,
} from "@/lib/ai/shared";
import { fireRecordUsage } from "@/lib/ai/usage-middleware";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { buildAiContext, type AiContextScope } from "@/lib/ai/context";
import {
  buildAnnouncementSystemPrompt,
  buildAnnouncementUserPrompt,
} from "@/lib/ai/prompts/announcement-draft";
import { getFeedbackExamples } from "@/lib/ai/feedback";
import { apiMsg } from "@/lib/api-messages";

const schema = z.object({
  wid: z.string().uuid(),
  topic: z.string().max(500).optional(),
  scope: z.array(z.string()).optional(),
});

/**
 * 高层 scope 名 → AiContextScope[] 映射。
 *
 * 用户传入的 scope 是语义化高层名（如 "tasks"），需映射到 context.ts 支持的
 * 精确 scope 值。未识别的高层名被忽略；全部无效时回退到默认集合。
 */
const SCOPE_MAP: Record<string, AiContextScope[]> = {
  announcements: ["decisions:recent", "approvals:pending"],
  decisions: ["decisions:recent"],
  tasks: ["tasks:completed:today", "tasks:overdue", "tasks:blocked"],
  meetings: ["meetings:today"],
};

/** 默认 scope：公告 + 决策 + 任务 + 会议 */
const DEFAULT_SCOPES = ["announcements", "decisions", "tasks", "meetings"];

/**
 * 将用户传入的高层 scope 名解析为去重后的 AiContextScope[]。
 * - 未传 scope 或传入空数组时使用 DEFAULT_SCOPES
 * - 未识别的高层名被忽略
 * - 全部无效时回退到默认集合，保证上下文不为空
 */
function resolveScopes(scopes?: string[]): AiContextScope[] {
  const keys = scopes && scopes.length > 0 ? scopes : DEFAULT_SCOPES;
  const out = new Set<AiContextScope>();
  for (const k of keys) {
    const mapped = SCOPE_MAP[k];
    if (mapped) for (const s of mapped) out.add(s);
  }
  if (out.size === 0) {
    for (const k of DEFAULT_SCOPES) {
      const mapped = SCOPE_MAP[k];
      if (mapped) for (const s of mapped) out.add(s);
    }
  }
  return [...out];
}

export async function POST(req: NextRequest) {
  // 1) 基础认证（确认登录身份）
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) AI 服务配置检查
  if (!isAiConfigured()) return aiNotConfiguredResponse(req);

  // 3) 速率限制：每分钟 5 次
  const limited = await checkRateLimit(req, "ai-announcement-draft", {
    windowMs: 60_000,
    max: 5,
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

  // 5) 工作区成员资格认证（wid 守卫 + RLS）+ 上下文聚合 + 流式生成
  try {
    const ctx = await getWorkspaceContext(req, body.wid);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }

    // 6) 聚合近期进展上下文（scope 解析为 AiContextScope[]）+ 查询正面反馈 few-shot 示例
    const scopes = resolveScopes(body.scope);
    const { context, feedbackExamples } = await runWithWorkspace(
      body.wid,
      async (tx) => {
        const [ctxStr, examples] = await Promise.all([
          buildAiContext(body.wid, ctx.payload.sub, scopes, tx),
          getFeedbackExamples(body.wid, "announcement-draft", 2, tx),
        ]);
        return { context: ctxStr, feedbackExamples: examples };
      },
      ctx.payload.sub,
    );

    // 7) 流式生成公告草稿
    const usageStartTime = Date.now();
    const result = streamText({
      model: requireDefaultModel(),
      system: withCoT(buildAnnouncementSystemPrompt(feedbackExamples), requireDefaultModel()),
      prompt: buildAnnouncementUserPrompt(context, body.topic),
      onFinish: ({ usage }) => {
        // 流结束后异步记录 usage（fire-and-forget）
        fireRecordUsage(
          {
            workspaceId: body.wid,
            userId: ctx.payload.sub,
            capability: "announcement-draft",
            model: requireDefaultModel().modelId,
          },
          usageStartTime,
          usage,
        );
      },
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    console.error("[ai/announcement-draft] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}
