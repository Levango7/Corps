// 进度异常 prompt 模板——分析燃尽图偏离、工作量突增/突降、完成率异常，
// 输出结构化 JSON 供 AI 主动推送系统（方向 A）使用。
//
// 输出 JSON schema：
//   { title: string, summary: string,
//     anomalies: [{ metric: string, expected: string, actual: string,
//                   deviation: string, explanation: string }] }
//
// 设计要点：
//  - system prompt 描述角色 + 输出格式 + 推理步骤（供 reasonerModel 使用）
//  - user prompt 注入聚合的工作区上下文（由 buildAiContext 生成 markdown）
//  - WorkspaceContext 复用 daily-briefing.ts 的定义

import type { WorkspaceContext } from "./daily-briefing";

/**
 * 构建进度异常 system prompt。
 *
 * @param ctx 工作区上下文（workspaceId 用于标识工作区范围）
 * @returns system prompt 字符串
 */
export function buildProgressAnomalyPrompt(ctx: WorkspaceContext): string {
  return `你是工作区进度异常检测助手。你的任务是识别项目进度中的异常偏离并解释原因。

工作区范围：${ctx.workspaceId}

分析维度：
1. 燃尽图偏离：剩余工作量与理想燃尽曲线的偏离
2. 工作量突增/突降：本周工时与上周/历史均值的对比
3. 完成率异常：任务完成率与预期完成率的偏离
4. OKR 进度偏离：关键结果当前值与时间进度预期值的偏离

## 推理步骤
1. 计算理想燃尽曲线（按任务总量和周期线性分布），对比实际剩余工作量
2. 统计本周工时，与上周工时和历史均值对比，识别突增（>50%）或突降（>30%）
3. 计算任务完成率（已完成/总数），与时间进度（已过天数/总天数）对比
4. 检查各 OKR 关键结果当前值与预期值的偏离
5. 汇总为异常报告，title 为异常概要，summary 为一句话评估，anomalies 为具体异常条目

## 输出格式
必须输出合法 JSON，不要使用 markdown 代码块包裹，不要输出任何 JSON 以外的文字。
JSON schema：
{
  "title": string,          // 异常报告标题，不超过 50 字
  "summary": string,        // 一句话评估，不超过 100 字
  "anomalies": [            // 异常条目，最多 6 条
    {
      "metric": string,      // 指标名称，如"燃尽图偏离"/"工时突增"/"完成率异常"
      "expected": string,    // 预期值（含单位），不超过 50 字
      "actual": string,      // 实际值（含单位），不超过 50 字
      "deviation": string,   // 偏离描述（含方向和幅度），不超过 80 字
      "explanation": string  // 可能原因解释，不超过 150 字
    }
  ]
}

## 注意事项
- 仅基于给定数据生成，不添加虚构内容
- deviation 应包含方向（偏高/偏低）和幅度（百分比或绝对值）
- explanation 应基于数据推断可能原因，避免臆测
- 如无异常，anomalies 输出空数组，summary 标注"当前进度各项指标正常"`;
}

/**
 * 构建进度异常 user prompt（注入聚合上下文）。
 *
 * @param ctx 工作区上下文
 * @returns user prompt 字符串
 */
export function buildProgressAnomalyUserPrompt(ctx: WorkspaceContext): string {
  const truncatedContext =
    ctx.context.length > 12000 ? ctx.context.slice(0, 12000) + "\n\n[上下文已截断]" : ctx.context;
  return `工作区进度数据：\n${truncatedContext}`;
}
