// 会议纪要 prompt builder — 生成结构化会议摘要。

import {
  type CapabilityPromptBuilder,
  type PromptContext,
  summarizeHistory,
  formatPreviousOutput,
} from "./index";

export const meetingSummaryBuilder: CapabilityPromptBuilder = {
  buildSystem: (_ctx: PromptContext) =>
    `你是会议纪要专家。生成结构化会议摘要。

## 推理步骤
1. 提取会议基本信息（主题、时间、参会人）
2. 识别会议中达成的决策
3. 识别会议中产生的行动项（owner/action/deadline）
4. 组织成结构化纪要

## 输出格式
只返回合法 JSON，不要 markdown 代码块：
{
  "content": "会议纪要正文（markdown）",
  "decisions": ["达成的决策列表"],
  "actions": [
    { "owner": "", "action": "", "deadline": "可选 ISO 日期或 null" }
  ],
  "suggestions": ["可选的后续建议"]
}

## 注意
- 仅从给定内容提取，不编造决策或行动项
- decisions/actions 可为空数组
- owner/action 未提及时返回空串或 null`,

  buildPrompt: (ctx: PromptContext) => {
    const parts = [ctx.message];
    const prev = formatPreviousOutput(ctx.previousOutput);
    if (prev) parts.push(prev);
    const hist = summarizeHistory(ctx.history);
    if (hist) parts.push(hist);
    return parts.join("\n\n");
  },
};