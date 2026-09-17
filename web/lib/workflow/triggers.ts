/**
 * 工作流事件触发器 — 业务事件 → 工作流的自动触发链路。
 *
 * 设计要点：
 *  - 业务操作（如创建任务）完成后调用 emitWorkflowEvent 发射事件
 *  - 查询 active=true 且 trigger.event === eventName 的 Workflow 列表
 *  - 对每个匹配的 Workflow 创建 WorkflowExecution（pending）并同步执行
 *  - 整个触发器用 try-catch 包裹，失败不影响业务操作（静默记录到 logger）
 *
 * 与 lib/workspace-events.ts 的 emitWorkspaceEvent 区别：
 *  - workspace-events：单实例 EventEmitter，用于 SSE 实时推送（前端订阅）
 *  - workflow/triggers：查询数据库工作流定义，创建执行记录并运行动作链
 *  两者命名相近但职责不同，在 tasks/route.ts 中分别导入。
 *
 * 事件命名约定（业务事件 → 工作流触发器）：
 *  - task.created：任务创建后
 *  - task.updated：任务更新后
 *  - task.deleted：任务删除后
 *  - task.status_changed：任务状态变更后
 *  - 其他业务事件按需扩展
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { Prisma } from "@prisma/client";
import { executeWorkflow } from "./executor";

/** 触发事件载荷 */
export type WorkflowEventPayload = Record<string, unknown>;

/**
 * 发射工作流事件 — 查询匹配的活跃工作流并同步执行。
 *
 * 调用方应在业务操作成功后调用此函数，并用 .catch(() => {}) 静默处理，
 * 确保触发器失败不影响主业务流程。
 *
 * @param workspaceId 工作区 id
 * @param eventName 事件名（如 "task.created"）
 * @param payload 事件载荷（如 { taskId, title, ... }）
 */
export async function emitWorkflowEvent(
  workspaceId: string,
  eventName: string,
  payload: WorkflowEventPayload,
): Promise<void> {
  try {
    // 1. 查询活跃工作流（active=true 且属于该工作区）
    //    trigger 是 JSON 字段，Prisma 对 JsonB 的等值过滤语法在各版本支持不一，
    //    这里先查所有活跃工作流，在代码层过滤 trigger.event === eventName，
    //    工作流数量通常很少（每个工作区几十条），内存过滤可接受。
    const workflows = await prisma.workflow.findMany({
      where: {
        workspaceId,
        active: true,
      },
      select: { id: true, name: true, trigger: true },
    });

    // 2. 过滤 trigger.event === eventName 的工作流
    const matched = workflows.filter((wf) => {
      const trigger = wf.trigger;
      if (typeof trigger !== "object" || trigger === null) return false;
      return (trigger as Record<string, unknown>).event === eventName;
    });

    if (matched.length === 0) {
      // 无匹配工作流，静默返回（高频路径，不记日志避免噪声）
      return;
    }

    logger.info("[workflow:trigger] event matched workflows", {
      workspaceId,
      eventName,
      workflowCount: matched.length,
    });

    // 3. 对每个匹配的工作流：创建执行记录并同步执行
    //    串行执行避免并发对同一工作区造成 DB 连接压力
    for (const wf of matched) {
      try {
        const execution = await prisma.workflowExecution.create({
          data: {
            workflowId: wf.id,
            workspaceId,
            triggerData: payload as Prisma.InputJsonValue,
            status: "pending",
          },
          select: { id: true },
        });

        // 同步执行工作流（executeWorkflow 内部已 try-catch，不会抛异常）
        await executeWorkflow(workspaceId, wf.id, execution.id, payload);
      } catch (error) {
        // 单个工作流触发失败不影响其他工作流
        const message = error instanceof Error ? error.message : String(error);
        logger.error("[workflow:trigger] single workflow trigger failed", {
          workspaceId,
          eventName,
          workflowId: wf.id,
          workflowName: wf.name,
          error: message,
        });
      }
    }
  } catch (error) {
    // 触发器整体失败：仅记录日志，不向调用方抛出
    const message = error instanceof Error ? error.message : String(error);
    logger.error("[workflow:trigger] emitWorkflowEvent failed", {
      workspaceId,
      eventName,
      error: message,
    });
  }
}