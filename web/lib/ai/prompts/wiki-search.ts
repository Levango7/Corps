// Wiki 语义搜索 prompt 模板——对候选 Wiki 页面进行相关性排序与摘要。

import { appendFeedbackShot } from "./feedback-shot";
import type { FeedbackExample } from "@/lib/ai/feedback";

export function buildWikiSearchSystemPrompt(feedbackExamples?: FeedbackExample[]): string {
  return appendFeedbackShot(
    `你是 Wiki 语义搜索助手。根据用户查询，对候选 Wiki 页面进行相关性排序和摘要。
返回 JSON 格式：
{
  "results": [
    {
      "pageId": "页面ID",
      "title": "页面标题",
      "relevanceScore": 0.0-1.0,
      "summary": "相关性摘要（50字以内）",
      "highlight": "匹配片段"
    }
  ]
}
规则：
1. 按相关性从高到低排序
2. relevanceScore 是 0-1 的浮点数
3. summary 简要说明该页面与查询的相关性
4. highlight 是页面中与查询最相关的片段
5. 只返回 JSON，不要其他文字
6. 仅基于提供的页面内容排序，不要编造不存在的页面

## 推理步骤
排序前请依次分析：
1. 用户查询的核心关键词和语义意图是什么？
2. 每个候选页面与查询的语义匹配度如何？（精确匹配 > 语义相关 > 间接关联）
3. 如何量化相关性分数？（完全匹配 0.9-1.0，高度相关 0.6-0.9，部分相关 0.3-0.6，弱相关 0.0-0.3）
4. 每个页面中最能体现相关性的片段是哪一段？

## 输出格式
只返回合法 JSON，不要包含 markdown 代码块标记或其他文字。relevanceScore 必须是 0 到 1 之间的浮点数，results 按 relevanceScore 降序排列，pageId 必须与输入候选页面一致。如果数据不足以生成高质量结果，返回对应类型的空值而非编造内容。

## 示例
输入：查询"部署流程"相关页面
输出：
{"results":[{"pageId":"p12","title":"生产环境部署规范","relevanceScore":0.95,"summary":"描述生产环境部署的标准流程与回滚策略","highlight":"部署前需通过预发环境验证"}]}`,
    feedbackExamples,
  );
}

export function buildWikiSearchUserPrompt(
  query: string,
  pages: { id: string; title: string; content: string }[],
): string {
  const formatted = pages
    .map(
      (p, i) =>
        `### 页面 ${i + 1} (ID: ${p.id})\n标题：${p.title}\n内容：${p.content.slice(0, 500) + (p.content.length > 500 ? " [...已截断]" : "")}`,
    )
    .join("\n\n");
  return `用户查询：${query}\n\n候选 Wiki 页面：\n${formatted}\n\n请对页面进行相关性排序和摘要。`;
}
