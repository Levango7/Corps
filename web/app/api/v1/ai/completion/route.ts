// POST /api/v1/ai/completion — AI 文档续写（流式）
// 输入：{ text: 光标前的文本 }
// 输出：text/event-stream（Vercel AI SDK Data Stream）

import { NextRequest, NextResponse } from "next/server";
import { streamText } from "ai";
import { z } from "zod";
import { defaultModel } from "@/lib/ai/deepseek";
import { getUserId, unauthorizedResponse, aiNotConfiguredResponse, isAiConfigured } from "@/lib/ai/shared";
import { apiMsg } from "@/lib/api-messages";

const schema = z.object({
  text: z.string().min(1).max(20_000),
});

const SYSTEM_PROMPT =
  "你是文档续写助手。根据光标前的文本内容，续写接下来的内容。只输出续写内容，不要重复已有文本。续写应当自然流畅、风格一致、长度适中（50-200字）。";

export async function POST(req: NextRequest) {
  // 1) 认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) AI 服务配置检查
  if (!isAiConfigured()) return aiNotConfiguredResponse();

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

  // 4) 流式续写
  const result = streamText({
    model: defaultModel,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: body.text }],
  });

  return result.toUIMessageStreamResponse();
}