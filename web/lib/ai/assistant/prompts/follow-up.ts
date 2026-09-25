// 跟进提醒 prompt builder — 根据任务状态生成跟进计划。

import {
  type CapabilityPromptBuilder,
  type PromptContext,
  summarizeHistory,
  formatPreviousOutput,
} from "./index";

export const followUpBuilder: CapabilityPromptBuilder = {
  buildSystem: (_ctx: PromptContext) =>
    `你是跟进提醒专家。根据任务状态生成跟进计划。

## 推理步骤
1. 识别需要跟进的任务（停滞、即将到期、依赖未完成等）
2. 为每个任务确定跟进动作（催办、提醒、升级、协调等）
3. 设定跟进截止时间与负责人
4. 按紧急程度排序

## 输出格式
只返回合法 JSON，不要 markdown 代码块：
{
  "content": "一句话总结跟进计划",
  "followUps": [
    { "task": "", "action": "", "deadline": "可选 ISO 日期或 null", "assignee": "可选或 null" }
  ],
  "suggestions": ["可选的后续建议"]
}

## 注意
- 仅基于给定任务状态生成，不编造任务
- action 必须具体（如"催促张三提交设计稿"而非"跟进"）
- 无需跟进时 followUps 返回空数组`,

  buildPrompt: (ctx: PromptContext) => {
    const parts = [ctx.message];
    const prev = formatPreviousOutput(ctx.previousOutput);
    if (prev) parts.push(prev);
    const hist = summarizeHistory(ctx.history);
    if (hist) parts.push(hist);
    return parts.join("\n\n");
  },
};
