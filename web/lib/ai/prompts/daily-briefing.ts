// 每日简报 prompt 模板——分析今日待办、即将到期任务、今日会议、未读重要消息，
// 输出结构化 JSON 供 AI 主动推送系统（方向 A）使用。
//
// 输出 JSON schema：
//   { title: string, summary: string,
//     items: [{ type: "task"|"meeting"|"message", label: string,
//               priority: "high"|"medium"|"low", action: string }] }
//
// 设计要点：
//  - system prompt 描述角色 + 输出格式 + 推理步骤（供 reasonerModel 使用）
//  - user prompt 注入聚合的工作区上下文（由 buildAiContext 生成 markdown）
//  - WorkspaceContext 承载聚合数据 + 工作区/用户标识

/** 工作区上下文：聚合数据 + 标识信息 */
export interface WorkspaceContext {
  /** 聚合的工作区数据（markdown 格式，由 buildAiContext 生成） */
  context: string;
  /** 工作区 ID */
  workspaceId: string;
  /** 当前用户 ID */
  userId: string;
}

/**
 * 构建每日简报 system prompt。
 *
 * @param ctx 工作区上下文（workspaceId 用于标识工作区范围）
 * @returns system prompt 字符串
 */
export function buildDailyBriefingPrompt(ctx: WorkspaceContext): string {
  return `你是工作区每日简报助手。你的任务是分析用户今日的工作安排，生成一份简洁的每日简报。

工作区范围：${ctx.workspaceId}

分析维度：
1. 今日待办任务：今天需要开始或进行的任务
2. 即将到期任务：未来 3 天内到期且未完成的任务
3. 今日会议：今天 scheduledAt 落在当天的会议
4. 未读重要消息：未读且标记为重要的消息

## 推理步骤
1. 从工作数据中提取今日待办任务，按优先级排序
2. 筛选即将到期任务（截止日期在未来 3 天内且未完成），标注紧急程度
3. 列出今日会议，按时间顺序排列
4. 识别未读重要消息，按时间倒序取最近 5 条
5. 汇总为简报，title 为日期+核心要点，summary 为一句话概括，items 为具体条目

## 输出格式
必须输出合法 JSON，不要使用 markdown 代码块包裹，不要输出任何 JSON 以外的文字。
JSON schema：
{
  "title": string,          // 简报标题，不超过 50 字
  "summary": string,        // 一句话摘要，不超过 100 字
  "items": [                // 简报条目，最多 10 条
    {
      "type": "task" | "meeting" | "message",
      "label": string,      // 条目标签/标题，不超过 80 字
      "priority": "high" | "medium" | "low",
      "action": string      // 建议动作，不超过 100 字
    }
  ]
}

## 注意事项
- 仅基于给定数据生成，不添加虚构内容
- 如某维度无数据，对应的 items 条目省略（不要输出空条目）
- priority 判定：逾期/今日截止=high，3 天内到期=medium，其余=low
- 如数据不足以生成高质量简报，items 输出空数组，summary 标注"今日暂无重要安排"`;
}

/**
 * 构建每日简报 user prompt（注入聚合上下文）。
 *
 * @param ctx 工作区上下文
 * @returns user prompt 字符串
 */
export function buildDailyBriefingUserPrompt(ctx: WorkspaceContext): string {
  const truncatedContext =
    ctx.context.length > 12000 ? ctx.context.slice(0, 12000) + "\n\n[上下文已截断]" : ctx.context;
  return `今日工作数据：\n${truncatedContext}`;
}
