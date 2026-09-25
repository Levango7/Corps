// AI 助理上下文构建器——聚合任务全流程上下文。
//
// 设计要点：
// - buildTaskContext：在 RLS 事务内读取任务核心字段，拼成上下文字符串供 LLM 使用
// - phaseTransitionAdvice：按当前阶段返回流转建议（轻量、无 DB 访问）
//
// 来源：P2 后端任务 318（AI 助理编排引擎 + 对话 API）

import type { Prisma } from "@prisma/client";

/**
 * 构建任务全流程上下文。
 *
 * 在 RLS 事务内读取任务核心字段（title/description/status/priority/dueDate），
 * 拼成上下文字符串供 runAssistant 的 previousOutput 使用。
 *
 * @param tx Prisma 事务客户端（由 runWithWorkspace 注入 RLS）
 * @param workspaceId 工作区 ID（RLS 已约束，此处仅用于日志/扩展）
 * @param taskId 任务 ID（可选，未传时返回空串）
 * @returns 上下文字符串；任务不存在时返回空串
 */
export async function buildTaskContext(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  taskId?: string,
): Promise<string> {
  const parts: string[] = [];

  if (taskId) {
    const task = await tx.task.findUnique({
      where: { id: taskId },
      select: {
        title: true,
        description: true,
        status: true,
        priority: true,
        dueDate: true,
      },
    });
    if (task) {
      parts.push(`当前任务：${task.title}（状态：${task.status}，优先级：${task.priority}）`);
      if (task.description) parts.push(`描述：${task.description}`);
      if (task.dueDate) parts.push(`截止日期：${task.dueDate.toISOString()}`);
    }
  }

  // workspaceId 暂未直接用于查询（RLS 已通过 GUC 注入），
  // 保留参数以便未来扩展（如聚合工作区级统计）。
  void workspaceId;

  return parts.join("\n");
}

/**
 * 阶段流转建议。
 *
 * 按当前任务阶段返回固定的流转建议文案（轻量、无 DB 访问），
 * 供前端在阶段切换时展示引导提示。
 *
 * @param currentPhase 当前阶段
 * @param result 前一步结果（可选，预留用于条件化建议）
 * @returns 建议文案；无匹配阶段时返回 null
 */
export function phaseTransitionAdvice(currentPhase: string, result?: string): string | null {
  if (!result) return null;
  const TRANSITIONS: Record<string, string> = {
    created: "任务已创建，建议拆解子任务并分配。",
    in_progress: "任务进行中，建议定期检查进度。",
    review: "任务待审核，建议检查完成标准。",
    completed: "任务已完成，建议总结经验。",
    blocked: "任务受阻，建议分析原因并寻求帮助。",
  };
  return TRANSITIONS[currentPhase] ?? null;
}
