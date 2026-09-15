// 自动周报 prompt 模板——基于本周工作数据生成结构化周报 JSON。
//
// 输出 JSON 契约：
//   {
//     "summary": string,
//     "completed": [{ "title": string, "owner": string, "date": string }],
//     "planned": [{ "title": string, "owner": string, "dueDate": string }],
//     "risks": [{ "description": string, "level": "low" | "medium" | "high" }],
//     "milestones": [{ "title": string, "status": string }],
//     "insights": string[]
//   }


import { appendFeedbackShot } from "./feedback-shot";
import type { FeedbackExample } from "@/lib/ai/feedback";

/** 任务行（仅取分析所需字段） */
export interface WeeklyTask {
  title: string;
  status: string;
  priority: string;
  assigneeName: string | null;
  dueDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 里程碑行 */
export interface WeeklyMilestone {
  name: string;
  dueDate: Date | null;
  taskCount: number;
  doneCount: number;
}

/** 周报数据 */
export interface WeekData {
  weekStart: Date;
  weekEnd: Date;
  tasks: WeeklyTask[];
  milestones: WeeklyMilestone[];
}

/** 工作区上下文摘要（用于补充周报背景） */
export interface WorkspaceContext {
  workspaceName: string;
  memberCount: number;
}

/**
 * 构造周报 system prompt。
 */
export function buildWeeklyReportSystemPrompt(feedbackExamples?: FeedbackExample[]): string {
  return appendFeedbackShot(`你是项目周报生成助手。根据本周工作数据生成结构化周报。
要求：
1) completed：本周完成的任务（status=done 且 updatedAt 在本周内），按完成时间倒序
2) planned：下周计划任务（未完成且 dueDate 在下周内，或高优先级未完成任务）
3) risks：识别风险项（阻塞任务 / 逾期任务 / 高优先级未分配），level 为 low/medium/high
4) milestones：本周相关里程碑及其状态（如"进行中" / "已达成" / "有风险"）
5) summary：一句话总结本周成果
6) insights：3-5 条 AI 洞察（趋势 / 建议 / 关注点）
7) 仅基于给定数据，不添加虚构内容

输出 JSON：
{
  "summary": "一句话总结本周成果",
  "completed": [{ "title": "任务标题", "owner": "负责人", "date": "YYYY-MM-DD" }],
  "planned": [{ "title": "任务标题", "owner": "负责人", "dueDate": "YYYY-MM-DD" }],
  "risks": [{ "description": "风险描述", "level": "low" }],
  "milestones": [{ "title": "里程碑名", "status": "进行中" }],
  "insights": ["洞察1", "洞察2", ...]
}
不要包含 markdown 代码块标记。

## 推理步骤
1. 筛选本周完成的任务（status=done 且 updatedAt 在 [weekStart, weekEnd] 内）
2. 筛选下周计划任务（dueDate 在 [weekEnd, weekEnd+7d] 内，或高优先级未完成）
3. 识别风险：blocked=true / 逾期 / 高优先级未分配，按严重程度分级
4. 评估里程碑状态：doneCount/taskCount 比例 + dueDate 临近度
5. 汇总本周成果为一句话 summary
6. 生成 3-5 条 insights（趋势 / 建议 / 关注点）

## 输出格式
只返回合法 JSON，可被 JSON.parse() 直接解析，不要包含 markdown 代码块标记或其他文字。date/dueDate 使用 YYYY-MM-DD 格式，level 只能是 "low" / "medium" / "high" 之一。如果数据不足以生成高质量结果，返回对应类型的空值而非编造内容。

## 示例
输入：本周完成 5 个任务，1 个风险，1 个里程碑
输出：
{"summary":"本周完成 5 项任务，登录模块上线，搜索性能优化","completed":[{"title":"完成登录接口开发","owner":"张三","date":"2026-09-14"},{"title":"修复搜索分页 Bug","owner":"李四","date":"2026-09-15"}],"planned":[{"title":"数据导出功能联调","owner":"张三","dueDate":"2026-09-18"}],"risks":[{"description":"数据导出依赖的第三方服务不稳定","level":"medium"}],"milestones":[{"title":"V2.0 登录模块","status":"已达成"}],"insights":["本周进度符合预期","建议下周关注第三方服务稳定性"]}`, feedbackExamples);
}

/**
 * 构造周报 user prompt。
 */
export function buildWeeklyReportUserPrompt(
  ctx: WorkspaceContext,
  weekData: WeekData,
): string {
  const startStr = weekData.weekStart.toISOString().split("T")[0];
  const endStr = weekData.weekEnd.toISOString().split("T")[0];
  const taskLines = weekData.tasks.map((t) => {
    const due = t.dueDate ? t.dueDate.toISOString().split("T")[0] : "无";
    const updated = t.updatedAt.toISOString().split("T")[0];
    return `- 标题: ${t.title} | 状态: ${t.status} | 优先级: ${t.priority} | 负责人: ${t.assigneeName ?? "未分配"} | 截止: ${due} | 更新: ${updated}`;
  });
  const milestoneLines = weekData.milestones.map((m) => {
    const due = m.dueDate ? m.dueDate.toISOString().split("T")[0] : "无";
    const progress = m.taskCount > 0 ? `${m.doneCount}/${m.taskCount}` : "0";
    return `- 名称: ${m.name} | 截止: ${due} | 进度: ${progress}`;
  });
  const truncate = (lines: string[], limit: number) =>
    lines.length > limit
      ? lines.slice(0, limit).join("\n") + `\n\n[已截断，仅显示前 ${limit} 条]`
      : lines.join("\n");
  return `工作区：${ctx.workspaceName}（${ctx.memberCount} 人）
本周周期：${startStr} 至 ${endStr}

任务数据（共 ${weekData.tasks.length} 条）：
${truncate(taskLines, 200) || "（无任务）"}

里程碑（共 ${weekData.milestones.length} 个）：
${truncate(milestoneLines, 30) || "（无里程碑）"}`;
}

/** Prisma Task 行（含 assignee select） → WeeklyTask */
export function toWeeklyTask(task: {
  title: string;
  status: string;
  priority: string;
  dueDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  assignee: { name: string | null; email: string } | null;
}): WeeklyTask {
  return {
    title: task.title,
    status: task.status,
    priority: task.priority,
    assigneeName: task.assignee?.name ?? task.assignee?.email ?? null,
    dueDate: task.dueDate,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

/** Prisma Milestone 行（含 tasks select） → WeeklyMilestone */
export function toWeeklyMilestone(milestone: {
  name: string;
  dueDate: Date | null;
  tasks: { status: string }[];
}): WeeklyMilestone {
  return {
    name: milestone.name,
    dueDate: milestone.dueDate,
    taskCount: milestone.tasks.length,
    doneCount: milestone.tasks.filter((t) => t.status === "done").length,
  };
}