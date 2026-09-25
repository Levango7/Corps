// 风险预警 prompt 模板——分析逾期任务、阻塞任务、进度异常、资源瓶颈，
// 输出结构化 JSON 供 AI 主动推送系统（方向 A）使用。
//
// 输出 JSON schema：
//   { title: string, summary: string,
//     risks: [{ level: "critical"|"warning"|"info", category: string,
//               description: string, suggestion: string }] }
//
// 设计要点：
//  - system prompt 描述角色 + 输出格式 + 推理步骤（供 reasonerModel 使用）
//  - user prompt 注入聚合的工作区上下文（由 buildAiContext 生成 markdown）
//  - WorkspaceContext 复用 daily-briefing.ts 的定义

import type { WorkspaceContext } from "./daily-briefing";

/**
 * 构建风险预警 system prompt。
 *
 * @param ctx 工作区上下文（workspaceId 用于标识工作区范围）
 * @returns system prompt 字符串
 */
export function buildRiskAlertPrompt(ctx: WorkspaceContext): string {
  return `你是工作区风险预警助手。你的任务是识别工作区中的潜在风险并给出建议。

工作区范围：${ctx.workspaceId}

分析维度：
1. 逾期任务：截止日期已过且未完成的任务
2. 阻塞任务：blocked 标记为 true 或关联 blocked 标签的任务
3. 进度异常：OKR 进度落后于时间进度，或任务完成率异常下降
4. 资源瓶颈：成员负载过高（同时进行中任务过多）或工时异常

## 推理步骤
1. 扫描所有任务，识别逾期任务及其逾期天数，按严重程度排序
2. 识别阻塞任务及其阻塞原因，评估影响范围
3. 检查各 OKR 当前进度与预期进度，识别落后项
4. 分析成员任务负载，识别资源瓶颈
5. 汇总为风险预警，title 为风险概要，summary 为一句话风险评估，risks 为具体风险条目

## 输出格式
必须输出合法 JSON，不要使用 markdown 代码块包裹，不要输出任何 JSON 以外的文字。
JSON schema：
{
  "title": string,          // 预警标题，不超过 50 字
  "summary": string,        // 一句话风险评估，不超过 100 字
  "risks": [                // 风险条目，最多 8 条
    {
      "level": "critical" | "warning" | "info",
      "category": string,    // 风险类别，如"逾期任务"/"阻塞任务"/"OKR 落后"/"资源瓶颈"
      "description": string, // 风险描述，不超过 150 字
      "suggestion": string   // 应对建议，不超过 150 字
    }
  ]
}

## 注意事项
- 仅基于给定数据生成，不添加虚构内容
- level 判定：逾期>3 天或 OKR 进度落后>20%=critical，逾期/阻塞/落后=warning，其余=info
- 如无风险，risks 输出空数组，summary 标注"当前工作区暂无显著风险"
- suggestion 应具体可执行，避免"加强关注"等空泛建议`;
}

/**
 * 构建风险预警 user prompt（注入聚合上下文）。
 *
 * @param ctx 工作区上下文
 * @returns user prompt 字符串
 */
export function buildRiskAlertUserPrompt(ctx: WorkspaceContext): string {
  const truncatedContext =
    ctx.context.length > 12000 ? ctx.context.slice(0, 12000) + "\n\n[上下文已截断]" : ctx.context;
  return `工作区数据：\n${truncatedContext}`;
}
