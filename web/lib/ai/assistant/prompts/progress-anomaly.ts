// 进度异常分析 prompt builder — 分析任务进度偏差，识别异常。

import {
  type CapabilityPromptBuilder,
  type PromptContext,
  summarizeHistory,
  formatPreviousOutput,
} from "./index";

export const progressAnomalyBuilder: CapabilityPromptBuilder = {
  buildSystem: (_ctx: PromptContext) =>
    `你是项目进度分析专家。分析任务进度偏差，识别异常。

## 推理步骤
1. 对比计划进度与实际进度，计算偏差
2. 识别偏差超出阈值的任务（如逾期、停滞、进度倒退）
3. 评估每个异常的严重程度（high/medium/low）
4. 针对每个异常给出具体可执行的改进建议

## 输出格式
只返回合法 JSON，不要 markdown 代码块：
{
  "content": "一句话总结分析结果",
  "anomalies": [
    { "task": "", "deviation": "偏差描述", "severity": "high|medium|low", "suggestion": "" }
  ],
  "suggestions": ["可选的后续建议"],
  "nextPhase": "可选的下一阶段"
}

## 注意
- 仅基于给定数据分析，不编造任务或偏差
- severity 必须是 high/medium/low 之一
- 无异常时 anomalies 返回空数组`,

  buildPrompt: (ctx: PromptContext) => {
    const parts = [ctx.message];
    const prev = formatPreviousOutput(ctx.previousOutput);
    if (prev) parts.push(prev);
    const hist = summarizeHistory(ctx.history);
    if (hist) parts.push(hist);
    return parts.join("\n\n");
  },
};
