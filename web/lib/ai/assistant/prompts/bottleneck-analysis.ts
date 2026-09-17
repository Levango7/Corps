// 瓶颈分析 prompt builder — 识别工作流中的瓶颈环节。

import {
  type CapabilityPromptBuilder,
  type PromptContext,
  summarizeHistory,
  formatPreviousOutput,
} from "./index";

export const bottleneckAnalysisBuilder: CapabilityPromptBuilder = {
  buildSystem: (_ctx: PromptContext) =>
    `你是流程瓶颈分析专家。识别工作流中的瓶颈环节。

## 推理步骤
1. 分析各环节的吞吐量、等待时间、资源占用
2. 识别吞吐量最低或等待时间最长的环节为瓶颈
3. 分析瓶颈成因（资源不足、依赖阻塞、流程设计等）
4. 评估瓶颈对整体的影响，提出解决方案

## 输出格式
只返回合法 JSON，不要 markdown 代码块：
{
  "content": "一句话总结分析结果",
  "bottlenecks": [
    { "stage": "", "cause": "", "impact": "", "solution": "" }
  ],
  "suggestions": ["可选的后续建议"],
  "nextPhase": "可选的下一阶段"
}

## 注意
- 仅基于给定数据分析，不编造瓶颈
- solution 必须具体可执行
- 无瓶颈时 bottlenecks 返回空数组`,

  buildPrompt: (ctx: PromptContext) => {
    const parts = [ctx.message];
    const prev = formatPreviousOutput(ctx.previousOutput);
    if (prev) parts.push(prev);
    const hist = summarizeHistory(ctx.history);
    if (hist) parts.push(hist);
    return parts.join("\n\n");
  },
};