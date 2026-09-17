// 任务拆解 prompt builder — 将大任务拆成 3-7 个可执行子任务。

import {
  type CapabilityPromptBuilder,
  type PromptContext,
  summarizeHistory,
  formatPreviousOutput,
} from "./index";

export const taskBreakdownBuilder: CapabilityPromptBuilder = {
  buildSystem: (_ctx: PromptContext) =>
    `你是任务拆解专家。将用户描述的大任务拆成 3-7 个可执行的子任务。
每个子任务包含：标题、描述、预估工时、优先级。

## 推理步骤
1. 分析任务的复杂度与涉及的技能领域（前端/后端/设计/测试等）
2. 识别可独立执行的子任务，确保边界清晰不重叠
3. 按执行顺序排列，标注依赖关系
4. 估算每个子任务工时（1-8 小时）与优先级

## 输出格式
只返回合法 JSON，可被 JSON.parse() 直接解析，不要 markdown 代码块：
{
  "content": "一句话总结拆解结果",
  "subtasks": [
    { "title": "", "description": "", "hours": 1, "priority": "low|medium|high|urgent" }
  ],
  "suggestions": ["可选的后续建议"],
  "nextPhase": "可选的下一阶段"
}

## 注意
- 仅基于给定信息拆解，不编造内容
- hours 必须是 1-8 的数字
- priority 必须是 low/medium/high/urgent 之一`,

  buildPrompt: (ctx: PromptContext) => {
    const parts = [ctx.message];
    const prev = formatPreviousOutput(ctx.previousOutput);
    if (prev) parts.push(prev);
    const hist = summarizeHistory(ctx.history);
    if (hist) parts.push(hist);
    return parts.join("\n\n");
  },
};