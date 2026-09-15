// 团队效能分析 prompt 模板——基于成员与任务数据生成团队效能分析 JSON。
//
// 输出 JSON 契约：
//   {
//     "summary": string,
//     "members": [{ "name": string, "completionRate": number, "avgCycleDays": number, "workload": number, "strengths": string[] }],
//     "insights": string[]
//   }


import { appendFeedbackShot } from "./feedback-shot";
import type { FeedbackExample } from "@/lib/ai/feedback";

/** 成员行（仅取分析所需字段） */
export interface TeamMember {
  userId: string;
  name: string;
  role: string;
}

/** 任务行（仅取分析所需字段） */
export interface TeamTask {
  title: string;
  status: string;
  assigneeId: string | null;
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
 * 构造团队效能分析 system prompt。
 */
export function buildTeamPerformanceSystemPrompt(feedbackExamples?: FeedbackExample[]): string {
  return appendFeedbackShot(`你是团队管理专家，擅长分析团队效能。根据成员与任务数据生成团队效能分析。
要求：
1) 每位成员计算完成率（已完成 / 总分配）、平均周期天数（done 任务的 createdAt→updatedAt）、当前负载（未完成任务数）
2) strengths 列出 2-3 条成员擅长方向（基于完成率高、周期短的任务特征推断）
3) insights 给出 3-5 条团队级建议（负载均衡 / 协作优化 / 风险成员）
4) 仅基于给定数据，不添加虚构内容

输出 JSON：
{
  "summary": "一句话总结团队效能",
  "members": [{ "name": "成员名", "completionRate": 0.75, "avgCycleDays": 3.5, "workload": 4, "strengths": ["前端开发", "Bug 修复"] }],
  "insights": ["洞察1", "洞察2", ...]
}
不要包含 markdown 代码块标记。

## 推理步骤
1. 按成员分组任务，统计每人已完成 / 进行中 / 待办数量
2. 计算每人完成率（已完成 / 总分配）、平均周期（done 任务 createdAt→updatedAt 天数的均值）
3. 推断每人 strengths：完成率高且周期短的任务类型
4. 识别负载不均、风险成员（完成率低 / 周期长）、协作机会
5. 汇总团队级 insights

## 输出格式
只返回合法 JSON，可被 JSON.parse() 直接解析，不要包含 markdown 代码块标记或其他文字。completionRate 为 0-1 之间的小数，avgCycleDays 为非负数，workload 为非负整数。如果数据不足以生成高质量结果，返回对应类型的空值而非编造内容。

## 示例
输入：3 名成员，每人分配 5-10 个任务
输出：
{"summary":"团队整体完成率 72%，负载基本均衡","members":[{"name":"张三","completionRate":0.8,"avgCycleDays":2.5,"workload":3,"strengths":["前端开发","Bug 修复"]},{"name":"李四","completionRate":0.7,"avgCycleDays":3.2,"workload":4,"strengths":["后端接口","数据库设计"]}],"insights":["张三完成率最高，可承担更多关键任务","李四负载略高，建议平衡分配"]}`, feedbackExamples);
}

/**
 * 构造团队效能分析 user prompt。
 */
export function buildTeamPerformanceUserPrompt(
  members: TeamMember[],
  tasks: TeamTask[],
  period: AnalysisPeriod,
): string {
  const startStr = period.start.toISOString().split("T")[0];
  const endStr = period.end.toISOString().split("T")[0];
  const memberLines = members.map((m) => `- userId: ${m.userId} | 姓名: ${m.name} | 角色: ${m.role}`);
  const taskLines = tasks.map((t) => {
    const due = t.dueDate ? t.dueDate.toISOString().split("T")[0] : "无";
    const created = t.createdAt.toISOString().split("T")[0];
    return `- 标题: ${t.title} | 状态: ${t.status} | 负责人: ${t.assigneeId ?? "未分配"} | 截止: ${due} | 创建: ${created}`;
  });
  const truncate = (lines: string[], limit: number) =>
    lines.length > limit
      ? lines.slice(0, limit).join("\n") + `\n\n[已截断，仅显示前 ${limit} 条]`
      : lines.join("\n");
  return `分析周期：${startStr} 至 ${endStr}

成员列表（共 ${members.length} 人）：
${truncate(memberLines, 50) || "（无成员）"}

任务列表（共 ${tasks.length} 条）：
${truncate(taskLines, 200) || "（无任务）"}`;
}

/** Prisma Member + User 行（select 后） → TeamMember */
export function toTeamMember(member: {
  userId: string;
  role: string;
  user: { name: string | null; email: string };
}): TeamMember {
  return {
    userId: member.userId,
    name: member.user.name ?? member.user.email,
    role: member.role,
  };
}

/** Prisma Task 行（select 后） → TeamTask */
export function toTeamTask(task: {
  title: string;
  status: string;
  assigneeId: string | null;
  dueDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): TeamTask {
  return {
    title: task.title,
    status: task.status,
    assigneeId: task.assigneeId,
    dueDate: task.dueDate,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}