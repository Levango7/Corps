// 瓶颈分析 prompt 模板——基于任务与依赖数据识别瓶颈任务、关键路径与资源争用。
//
// 输出 JSON 契约：
//   {
//     "summary": string,
//     "bottlenecks": [{ "taskTitle": string, "reason": string, "impact": string, "suggestion": string }],
//     "criticalPath": string[],
//     "insights": string[]
//   }

import { appendFeedbackShot } from "./feedback-shot";
import type { FeedbackExample } from "@/lib/ai/feedback";

/** 任务行（仅取分析所需字段） */
export interface BottleneckTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  assigneeId: string | null;
  dueDate: Date | null;
  blocked: boolean;
  blockedReason: string | null;
  parentId: string | null;
  milestoneId: string | null;
}

/** 任务依赖行（基于 KnowledgeEdge 的 depends_on 关系或任务父子关系） */
export interface TaskDep {
  sourceTaskId: string;
  targetTaskId: string;
  relation: string; // "depends_on" | "parent_of" | "blocked_by"
}

/**
 * 构造瓶颈分析 system prompt。
 */
export function buildBottleneckSystemPrompt(feedbackExamples?: FeedbackExample[]): string {
  return appendFeedbackShot(
    `你是项目管理专家，擅长识别项目瓶颈与关键路径。根据任务与依赖数据识别瓶颈任务。
要求：
1) bottlenecks：识别阻塞任务（blocked=true）、逾期任务、长期未更新的进行中任务、高优先级但未分配的任务
2) criticalPath：按依赖关系推导关键路径（最长依赖链上的任务标题序列）
3) 每个 bottleneck 给出 reason（瓶颈原因）、impact（影响范围）、suggestion（解决建议）
4) insights 给出 3-5 条项目级建议
5) 仅基于给定数据，不添加虚构内容

输出 JSON：
{
  "summary": "一句话总结瓶颈状况",
  "bottlenecks": [{ "taskTitle": "任务标题", "reason": "瓶颈原因", "impact": "影响范围", "suggestion": "解决建议" }],
  "criticalPath": ["任务A", "任务B", "任务C"],
  "insights": ["洞察1", "洞察2", ...]
}
不要包含 markdown 代码块标记。

## 推理步骤
1. 扫描所有任务，识别 blocked=true 的任务及其 blockedReason
2. 比较任务 dueDate 与当前日期，识别逾期任务
3. 识别长期未更新的进行中任务（updatedAt 距今 > 7 天）
4. 识别高优先级但 assigneeId 为空的任务（资源争用）
5. 按依赖关系（depends_on / parent_of）推导关键路径（最长链）
6. 为每个瓶颈任务给出解决建议
7. 汇总项目级 insights

## 输出格式
只返回合法 JSON，可被 JSON.parse() 直接解析，不要包含 markdown 代码块标记或其他文字。criticalPath 为任务标题字符串数组（按执行顺序）。如果数据不足以生成高质量结果，返回对应类型的空值而非编造内容。

## 示例
输入：1 个阻塞任务，1 个逾期任务
输出：
{"summary":"存在 2 个瓶颈任务，影响关键路径","bottlenecks":[{"taskTitle":"数据迁移","reason":"被外部接口阻塞","impact":"阻塞下游 3 个任务","suggestion":"协调外部接口方加快进度，或准备降级方案"}],"criticalPath":["需求评审","数据迁移","报表开发","上线"],"insights":["数据迁移是关键瓶颈，建议优先解决","建议为高优先级任务分配明确负责人"]}`,
    feedbackExamples,
  );
}

/**
 * 构造瓶颈分析 user prompt。
 */
export function buildBottleneckUserPrompt(
  tasks: BottleneckTask[],
  dependencies: TaskDep[],
): string {
  const taskLines = tasks.map((t) => {
    const due = t.dueDate ? t.dueDate.toISOString().split("T")[0] : "无";
    return `- id: ${t.id} | 标题: ${t.title} | 状态: ${t.status} | 优先级: ${t.priority} | 负责人: ${t.assigneeId ?? "未分配"} | 截止: ${due} | 阻塞: ${t.blocked} | 阻塞原因: ${t.blockedReason ?? "无"} | 父任务: ${t.parentId ?? "无"} | 里程碑: ${t.milestoneId ?? "无"}`;
  });
  const depLines = dependencies.map(
    (d) => `- ${d.sourceTaskId} --[${d.relation}]--> ${d.targetTaskId}`,
  );
  const truncate = (lines: string[], limit: number) =>
    lines.length > limit
      ? lines.slice(0, limit).join("\n") + `\n\n[已截断，仅显示前 ${limit} 条]`
      : lines.join("\n");
  return `任务数据（共 ${tasks.length} 条）：
${truncate(taskLines, 200) || "（无任务）"}

依赖关系（共 ${dependencies.length} 条）：
${truncate(depLines, 100) || "（无依赖）"}`;
}

/** Prisma Task 行（select 后） → BottleneckTask */
export function toBottleneckTask(task: {
  id: string;
  title: string;
  status: string;
  priority: string;
  assigneeId: string | null;
  dueDate: Date | null;
  blocked: boolean;
  blockedReason: string | null;
  parentId: string | null;
  milestoneId: string | null;
}): BottleneckTask {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    assigneeId: task.assigneeId,
    dueDate: task.dueDate,
    blocked: task.blocked,
    blockedReason: task.blockedReason,
    parentId: task.parentId,
    milestoneId: task.milestoneId,
  };
}

/** KnowledgeEdge 行（select 后） → TaskDep */
export function toTaskDepFromEdge(
  edge: {
    sourceNodeId: string;
    targetNodeId: string;
    relation: string;
  },
  sourceMap: Map<string, string>,
  targetMap: Map<string, string>,
): TaskDep | null {
  const sourceTaskId = sourceMap.get(edge.sourceNodeId);
  const targetTaskId = targetMap.get(edge.targetNodeId);
  if (!sourceTaskId || !targetTaskId) return null;
  return {
    sourceTaskId,
    targetTaskId,
    relation: edge.relation,
  };
}
