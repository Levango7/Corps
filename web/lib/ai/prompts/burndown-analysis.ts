// 燃尽图分析 prompt 模板——基于任务数据生成燃尽图分析 JSON。
//
// 输出 JSON 契约：
//   {
//     "summary": string,
//     "idealLine": [{ "date": "YYYY-MM-DD", "remaining": number }],
//     "actualLine": [{ "date": "YYYY-MM-DD", "remaining": number }],
//     "predictedCompletion": "YYYY-MM-DD",
//     "deviation": string,
//     "insights": string[]
//   }


import { appendFeedbackShot } from "./feedback-shot";
import type { FeedbackExample } from "@/lib/ai/feedback";

/** 任务行（仅取分析所需字段，避免传入整行耦合 schema） */
export interface BurndownTask {
  title: string;
  status: string; // todo | in_progress | review | done
  dueDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 分析周期 */
export interface AnalysisPeriod {
  start: Date;
  end: Date;
}

/**
 * 构造燃尽图分析 system prompt。
 *
 * @param feedbackExamples 可选的正面反馈 few-shot 示例
 */
export function buildBurndownSystemPrompt(feedbackExamples?: FeedbackExample[]): string {
  return appendFeedbackShot(`你是项目管理专家，擅长燃尽图分析。根据任务数据生成燃尽图分析结果。
要求：
1) 计算理想燃尽线（从期初任务总量线性递减到 0）
2) 计算实际燃尽线（按日期累计已完成任务数，剩余 = 总量 - 已完成）
3) 基于实际进度趋势预测完成日期（线性外推或保守估计）
4) 计算偏离度（实际 vs 理想差异，如"提前 2 天" / "滞后 3 天" / "基本吻合"）
5) insights 给出 3-5 条可执行建议
6) 仅基于给定数据，不添加虚构内容

输出 JSON：
{
  "summary": "一句话总结燃尽状况",
  "idealLine": [{ "date": "YYYY-MM-DD", "remaining": number }],
  "actualLine": [{ "date": "YYYY-MM-DD", "remaining": number }],
  "predictedCompletion": "YYYY-MM-DD",
  "deviation": "偏离度描述",
  "insights": ["洞察1", "洞察2", ...]
}
不要包含 markdown 代码块标记。

## 推理步骤
生成前请依次分析：
1. 期初任务总量是多少？按日划分理想燃尽线（线性递减到 0）
2. 按日累计已完成任务数，计算实际剩余任务量
3. 实际进度趋势如何？线性外推预测完成日期
4. 实际 vs 理想差异如何？描述偏离度
5. 识别风险与建议：是否滞后？哪些任务阻塞？资源是否充足？

## 输出格式
只返回合法 JSON，可被 JSON.parse() 直接解析，不要包含 markdown 代码块标记或其他文字。date 使用 YYYY-MM-DD 格式，remaining 为非负整数。如果数据不足以生成高质量结果，返回对应类型的空值而非编造内容。

## 示例
输入：周期 2026-09-09 至 2026-09-15，10 个任务，截至 09-13 完成 6 个
输出：
{"summary":"进度符合预期，预计按期完成","idealLine":[{"date":"2026-09-09","remaining":10},{"date":"2026-09-10","remaining":8},{"date":"2026-09-11","remaining":6},{"date":"2026-09-12","remaining":4},{"date":"2026-09-13","remaining":2},{"date":"2026-09-14","remaining":1},{"date":"2026-09-15","remaining":0}],"actualLine":[{"date":"2026-09-09","remaining":10},{"date":"2026-09-10","remaining":9},{"date":"2026-09-11","remaining":7},{"date":"2026-09-12","remaining":5},{"date":"2026-09-13","remaining":4}],"predictedCompletion":"2026-09-15","deviation":"基本吻合","insights":["进度符合预期","建议关注剩余 4 个任务的资源分配"]}`, feedbackExamples);
}

/**
 * 构造燃尽图分析 user prompt。
 *
 * @param tasks 任务列表
 * @param period 分析周期
 */
export function buildBurndownUserPrompt(
  tasks: BurndownTask[],
  period: AnalysisPeriod,
): string {
  const startStr = period.start.toISOString().split("T")[0];
  const endStr = period.end.toISOString().split("T")[0];
  const taskLines = tasks.map((t) => {
    const due = t.dueDate ? t.dueDate.toISOString().split("T")[0] : "无";
    const created = t.createdAt.toISOString().split("T")[0];
    const updated = t.updatedAt.toISOString().split("T")[0];
    return `- 标题: ${t.title} | 状态: ${t.status} | 截止: ${due} | 创建: ${created} | 更新: ${updated}`;
  });
  const truncated = taskLines.length > 200
    ? taskLines.slice(0, 200).join("\n") + "\n\n[任务列表已截断，仅显示前 200 条]"
    : taskLines.join("\n");
  return `分析周期：${startStr} 至 ${endStr}

任务数据（共 ${tasks.length} 条）：
${truncated || "（无任务数据）"}`;
}

/** Prisma Task 行（select 后） → BurndownTask（仅取分析所需字段） */
export function toBurndownTask(task: {
  title: string;
  status: string;
  dueDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): BurndownTask {
  return {
    title: task.title,
    status: task.status,
    dueDate: task.dueDate,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}