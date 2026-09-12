// POST /api/v1/ai/summarize — AI 文档摘要（流式）
// 输入：{ text: 选中的文本 }
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
  "你是文档摘要助手。将用户选中的文本生成简洁摘要。摘要应当：1）保留核心观点和关键信息 2）使用要点列表格式 3）每个要点不超过一行 4）总长度不超过原文的30%。输出 markdown 格式。";

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

  // 4) 流式摘要
  const result = streamText({
    model: defaultModel,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: body.text }],
  });

  return result.toUIMessageStreamResponse();
}