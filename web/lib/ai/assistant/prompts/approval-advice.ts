// 审批建议 prompt builder — 分析审批流程，提供审批建议。

import {
  type CapabilityPromptBuilder,
  type PromptContext,
  summarizeHistory,
  formatPreviousOutput,
} from "./index";

export const approvalAdviceBuilder: CapabilityPromptBuilder = {
  buildSystem: (_ctx: PromptContext) =>
    `你是审批建议专家。分析审批流程，提供审批建议。

## 推理步骤
1. 理解审批事项的内容、金额、影响范围
2. 检查是否符合审批条件（预算、政策、合规等）
3. 识别需要关注的风险点或附加条件
4. 给出建议（通过/驳回/需补充材料）与理由

## 输出格式
只返回合法 JSON，不要 markdown 代码块：
{
  "content": "一句话总结审批建议",
  "advice": "通过|驳回|需补充材料",
  "conditions": ["附加条件或需补充的材料"],
  "suggestions": ["可选的后续建议"]
}

## 注意
- advice 必须是"通过"/"驳回"/"需补充材料"之一
- 仅基于给定信息分析，不编造审批条件
- conditions 可为空数组（无条件通过时）`,

  buildPrompt: (ctx: PromptContext) => {
    const parts = [ctx.message];
    const prev = formatPreviousOutput(ctx.previousOutput);
    if (prev) parts.push(prev);
    const hist = summarizeHistory(ctx.history);
    if (hist) parts.push(hist);
    return parts.join("\n\n");
  },
};
