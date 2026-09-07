// POST /api/v1/workspaces/{wid}/decisions/extract — AI 决策提炼（规则版，无真 LLM）
// 输入：{ sourceText: 粘贴的会议记录/讨论内容 }
// 输出：{ title, markdown, suggestedTags }
// 实现策略：WPS 风格"AI 生成草稿"。首版用模板化规则提取，把决策要素从自由
// 文本中抽出为 markdown 结构；后续可替换成真 LLM（DashScope / DeepSeek / OpenAI）。
// 这样前端一次对接接口、后端实现可以渐进替换，不会给用户带来 API 破坏性变更。

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";

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

export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });
  // 仅 member 及以上；viewer 也不可调用（前端也不应出现入口）
  if (!["owner", "admin", "member"].includes(ctx.member.role)) {
    return NextResponse.json({ code: 403, message: apiMsg(req, "noPermission") }, { status: 403 });
  }

  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: e.issues[0]?.message ?? "参数校验失败" },
        { status: 400 },
      );
    }
    return NextResponse.json({ code: 400, message: apiMsg(req, "invalidBody") }, { status: 400 });
  }

  // 规则提炼：分行→关键词命中优先→markdown 模板化输出
  const lines = body.sourceText.split(/\r?\n/);
  const title = pickTitle(lines);
  const keyPoints = pickKeySentences(lines);

  // 组装 markdown：\<背景 / 结论 / 关键理由 / 下一步行动\> 四段式
  const markdown = [
    `# ${title}`,
    "",
    "## 关键结论",
    ...keyPoints.map((s) => `- ${s}`),
    "",
    "## 原始讨论（节选）",
    "",
    "```",
    body.sourceText.slice(0, 800),
    "```",
    "",
    "> 本内容由 AI 根据提供的原始讨论提炼，请人工核对后再正式归档。",
  ].join("\n");

  return NextResponse.json({
    code: 200,
    data: {
      title,
      markdown,
      // 前端 UI 可以根据这些 tag 预填 meta（MVP 暂不渲染）
      suggestedTags: DECISION_KEYWORDS.filter((k) =>
        body.sourceText.toLowerCase().includes(k.toLowerCase()),
      ).slice(0, 5),
      provider: "rules-v1",
    },
  });
}
