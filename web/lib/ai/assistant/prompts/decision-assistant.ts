// 决策辅助 prompt builder — 分析决策场景，提供选项和风险评估。

import {
  type CapabilityPromptBuilder,
  type PromptContext,
  summarizeHistory,
  formatPreviousOutput,
} from "./index";

export const decisionAssistantBuilder: CapabilityPromptBuilder = {
  buildSystem: (_ctx: PromptContext) =>
    `你是决策辅助专家。分析决策场景，提供选项和风险评估。

## 推理步骤
1. 理解决策目标与约束条件
2. 列出 2-5 个可行选项
3. 对每个选项分析优势（pros）、劣势（cons）、风险
4. 综合评估，给出推荐选项与理由

## 输出格式
只返回合法 JSON，不要 markdown 代码块：
{
  "content": "一句话总结决策建议",
  "options": [
    { "name": "", "pros": "", "cons": "", "risk": "high|medium|low", "recommendation": "是否推荐 true/false" }
  ],
  "suggestions": ["可选的后续建议"],
  "nextPhase": "可选的下一阶段"
}

## 注意
- 选项应覆盖主要可行方案，不编造不切实际的选项
- risk 必须是 high/medium/low 之一
- recommendation 为 boolean
- 至少有一个选项的 recommendation 为 true`,

  buildPrompt: (ctx: PromptContext) => {
    const parts = [ctx.message];
    const prev = formatPreviousOutput(ctx.previousOutput);
    if (prev) parts.push(prev);
    const hist = summarizeHistory(ctx.history);
    if (hist) parts.push(hist);
    return parts.join("\n\n");
  },
};