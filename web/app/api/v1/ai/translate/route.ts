// POST /api/v1/ai/translate — AI 文档翻译（流式）
// 输入：{ text: 选中的文本, targetLang: "zh" | "en" | "ja" }
// 输出：text/event-stream（Vercel AI SDK Data Stream）

import { NextRequest, NextResponse } from "next/server";
import { streamText } from "ai";
import { z } from "zod";
import { defaultModel } from "@/lib/ai/deepseek";
import { getUserId, unauthorizedResponse, aiNotConfiguredResponse, isAiConfigured } from "@/lib/ai/shared";
import { apiMsg } from "@/lib/api-messages";

const schema = z.object({
  text: z.string().min(1).max(20_000),
  targetLang: z.enum(["zh", "en", "ja"]),
});

/** 根据目标语言生成 system prompt */
function buildSystemPrompt(targetLang: "zh" | "en" | "ja"): string {
  const targetLabel: Record<"zh" | "en" | "ja", string> = {
    zh: "中文",
    en: "英文",
    ja: "日文",
  };
  return `你是翻译助手。将用户选中的文本翻译成${targetLabel[targetLang]}。只输出翻译结果，不要添加任何解释或说明。保持原文的格式（如 markdown 标记、换行）不变。`;
}

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

  // 4) 流式翻译
  const result = streamText({
    model: defaultModel,
    system: buildSystemPrompt(body.targetLang),
    messages: [{ role: "user", content: body.text }],
  });

  return result.toUIMessageStreamResponse();
}