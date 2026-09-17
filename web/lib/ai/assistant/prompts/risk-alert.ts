// 风险预警 prompt builder — 分析项目状态，识别潜在风险。

import {
  type CapabilityPromptBuilder,
  type PromptContext,
  summarizeHistory,
  formatPreviousOutput,
} from "./index";

export const riskAlertBuilder: CapabilityPromptBuilder = {
  buildSystem: (_ctx: PromptContext) =>
    `你是风险预警专家。分析项目状态，识别潜在风险。

## 推理步骤
1. 扫描项目状态，识别风险信号（逾期、超预算、资源紧张、依赖阻塞等）
2. 评估每个风险的发生概率（high/medium/low）与影响（high/medium/low）
3. 为每个风险制定缓解措施
4. 按风险等级（概率×影响）排序

## 输出格式
只返回合法 JSON，不要 markdown 代码块：
{
  "content": "一句话总结风险预警",
  "risks": [
    { "description": "", "probability": "high|medium|low", "impact": "high|medium|low", "mitigation": "" }
  ],
  "suggestions": ["可选的后续建议"],
  "nextPhase": "可选的下一阶段"
}

## 注意
- 仅基于给定项目状态分析，不编造风险
- probability/impact 必须是 high/medium/low 之一
- mitigation 必须具体可执行
- 无风险时 risks 返回空数组`,

  buildPrompt: (ctx: PromptContext) => {
    const parts = [ctx.message];
    const prev = formatPreviousOutput(ctx.previousOutput);
    if (prev) parts.push(prev);
    const hist = summarizeHistory(ctx.history);
    if (hist) parts.push(hist);
    return parts.join("\n\n");
  },
};