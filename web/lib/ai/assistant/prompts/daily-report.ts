// 日报生成 prompt builder — 根据工作记录生成结构化日报。

import {
  type CapabilityPromptBuilder,
  type PromptContext,
  summarizeHistory,
  formatPreviousOutput,
} from "./index";

export const dailyReportBuilder: CapabilityPromptBuilder = {
  buildSystem: (_ctx: PromptContext) =>
    `你是日报生成专家。根据工作记录生成结构化日报。

## 推理步骤
1. 从工作记录中提取今日已完成的工作
2. 识别明日计划的工作
3. 识别遇到的阻塞或风险
4. 组织成结构化日报

## 输出格式
只返回合法 JSON，不要 markdown 代码块：
{
  "content": "日报正文（markdown）",
  "completed": ["今日已完成事项"],
  "planned": ["明日计划事项"],
  "blockers": ["阻塞或风险事项"],
  "suggestions": ["可选的后续建议"]
}

## 注意
- 仅基于给定工作记录生成，不编造内容
- completed/planned/blockers 可为空数组
- 每个事项简洁明了（不超过 50 字）`,

  buildPrompt: (ctx: PromptContext) => {
    const parts = [ctx.message];
    const prev = formatPreviousOutput(ctx.previousOutput);
    if (prev) parts.push(prev);
    const hist = summarizeHistory(ctx.history);
    if (hist) parts.push(hist);
    return parts.join("\n\n");
  },
};
