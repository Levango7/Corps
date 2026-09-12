// POST /api/v1/ai/format — AI 文档格式化（流式）
// 输入：{ text: 选中的杂乱文本 }
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
  "你是文档格式化助手。将用户选中的杂乱文本整理为结构化的 markdown 格式。要求：1）识别标题、列表、段落等结构 2）保持原文语义不变 3）使用正确的 markdown 语法 4）适度添加层级，不要过度嵌套。只输出格式化后的 markdown，不要添加解释。";

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

  // 4) 流式格式化
  const result = streamText({
    model: defaultModel,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: body.text }],
  });

  return result.toUIMessageStreamResponse();
}