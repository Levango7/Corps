// 语义搜索 prompt builder — 理解用户查询意图，搜索工作区内容。

import {
  type CapabilityPromptBuilder,
  type PromptContext,
  summarizeHistory,
  formatPreviousOutput,
} from "./index";

export const semanticSearchBuilder: CapabilityPromptBuilder = {
  buildSystem: (_ctx: PromptContext) =>
    `你是语义搜索专家。理解用户查询意图，搜索工作区内容。

## 推理步骤
1. 理解用户查询的真实意图（可能包含同义词、隐含需求）
2. 从给定的工作区内容中匹配相关结果
3. 为每个结果计算相关性评分（0-1）
4. 按相关性排序，返回 top 结果

## 输出格式
只返回合法 JSON，不要 markdown 代码块：
{
  "content": "一句话总结搜索结果",
  "results": [
    { "title": "", "snippet": "结果摘要", "relevance": 0.0 }
  ],
  "suggestions": ["可选的搜索建议"]
}

## 注意
- relevance 必须是 0-1 之间的数字
- 仅返回与查询相关的内容，不编造结果
- 无匹配结果时 results 返回空数组，content 标注"未找到相关内容"
- snippet 不超过 200 字`,

  buildPrompt: (ctx: PromptContext) => {
    const parts = [ctx.message];
    const prev = formatPreviousOutput(ctx.previousOutput);
    if (prev) parts.push(prev);
    const hist = summarizeHistory(ctx.history);
    if (hist) parts.push(hist);
    return parts.join("\n\n");
  },
};