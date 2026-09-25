/**
 * 工作流同步执行引擎（Next.js 无常驻进程，采用同步执行方案）。
 *
 * 设计要点：
 *  - 不依赖外部 worker/queue，在 API 请求上下文内同步推进状态机
 *    pending → running → completed/failed
 *  - Prisma 操作直接用 prisma client（不在 runWithWorkspace 事务上下文中，
 *    因为执行引擎可能被触发器/手动触发等多种入口调用，统一用裸 prisma 更简单）
 *  - 整个执行过程用 try-catch 包裹，确保不会抛出未捕获异常影响调用方
 *  - 每个动作独立 try-catch，单动作失败可配置是否终止后续动作（默认终止）
 *
 * 支持的动作类型（先实现基础几种）：
 *  - create_task：在工作区创建任务
 *  - send_notification：创建通知记录
 *  - update_task：更新任务字段
 *
 * 动作配置形态（actions JSON 数组元素）：
 *  { type: "create_task", config: { title, description?, status?, priority?, assigneeId?, dueDate? }, order }
 *  { type: "send_notification", config: { userId, type, entityId, entityTitle }, order }
 *  { type: "update_task", config: { taskId, title?, status?, priority?, assigneeId?, dueDate? }, order }
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { Prisma } from "@prisma/client";

/** 动作类型联合 */
export type WorkflowActionType = "create_task" | "send_notification" | "update_task";

/** 动作定义（Workflow.actions JSON 数组元素） */
export interface WorkflowAction {
  type: WorkflowActionType;
  config: Record<string, unknown>;
  order?: number;
}

/** 单个动作执行结果 */
export interface ActionResult {
  /** 动作在数组中的索引 */
  index: number;
  /** 动作类型 */
  type: WorkflowActionType;
  /** 执行状态：success | failed */
  status: "success" | "failed";
  /** 动作产出的实体 id（如创建的任务 id） */
  entityId?: string;
  /** 失败时的错误信息 */
  error?: string;
}

/** 触发数据（来自 WorkflowExecution.triggerData） */
export type TriggerData = Record<string, unknown>;

/**
 * 同步执行工作流。
 *
 * 状态机：pending → running → completed/failed
 *
 * @param workspaceId 工作区 id
 * @param workflowId 工作流 id
 * @param executionId 执行记录 id
 * @param triggerData 触发事件数据
 */
export async function executeWorkflow(
  workspaceId: string,
  workflowId: string,
  executionId: string,
  triggerData: TriggerData,
): Promise<void> {
  try {
    // 1. 读取 Workflow（含 actions JSON 字段）
    const workflow = await prisma.workflow.findUnique({
      where: { id: workflowId },
      select: { actions: true, name: true, workspaceId: true },
    });

    if (!workflow) {
      logger.error("[workflow:executor] workflow not found", { workflowId, executionId });
      await markFailed(executionId, `workflow ${workflowId} not found`);
      return;
    }

    // 防御：工作流工作区与传入 workspaceId 不一致（防跨租户执行）
    if (workflow.workspaceId !== workspaceId) {
      logger.error("[workflow:executor] workspace mismatch", {
        workflowId,
        expected: workspaceId,
        actual: workflow.workspaceId,
      });
      await markFailed(executionId, "workspace mismatch");
      return;
    }

    // 2. 更新状态：pending → running
    await prisma.workflowExecution.update({
      where: { id: executionId },
      data: {
        status: "running",
        startedAt: new Date(),
      },
    });

    logger.info("[workflow:executor] execution started", {
      workflowId,
      executionId,
      workflowName: workflow.name,
    });

    // 3. 解析 actions JSON 数组
    const actions = parseActions(workflow.actions);

    // 4. 逐个执行动作
    const results: ActionResult[] = [];
    for (let i = 0; i < actions.length; i++) {
      // 每次执行动作前检查是否已被取消（cancel API 可在执行期间将 status 改为 "cancelled"）
      const current = await prisma.workflowExecution.findUnique({
        where: { id: executionId },
        select: { status: true },
      });
      if (current?.status === "cancelled") {
        logger.info("[workflow:executor] execution cancelled, aborting remaining actions", {
          workflowId,
          executionId,
          completedActions: i,
        });
        break;
      }

      const action = actions[i];
      const result = await executeAction(action, i, workspaceId, triggerData);
      results.push(result);

      // 单动作失败则终止后续动作（保守策略，避免级联错误）
      if (result.status === "failed") {
        logger.warn("[workflow:executor] action failed, aborting remaining actions", {
          workflowId,
          executionId,
          failedIndex: i,
          error: result.error,
        });
        break;
      }
    }

    // 5. 判定整体状态：有动作失败 → failed，否则 → completed
    const hasFailure = results.some((r) => r.status === "failed");
    if (hasFailure) {
      await prisma.workflowExecution.update({
        where: { id: executionId },
        data: {
          status: "failed",
          completedAt: new Date(),
          result: { actions: results, triggerData } as unknown as Prisma.InputJsonValue,
        },
      });
      logger.warn("[workflow:executor] execution failed", { workflowId, executionId, results });
    } else {
      await prisma.workflowExecution.update({
        where: { id: executionId },
        data: {
          status: "completed",
          completedAt: new Date(),
          result: { actions: results, triggerData } as unknown as Prisma.InputJsonValue,
        },
      });
      logger.info("[workflow:executor] execution completed", {
        workflowId,
        executionId,
        actionCount: results.length,
      });
    }
  } catch (error) {
    // 兜底：任何未预期异常都标记为 failed，不向调用方抛出
    const message = error instanceof Error ? error.message : String(error);
    logger.error("[workflow:executor] unexpected error", {
      workflowId,
      executionId,
      error: message,
    });
    await markFailed(executionId, message).catch(() => {
      // 标记失败本身也失败时，仅记录日志，不再向上传播
      logger.error("[workflow:executor] markFailed also failed", { executionId });
    });
  }
}

/**
 * 解析 actions JSON 字段为 WorkflowAction 数组。
 * 容错：非数组/空数组返回 []，非法元素跳过。
 */
function parseActions(raw: Prisma.JsonValue): WorkflowAction[] {
  if (!Array.isArray(raw)) return [];
  const actions: WorkflowAction[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const obj = item as Record<string, unknown>;
    const type = obj.type;
    if (type !== "create_task" && type !== "send_notification" && type !== "update_task") continue;
    const config = (obj.config ?? {}) as Record<string, unknown>;
    actions.push({
      type,
      config,
      order: typeof obj.order === "number" ? obj.order : undefined,
    });
  }
  // 按 order 升序排序（order 缺省按原序）
  return actions.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/**
 * 执行单个动作。
 * 每个动作类型独立 try-catch，失败返回 failed 结果，不抛异常。
 */
async function executeAction(
  action: WorkflowAction,
  index: number,
  workspaceId: string,
  triggerData: TriggerData,
): Promise<ActionResult> {
  try {
    switch (action.type) {
      case "create_task":
        return await executeCreateTask(action, index, workspaceId, triggerData);
      case "send_notification":
        return await executeSendNotification(action, index, workspaceId);
      case "update_task":
        return await executeUpdateTask(action, index, workspaceId);
      default:
        return {
          index,
          type: action.type,
          status: "failed",
          error: `unknown action type: ${action.type}`,
        };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { index, type: action.type, status: "failed", error: message };
  }
}

/**
 * create_task 动作：在工作区创建任务。
 * config 字段：title（必填）、description?、status?、priority?、assigneeId?、dueDate?
 * triggerData 中的字段可用 {{trigger.field}} 占位符引用（此处仅做简单字符串替换）。
 *
 * 递归防护：此函数直接用 prisma.task.create 创建任务，不经过 API 路由，
 * 因此不会触发 emitWorkflowEvent（task.created 事件），避免无限递归。
 * 切勿在此处添加 emitWorkflowEvent 调用，否则会导致 task.created → create_task → task.created 循环。
 */
async function executeCreateTask(
  action: WorkflowAction,
  index: number,
  workspaceId: string,
  triggerData: TriggerData,
): Promise<ActionResult> {
  const cfg = action.config;
  const title = resolveString(cfg.title, triggerData);
  if (!title) {
    return { index, type: "create_task", status: "failed", error: "config.title is required" };
  }

  const created = await prisma.task.create({
    data: {
      workspaceId,
      title,
      description: resolveStringOptional(cfg.description, triggerData),
      status: resolveStringOptional(cfg.status, triggerData) ?? "todo",
      priority: resolveStringOptional(cfg.priority, triggerData) ?? "medium",
      assigneeId: resolveStringOptional(cfg.assigneeId, triggerData),
      dueDate: resolveDateOptional(cfg.dueDate, triggerData),
    },
    select: { id: true },
  });

  return { index, type: "create_task", status: "success", entityId: created.id };
}

/**
 * send_notification 动作：创建通知记录。
 * config 字段：userId（必填）、type（必填）、entityId（必填）、entityTitle（必填）
 * 安全：校验 userId 是否为该工作区成员，防止越权向非成员发送通知
 */
async function executeSendNotification(
  action: WorkflowAction,
  index: number,
  workspaceId: string,
): Promise<ActionResult> {
  const cfg = action.config;
  const userId = asString(cfg.userId);
  const type = asString(cfg.type);
  const entityId = asString(cfg.entityId);
  const entityTitle = asString(cfg.entityTitle);

  if (!userId || !type || !entityId || !entityTitle) {
    return {
      index,
      type: "send_notification",
      status: "failed",
      error: "config requires userId, type, entityId, entityTitle",
    };
  }

  // 校验目标用户是否为该工作区成员（防止越权/钓鱼）
  const membership = await prisma.member.findFirst({
    where: { userId, workspaceId },
    select: { userId: true },
  });
  if (!membership) {
    return {
      index,
      type: "send_notification",
      status: "failed",
      error: `user ${userId} is not a member of workspace ${workspaceId}`,
    };
  }

  const created = await prisma.notification.create({
    data: {
      userId,
      workspaceId,
      type,
      entityId,
      entityTitle,
    },
    select: { id: true },
  });

  return { index, type: "send_notification", status: "success", entityId: created.id };
}

/**
 * update_task 动作：更新任务字段。
 * config 字段：taskId（必填）、title?、status?、priority?、assigneeId?、dueDate?
 * 至少需提供一个可更新字段。
 */
async function executeUpdateTask(
  action: WorkflowAction,
  index: number,
  workspaceId: string,
): Promise<ActionResult> {
  const cfg = action.config;
  const taskId = asString(cfg.taskId);
  if (!taskId) {
    return { index, type: "update_task", status: "failed", error: "config.taskId is required" };
  }

  // 构造更新数据，只包含显式提供的字段
  const data: Prisma.TaskUpdateInput = {};
  if (typeof cfg.title === "string") data.title = cfg.title;
  if (typeof cfg.status === "string") data.status = cfg.status;
  if (typeof cfg.priority === "string") data.priority = cfg.priority;
  if (typeof cfg.assigneeId === "string") data.assignee = { connect: { id: cfg.assigneeId } };
  if (cfg.dueDate !== undefined) {
    if (cfg.dueDate === null) {
      data.dueDate = null;
    } else if (typeof cfg.dueDate === "string") {
      const d = new Date(cfg.dueDate);
      if (!isNaN(d.getTime())) data.dueDate = d;
    }
  }

  if (Object.keys(data).length === 0) {
    return {
      index,
      type: "update_task",
      status: "failed",
      error: "no updatable fields provided",
    };
  }

  // 限定工作区，防跨租户更新
  const updated = await prisma.task.updateMany({
    where: { id: taskId, workspaceId },
    data,
  });

  if (updated.count === 0) {
    return {
      index,
      type: "update_task",
      status: "failed",
      error: `task ${taskId} not found in workspace ${workspaceId}`,
    };
  }

  return { index, type: "update_task", status: "success", entityId: taskId };
}

/** 标记执行为 failed（独立函数，便于在 catch 中复用） */
async function markFailed(executionId: string, errorMessage: string): Promise<void> {
  await prisma.workflowExecution.update({
    where: { id: executionId },
    data: {
      status: "failed",
      completedAt: new Date(),
      result: { error: errorMessage } as Prisma.InputJsonValue,
    },
  });
}

// ─── 占位符解析工具 ──────────────────────────────────────────────

/**
 * 解析字符串值，支持 {{trigger.field}} 占位符引用 triggerData。
 * 例如：title = "处理：{{trigger.title}}"，triggerData = { title: "Bug#1" } → "处理：Bug#1"
 */
function resolveString(value: unknown, triggerData: TriggerData): string {
  if (typeof value !== "string") return "";
  return resolvePlaceholders(value, triggerData);
}

function resolveStringOptional(value: unknown, triggerData: TriggerData): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return undefined;
  return resolvePlaceholders(value, triggerData);
}

function resolveDateOptional(value: unknown, triggerData: TriggerData): Date | undefined {
  if (value === undefined || value === null) return undefined;
  const str = typeof value === "string" ? resolvePlaceholders(value, triggerData) : "";
  if (!str) return undefined;
  const d = new Date(str);
  return isNaN(d.getTime()) ? undefined : d;
}

/** 替换 {{trigger.field.path}} 占位符 */
function resolvePlaceholders(template: string, triggerData: TriggerData): string {
  return template.replace(/\{\{\s*trigger\.([\w.]+)\s*\}\}/g, (_, path: string) => {
    const value = getPath(triggerData, path);
    return value === undefined || value === null ? "" : String(value);
  });
}

/** 从对象按点路径取值（如 "data.user.id"） */
function getPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** 安全转字符串，非字符串返回 undefined */
function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
