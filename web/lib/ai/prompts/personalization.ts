// AI 个性化推荐 prompt 模板（方向 F）——基于用户行为历史生成个性化推荐。
//
// 设计要点：
// - 输入：AiUserBehavior[]（用户行为历史）+ type（推荐类型）
// - 输出：严格 JSON 格式 { recommendations: [{ type, content, score }] }
// - 三种推荐类型：capability_recommendation / prompt_optimization / workflow_suggestion
// - 含 few-shot 示例引导模型输出格式
// - 中文输出
//
// 来源：方向 F 任务 1（personalization prompt 模板）

import type { AiUserBehavior } from "@prisma/client";

/** 推荐类型枚举 */
export type PersonalizationType =
  | "capability_recommendation"
  | "prompt_optimization"
  | "workflow_suggestion";

/** 单条推荐内容结构 */
export interface RecommendationContent {
  /** 推荐描述（简短标题） */
  description: string;
  /** 具体建议（详细说明） */
  suggestion: string;
  /** 推荐理由（基于用户行为） */
  reason: string;
}

/** AI 输出契约 */
export interface PersonalizationResult {
  recommendations: Array<{
    type: PersonalizationType;
    content: RecommendationContent;
    score: number;
  }>;
}

/**
 * 个性化推荐系统 prompt：定义 AI 角色、任务与输出格式。
 */
export function buildPersonalizationSystemPrompt(): string {
  return `你是企业工作区的 AI 个性化推荐引擎。
基于用户的历史行为数据，生成针对性的个性化推荐，帮助用户更高效地使用 AI 能力。

推荐规则：
1. 严格基于用户行为数据生成推荐，不要编造未在行为中体现的模式
2. 每条推荐必须包含：description（简短描述）、suggestion（具体建议）、reason（基于行为的理由）
3. score 表示推荐置信度，范围 0.0-1.0，越高越相关
4. 生成 1-5 条推荐，按 score 降序排列
5. 中文输出
6. 输出严格的 JSON 格式，不要包含任何其他文本

## 推理步骤
1. 统计用户各 AI 能力的使用频次，识别高频和低频能力
2. 分析用户的 accept_suggestion / reject_suggestion 比率，判断用户偏好
3. 识别用户的工作模式（如偏好流式还是非流式、偏好哪种能力组合）
4. 根据模式生成针对性推荐，每条推荐需说明基于哪些行为数据

## 输出格式
输出一个 JSON 对象：
{
  "recommendations": [
    {
      "type": "capability_recommendation" | "prompt_optimization" | "workflow_suggestion",
      "content": {
        "description": "简短描述",
        "suggestion": "具体建议",
        "reason": "基于用户行为的理由"
      },
      "score": 0.0-1.0
    }
  ]
}

## 示例

### 示例 1
用户行为：频繁使用 task-breakdown（12 次），accept_suggestion 比率 80%，从未使用 workflow-build
输出：
{
  "recommendations": [
    {
      "type": "capability_recommendation",
      "content": {
        "description": "尝试 AI 工作流构建",
        "suggestion": "您频繁使用任务拆解，可以尝试用 AI 工作流构建将拆解后的任务自动编排成可执行的工作流",
        "reason": "您已使用 task-breakdown 12 次，且接受建议率达 80%，表明您对 AI 辅助任务管理有较高接受度"
      },
      "score": 0.85
    },
    {
      "type": "workflow_suggestion",
      "content": {
        "description": "建立任务拆解→工作流的标准流程",
        "suggestion": "建议将 task-breakdown 与 workflow-build 串联使用：先拆解任务再构建工作流，形成标准化流程",
        "reason": "您的高频使用 task-breakdown 但从未使用 workflow-build，存在流程串联的优化空间"
      },
      "score": 0.72
    }
  ]
}

### 示例 2
用户行为：reject_suggestion 比率 60%，多次 edit_output 修改 AI 输出
输出：
{
  "recommendations": [
    {
      "type": "prompt_optimization",
      "content": {
        "description": "优化 AI 提示词以减少修改",
        "suggestion": "您经常修改 AI 输出，建议在提问时提供更详细的上下文和格式要求，减少后续修改",
        "reason": "您有 60% 的拒绝率和多次输出修改，表明当前 AI 输出与您的期望存在偏差"
      },
      "score": 0.78
    }
  ]
}`;
}

/**
 * 将用户行为列表聚合成 markdown 上下文供 LLM 使用。
 *
 * @param behaviors 用户行为历史（已按时间排序）
 * @param type 推荐类型（用于引导模型聚焦生成方向）
 */
export function buildPersonalizationPrompt(
  behaviors: AiUserBehavior[],
  type: string,
): string {
  if (behaviors.length === 0) {
    return `## 用户行为数据
无行为记录

## 推荐类型
${type}

请基于上述数据生成个性化推荐。由于无行为数据，可返回空 recommendations 数组。`;
  }

  // 按能力分组统计
  const byCapability = new Map<string, number>();
  const byAction = new Map<string, number>();
  const recentBehaviors: string[] = [];

  for (const b of behaviors) {
    byCapability.set(b.capability, (byCapability.get(b.capability) ?? 0) + 1);
    byAction.set(b.action, (byAction.get(b.action) ?? 0) + 1);

    // 收集最近 30 条行为明细
    if (recentBehaviors.length < 30) {
      const meta = b.metadata ? ` (metadata: ${JSON.stringify(b.metadata)})` : "";
      recentBehaviors.push(
        `- ${b.createdAt.toISOString()} | action=${b.action} | capability=${b.capability}${meta}`,
      );
    }
  }

  // 能力使用频次统计
  const capabilityStats = [...byCapability.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cap, count]) => `- ${cap}: ${count} 次`)
    .join("\n");

  // 行为类型统计
  const actionStats = [...byAction.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([act, count]) => `- ${act}: ${count} 次`)
    .join("\n");

  // 截断行为明细，避免超出上下文窗口
  const truncatedBehaviors =
    recentBehaviors.length > 0
      ? recentBehaviors.join("\n")
      : "无";

  return `## 用户行为数据

### 行为统计
**按能力分组：**
${capabilityStats}

**按行为类型分组：**
${actionStats}

### 最近行为明细（最多 30 条）
${truncatedBehaviors}

## 推荐类型
${type}

请基于上述用户行为数据生成个性化推荐，输出 JSON 格式。`;
}