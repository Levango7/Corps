// POST /api/v1/ai/chat — AI 文档问答（流式）
// 输入：{ question, documentContent, history? }
// 输出：text/event-stream（Vercel AI SDK Data Stream）

import { NextRequest, NextResponse } from "next/server";
import { streamText } from "ai";
import { z } from "zod";
import { defaultModel } from "@/lib/ai/deepseek";
import { getUserId, unauthorizedResponse, aiNotConfiguredResponse, isAiConfigured } from "@/lib/ai/shared";
import { apiMsg } from "@/lib/api-messages";

const schema = z.object({
  question: z.string().min(1).max(20_000),
  documentContent: z.string().max(100_000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      }),
    )
    .max(100)
    .optional(),
});

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

  // 4) 组装消息：history（过往对话）+ 当前 question
  const messages = [
    ...(body.history ?? []),
    { role: "user" as const, content: body.question },
  ];

  // 5) 流式问答：system 注入文档内容作为上下文
  const result = streamText({
    model: defaultModel,
    system: `你是文档问答助手。根据以下文档内容回答用户问题。如果问题超出文档范围，请如实告知。\n\n文档内容：\n${body.documentContent}`,
    messages,
  });

  return result.toUIMessageStreamResponse();
}