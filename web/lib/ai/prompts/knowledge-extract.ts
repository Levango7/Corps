// AI 知识提取 prompt 模板——从文档/会议/聊天/任务中提取结构化知识点（节点 + 关系）。
//
// 输出 JSON 契约：
//   {
//     nodes: [{ type: "concept"|"entity"|"fact"|"procedure", label: string, content: string }],
//     edges: [{ sourceLabel: string, targetLabel: string, relation: "depends_on"|"relates_to"|"part_of"|"authored_by", weight: number }]
//   }
//
// 节点类型语义：
//   - concept：抽象概念/主题（如"微服务架构"）
//   - entity：具体实体/对象（如"用户服务"）
//   - fact：事实/声明（如"系统使用 PostgreSQL"）
//   - procedure：流程/步骤（如"部署流程"）
//
// 关系类型语义：
//   - depends_on：依赖关系（A 依赖 B）
//   - relates_to：关联关系（A 与 B 相关）
//   - part_of：包含关系（A 是 B 的一部分）
//   - authored_by：作者关系（A 由 B 编写）

import { appendFeedbackShot } from "./feedback-shot";
import type { FeedbackExample } from "@/lib/ai/feedback";

/** 来源类型中文标签 */
const SOURCE_LABEL: Record<string, string> = {
  document: "文档",
  meeting: "会议纪要",
  chat: "聊天记录",
  task: "任务描述",
};

/**
 * 知识提取系统 prompt：定义 AI 角色、提取规则与输出 JSON 契约。
 *
 * @param sourceType 来源类型（document/meeting/chat/task），用于在 prompt 中标注来源
 * @param feedbackExamples 可选的正面反馈示例（few-shot）
 */
export function buildKnowledgeExtractPrompt(
  sourceType: string,
  sourceContent: string,
  feedbackExamples?: FeedbackExample[],
): string {
  const sourceLabel = SOURCE_LABEL[sourceType] ?? "来源";
  // 截断超长内容，避免 prompt 膨胀（保留前 8000 字符）
  const truncatedContent =
    sourceContent.length > 8000
      ? sourceContent.slice(0, 8000) + "\n\n[内容已截断]"
      : sourceContent;

  return appendFeedbackShot(`你是企业知识图谱提取专家。从给定的${sourceLabel}中提取结构化知识点，构建知识图谱节点与关系。

## 提取规则
1. 识别文本中的核心概念、实体、事实和流程
2. 为每个知识点生成简洁的 label（≤50 字符）和详细的 content（≤500 字符）
3. 识别知识点之间的关系，标注关系类型和权重（0.0-1.0）
4. 避免重复提取语义相同的节点
5. 保持节点的 label 唯一且具有区分度

## 节点类型
- concept：抽象概念或主题（如"微服务架构"、"敏捷开发"）
- entity：具体实体或对象（如"用户服务"、"PostgreSQL 数据库"）
- fact：事实或声明（如"系统使用 JWT 认证"、"日活用户 10 万"）
- procedure：流程或步骤（如"部署流程"、"代码评审流程"）

## 关系类型
- depends_on：依赖关系（A 依赖 B 才能存在/生效）
- relates_to：一般关联关系（A 与 B 主题相关）
- part_of：包含关系（A 是 B 的组成部分）
- authored_by：作者关系（A 由 B 编写/创建）

## 推理步骤
1. 通读全文，识别所有候选知识点
2. 对每个知识点分类（concept/entity/fact/procedure）
3. 为每个知识点提炼 label 和 content
4. 分析知识点间的语义关系，标注关系类型
5. 为关系分配权重（强关系 0.7-1.0，中等 0.4-0.6，弱关系 0.1-0.3）
6. 去重：合并语义重复的节点

## 输出格式
严格输出以下 JSON 结构，不要添加任何解释文字或 markdown 代码块标记：
{
  "nodes": [
    { "type": "concept", "label": "节点标签", "content": "节点详细描述" }
  ],
  "edges": [
    { "sourceLabel": "源节点标签", "targetLabel": "目标节点标签", "relation": "depends_on", "weight": 0.8 }
  ]
}

## 待提取的${sourceLabel}内容
${truncatedContent}

请提取知识点并输出 JSON。`, feedbackExamples);
}