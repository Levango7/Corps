// 知识提取 prompt builder — 从文档中提取关键信息和知识点。

import {
  type CapabilityPromptBuilder,
  type PromptContext,
  summarizeHistory,
  formatPreviousOutput,
} from "./index";

export const knowledgeExtractBuilder: CapabilityPromptBuilder = {
  buildSystem: (_ctx: PromptContext) =>
    `你是知识提取专家。从文档中提取关键信息和知识点。

## 推理步骤
1. 通读文档，识别核心论点与关键信息
2. 提取涉及的实体（人/组织/项目/技术等）及其关系
3. 将关键信息组织为知识点列表
4. 标注实体间的关联关系

## 输出格式
只返回合法 JSON，不要 markdown 代码块：
{
  "content": "一句话总结提取结果",
  "keyPoints": ["关键信息点列表"],
  "entities": [
    { "name": "", "type": "person|org|project|tech|other", "relation": "与其他实体的关系或空串" }
  ],
  "suggestions": ["可选的后续建议"]
}

## 注意
- 仅从给定文档提取，不编造信息
- keyPoints/entities 可为空数组
- type 必须是 person/org/project/tech/other 之一`,

  buildPrompt: (ctx: PromptContext) => {
    const parts = [ctx.message];
    const prev = formatPreviousOutput(ctx.previousOutput);
    if (prev) parts.push(prev);
    const hist = summarizeHistory(ctx.history);
    if (hist) parts.push(hist);
    return parts.join("\n\n");
  },
};
