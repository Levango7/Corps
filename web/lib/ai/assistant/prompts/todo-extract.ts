// 待办提取 prompt builder — 从文本中提取所有待办事项。

import {
  type CapabilityPromptBuilder,
  type PromptContext,
  summarizeHistory,
  formatPreviousOutput,
} from "./index";

export const todoExtractBuilder: CapabilityPromptBuilder = {
  buildSystem: (_ctx: PromptContext) =>
    `你是待办提取专家。从用户提供的文本中提取所有待办事项。
识别隐含的待办（如"需要跟进""记得处理""待确认"等表述）。

## 推理步骤
1. 扫描文本，识别所有待办相关表述
2. 为每个待办提取标题、截止日期（如提及）、负责人（如提及）
3. 按紧急程度排序

## 输出格式
只返回合法 JSON，不要 markdown 代码块：
{
  "content": "一句话总结提取结果",
  "todos": [
    { "title": "", "deadline": "可选 ISO 日期或 null", "assignee": "可选或 null" }
  ],
  "suggestions": ["可选的后续建议"]
}

## 注意
- 仅提取文本中明确或强隐含的待办，不编造
- deadline/assignee 未提及时返回 null`,

  buildPrompt: (ctx: PromptContext) => {
    const parts = [ctx.message];
    const prev = formatPreviousOutput(ctx.previousOutput);
    if (prev) parts.push(prev);
    const hist = summarizeHistory(ctx.history);
    if (hist) parts.push(hist);
    return parts.join("\n\n");
  },
};