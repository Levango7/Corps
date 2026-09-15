// POST /api/v1/ai/format — AI 文档格式化（流式）
// 输入：{ text: 选中的杂乱文本 }
// 输出：text/event-stream（Vercel AI SDK Data Stream）

import { NextRequest, NextResponse } from "next/server";
import { streamText } from "ai";
import { z } from "zod";
import { defaultModel } from "@/lib/ai/deepseek";
import { getUserIdAndWorkspaceId, unauthorizedResponse, aiNotConfiguredResponse, isAiConfigured } from "@/lib/ai/shared";
import { fireRecordUsage } from "@/lib/ai/usage-middleware";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";

const schema = z.object({
  text: z.string().min(1).max(20_000),
});

const SYSTEM_PROMPT =
  "你是文档格式化助手。将用户选中的杂乱文本整理为结构化的 markdown 格式。要求：1）识别标题、列表、段落等结构 2）保持原文语义不变 3）使用正确的 markdown 语法 4）适度添加层级，不要过度嵌套。只输出格式化后的 markdown，不要添加解释。";

export async function POST(req: NextRequest) {
  // 1) 认证 + 获取 workspaceId（用于 usage tracking）
  const authCtx = await getUserIdAndWorkspaceId(req);
  if (!authCtx) return unauthorizedResponse(req);

  // 2) AI 服务配置检查
  if (!isAiConfigured()) return aiNotConfiguredResponse(req);

  // 2.5) 限流：60s 内最多 20 次
  const limited = await checkRateLimit(req, "ai-format", { windowMs: 60_000, max: 20 });
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
    return NextResponse.json({ code: 400, message: apiMsg(req, "invalidBody"), data: null }, { status: 400 });
  }

  // 4) 流式格式化
  try {
    const usageStartTime = Date.now();
    const result = streamText({
      model: defaultModel,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: body.text }],
      onFinish: ({ usage }) => {
        if (authCtx.workspaceId) {
          fireRecordUsage(
            {
              workspaceId: authCtx.workspaceId,
              userId: authCtx.userId,
              capability: "format",
              model: defaultModel.modelId,
            },
            usageStartTime,
            usage,
          );
        }
      },
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    console.error("[ai/format] error:", error);
    return NextResponse.json(
      { code: 503, message: "AI service unavailable", data: null },
      { status: 503 },
    );
  }
}