// POST /api/v1/ai/completion — AI 文档续写（流式）
// 输入：{ text: 光标前的文本 }
// 输出：text/event-stream（Vercel AI SDK Data Stream）

import { NextRequest, NextResponse } from "next/server";
import { streamText } from "ai";
import { z } from "zod";
import { requireDefaultModel } from "@/lib/ai/deepseek";
import {
  getUserIdAndWorkspaceId,
  unauthorizedResponse,
  aiNotConfiguredResponse,
  isAiConfigured,
} from "@/lib/ai/shared";
import { fireRecordUsage } from "@/lib/ai/usage-middleware";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";

const schema = z.object({
  text: z.string().min(1).max(20_000),
});

const SYSTEM_PROMPT =
  "你是文档续写助手。根据光标前的文本内容，续写接下来的内容。只输出续写内容，不要重复已有文本。续写应当自然流畅、风格一致、长度适中（50-200字）。";

export async function POST(req: NextRequest) {
  // 1) 认证 + 获取 workspaceId（用于 usage tracking）
  const authCtx = await getUserIdAndWorkspaceId(req);
  if (!authCtx) return unauthorizedResponse(req);

  // 2) AI 服务配置检查
  if (!isAiConfigured()) return aiNotConfiguredResponse(req);

  // 2.5) 限流：60s 内最多 20 次
  const limited = await checkRateLimit(req, "ai-completion", { windowMs: 60_000, max: 20 });
  if (limited) return limited;

  // 3) body 校验
  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: e.issues[0]?.message ?? apiMsg(req, "validationFailed"), data: null },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "invalidBody"), data: null },
      { status: 400 },
    );
  }

  // 4) 流式续写
  try {
    const usageStartTime = Date.now();
    const result = streamText({
      model: requireDefaultModel(),
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: body.text }],
      onFinish: ({ usage }) => {
        // 流结束后异步记录 usage（fire-and-forget）
        if (authCtx.workspaceId) {
          fireRecordUsage(
            {
              workspaceId: authCtx.workspaceId,
              userId: authCtx.userId,
              capability: "completion",
              model: requireDefaultModel().modelId,
            },
            usageStartTime,
            usage,
          );
        }
      },
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    console.error("[ai/completion] error:", error);
    return NextResponse.json(
      { code: 503, message: "AI service unavailable", data: null },
      { status: 503 },
    );
  }
}
