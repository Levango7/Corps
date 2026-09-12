// POST /api/v1/workspaces/{wid}/decisions/extract — AI 决策提炼
// 输入：{ sourceText: 粘贴的会议记录/讨论内容 }
// 输出：{ title, markdown, suggestedTags, provider }
// 实现策略：DEEPSEEK_API_KEY 已配置时用 DeepSeek reasoner 模型（deepseek-reasoner）
// 做深度推理提取；未配置或 LLM 调用失败时 fallback 到模板化规则提取（rules-v1）。
// 接口输入输出格式不变，后端实现渐进替换，不会给用户带来 API 破坏性变更。

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";
import { generateText } from "ai";
import { reasonerModel } from "@/lib/ai/deepseek";
import { isAiConfigured } from "@/lib/ai/shared";

const schema = z.object({
  sourceText: z.string().min(10).max(20_000),
});

/** 决策关键词中文 + 英文（高频） */
const DECISION_KEYWORDS = [
  "决定",
  "决策",
  "结论",
  "确认",
  "拍板",
  "最终",
  "定稿",
  "decide",
  "decision",
  "final",
  "agree",
  "approved",
  "ship it",
  "ok,",
  "OK",
];

/** 抽取"关键句"的工具：命中决策关键词的行优先，否则按长度 top-N */
function pickKeySentences(lines: string[], limit = 5): string[] {
  const hit: string[] = [];
  const rest: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (DECISION_KEYWORDS.some((k) => trimmed.includes(k))) hit.push(trimmed);
    else rest.push(trimmed);
  }
  const merged = [...hit, ...rest];
  return merged.slice(0, limit);
}

/** 抽取"标题"：找第一个 markdown 标题或 \n\n 之间最长的短语 */
function pickTitle(lines: string[]): string {
  for (const line of lines) {
    const m = line.match(/^#{1,6}\s+(.+)/);
    if (m && m[1]) return m[1].trim().slice(0, 60);
  }
  // 没有 markdown 标题：找第一个 8-40 字符的短语
  for (const line of lines) {
    const t = line.trim().replace(/[。！？!?.]+$/, "");
    if (t.length >= 8 && t.length <= 60) return t.slice(0, 60);
  }
  // 兜底：首行前 40 字
  return (lines[0] ?? "决策草稿").trim().slice(0, 40);
}

/** 规则版提取：分行→关键词命中优先→markdown 模板化输出 */
function extractByRules(sourceText: string): {
  title: string;
  markdown: string;
  suggestedTags: string[];
} {
  const lines = sourceText.split(/\r?\n/);
  const title = pickTitle(lines);
  const keyPoints = pickKeySentences(lines);

  // 组装 markdown：<背景 / 结论 / 关键理由 / 下一步行动> 四段式
  const markdown = [
    `# ${title}`,
    "",
    "## 关键结论",
    ...keyPoints.map((s) => `- ${s}`),
    "",
    "## 原始讨论（节选）",
    "",
    "```",
    sourceText.slice(0, 800),
    "```",
    "",
    "> 本内容由 AI 根据提供的原始讨论提炼，请人工核对后再正式归档。",
  ].join("\n");

  const suggestedTags = DECISION_KEYWORDS.filter((k) =>
    sourceText.toLowerCase().includes(k.toLowerCase()),
  ).slice(0, 5);

  return { title, markdown, suggestedTags };
}

/** 清理 LLM 返回的 JSON 文本：去掉 ```json ... ``` 代码块包裹 */
function cleanJsonResponse(text: string): string {
  let t = text.trim();
  const fenceMatch = t.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/);
  if (fenceMatch && fenceMatch[1]) {
    t = fenceMatch[1].trim();
  }
  return t;
}

/** LLM 提取：用 DeepSeek reasoner 模型从源文本中提炼决策。解析失败返回 null（由调用方 fallback） */
async function extractByLLM(sourceText: string): Promise<{
  title: string;
  markdown: string;
  suggestedTags: string[];
} | null> {
  const prompt = `你是决策提炼助手。从会议记录/讨论内容中提取决策项。

要求：
1. 识别文本中的决策、结论、确认事项
2. 每个决策提取：标题（简明扼要）、详细描述（markdown 格式）、建议标签
3. 如果文本中没有明确的决策内容，返回空结果
4. 输出 JSON 格式：{ "title": string, "markdown": string, "suggestedTags": string[] }

输入文本：
${sourceText}`;

  // deepseek-reasoner 不支持 system message，用 prompt（等价单条 user message）传入
  const result = await generateText({
    model: reasonerModel,
    prompt,
  });

  const cleaned = cleanJsonResponse(result.text);
  const parsed = JSON.parse(cleaned);

  // 校验基本结构：title / markdown 必须为字符串
  if (typeof parsed.title !== "string" || typeof parsed.markdown !== "string") {
    return null;
  }
  const suggestedTags: string[] = Array.isArray(parsed.suggestedTags)
    ? parsed.suggestedTags
        .filter((t: unknown) => typeof t === "string")
        .slice(0, 10)
    : [];

  return { title: parsed.title, markdown: parsed.markdown, suggestedTags };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });
  // 仅 member 及以上；viewer 也不可调用（前端也不应出现入口）
  if (!["owner", "admin", "member"].includes(ctx.member.role)) {
    return NextResponse.json({ code: 403, message: apiMsg(req, "noPermission"), data: null }, { status: 403 });
  }

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

  // 1) AI 已配置时优先用 LLM（deepseek-reasoner）提取
  if (isAiConfigured()) {
    try {
      const llmResult = await extractByLLM(body.sourceText);
      if (llmResult) {
        return NextResponse.json({
          code: 200,
          data: {
            title: llmResult.title,
            markdown: llmResult.markdown,
            suggestedTags: llmResult.suggestedTags,
            provider: "deepseek-reasoner",
          },
        });
      }
      // llmResult === null：LLM 返回空结果或结构不符，fallback 到规则版
    } catch (error) {
      console.error("[POST decisions/extract] LLM error, fallback to rules:", error);
    }
  }

  // 2) 规则版 fallback（DEEPSEEK_API_KEY 未配置 或 LLM 调用/解析失败）
  try {
    const result = extractByRules(body.sourceText);
    return NextResponse.json({
      code: 200,
      data: { ...result, provider: "rules-v1" },
    });
  } catch (error) {
    console.error("[POST decisions/extract] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}
