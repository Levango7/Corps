/**
 * 内置工具集（Built-in Tools）。
 *
 * 4 个工作区级内置工具，覆盖 AI 编排常见需求：
 *  - search_tasks：按标题/状态/指派人搜索任务（只读）
 *  - create_task：创建任务（有副作用，AI 安全约束下需人工确认）
 *  - search_documents：按标题搜索文档（只读）
 *  - get_workspace_stats：工作区统计概览（只读）
 *
 * 所有工具在 RLS 事务内执行（tx 由 ToolContext 注入），受行级安全策略约束，
 * 仅能操作当前工作区数据。模块 import 时自动注册到 toolRegistry 单例。
 *
 * AI 安全约束：工具执行结果返回给 AI 供参考，不自动执行有副作用的操作。
 * create_task 虽有写入能力，但调用方（API 路由）应要求人工确认后才真正执行。
 */

import type { Prisma } from "@prisma/client";
import { toolRegistry, type ToolDefinition } from "./registry";

// ─── search_tasks ────────────────────────────────────────────────────────────

const searchTasksTool: ToolDefinition = {
  name: "search_tasks",
  description:
    "搜索当前工作区的任务。可按标题模糊匹配、状态、指派人 ID 过滤。返回任务列表（不含已软删除）。",
  parameters: {
    type: "object",
    description: "任务搜索条件",
    properties: {
      title: {
        type: "string",
        description: "标题模糊匹配（大小写不敏感）",
      },
      status: {
        type: "string",
        enum: ["todo", "in_progress", "review", "done"],
        description: "任务状态",
      },
      assigneeId: {
        type: "string",
        description: "指派人用户 ID",
      },
      limit: {
        type: "integer",
        description: "返回上限（默认 20，最大 100）",
        minimum: 1,
        maximum: 100,
      },
    },
    additionalProperties: false,
  },
  async execute(args, context) {
    const { tx, workspaceId } = context;
    const title = typeof args.title === "string" ? args.title : undefined;
    const status = typeof args.status === "string" ? args.status : undefined;
    const assigneeId = typeof args.assigneeId === "string" ? args.assigneeId : undefined;
    const rawLimit = typeof args.limit === "number" ? args.limit : 20;
    const limit = Math.max(1, Math.min(100, Math.floor(rawLimit)));

    const tasks = await tx.task.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        ...(title ? { title: { contains: title, mode: "insensitive" } } : {}),
        ...(status ? { status } : {}),
        ...(assigneeId ? { assigneeId } : {}),
      },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        assigneeId: true,
        dueDate: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return { success: true, data: { tasks, count: tasks.length } };
  },
};

// ─── create_task ─────────────────────────────────────────────────────────────

const createTaskTool: ToolDefinition = {
  name: "create_task",
  description:
    "在当前工作区创建任务。有副作用——AI 安全约束下调用方应要求人工确认后才执行。返回新任务 ID。",
  parameters: {
    type: "object",
    description: "任务创建参数",
    properties: {
      title: {
        type: "string",
        description: "任务标题（必填，1-255 字符）",
        minLength: 1,
        maxLength: 255,
      },
      description: {
        type: "string",
        description: "任务描述（可选）",
      },
      status: {
        type: "string",
        enum: ["todo", "in_progress", "review", "done"],
        description: "初始状态（默认 todo）",
      },
      priority: {
        type: "string",
        enum: ["low", "medium", "high", "urgent"],
        description: "优先级（默认 medium）",
      },
      assigneeId: {
        type: "string",
        description: "指派人用户 ID（可选）",
      },
      dueDate: {
        type: "string",
        description: "截止日期 ISO 8601 字符串（可选）",
      },
    },
    required: ["title"],
    additionalProperties: false,
  },
  async execute(args, context) {
    const { tx, workspaceId, userId } = context;

    // 参数校验
    const title = typeof args.title === "string" ? args.title.trim() : "";
    if (!title) {
      return { success: false, error: "title 必填且不能为空" };
    }
    if (title.length > 255) {
      return { success: false, error: "title 长度不能超过 255 字符" };
    }

    const description = typeof args.description === "string" ? args.description : undefined;
    const status =
      typeof args.status === "string" &&
      ["todo", "in_progress", "review", "done"].includes(args.status)
        ? args.status
        : "todo";
    const priority =
      typeof args.priority === "string" &&
      ["low", "medium", "high", "urgent"].includes(args.priority)
        ? args.priority
        : "medium";
    const assigneeId = typeof args.assigneeId === "string" ? args.assigneeId : undefined;

    // 截止日期解析（ISO 8601 → Date）
    let dueDate: Date | undefined;
    if (typeof args.dueDate === "string") {
      const parsed = new Date(args.dueDate);
      if (Number.isNaN(parsed.getTime())) {
        return { success: false, error: "dueDate 不是合法的 ISO 8601 日期" };
      }
      dueDate = parsed;
    }

    const task = await tx.task.create({
      data: {
        workspaceId,
        title,
        description,
        status,
        priority,
        assigneeId,
        dueDate,
        createdBy: userId,
      },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
      },
    });

    return { success: true, data: { task } };
  },
};

// ─── search_documents ────────────────────────────────────────────────────────

const searchDocumentsTool: ToolDefinition = {
  name: "search_documents",
  description:
    "搜索当前工作区的文档。按标题模糊匹配，返回文档摘要列表（不含正文，避免上下文溢出）。",
  parameters: {
    type: "object",
    description: "文档搜索条件",
    properties: {
      title: {
        type: "string",
        description: "标题模糊匹配（大小写不敏感）",
      },
      limit: {
        type: "integer",
        description: "返回上限（默认 20，最大 100）",
        minimum: 1,
        maximum: 100,
      },
    },
    additionalProperties: false,
  },
  async execute(args, context) {
    const { tx, workspaceId } = context;
    const title = typeof args.title === "string" ? args.title : undefined;
    const rawLimit = typeof args.limit === "number" ? args.limit : 20;
    const limit = Math.max(1, Math.min(100, Math.floor(rawLimit)));

    const documents = await tx.document.findMany({
      where: {
        workspaceId,
        ...(title ? { title: { contains: title, mode: "insensitive" } } : {}),
      },
      select: {
        id: true,
        title: true,
        icon: true,
        emoji: true,
        authorId: true,
        publishedAt: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
    });

    return { success: true, data: { documents, count: documents.length } };
  },
};

// ─── get_workspace_stats ─────────────────────────────────────────────────────

const getWorkspaceStatsTool: ToolDefinition = {
  name: "get_workspace_stats",
  description:
    "获取当前工作区统计概览：任务总数、各状态任务数、文档数、成员数。只读，无参数。",
  parameters: {
    type: "object",
    description: "无参数",
    properties: {},
    additionalProperties: false,
  },
  async execute(_args, context) {
    const { tx, workspaceId } = context;

    // 并行聚合各维度计数（单事务内，共享 RLS GUC）
    const [
      taskTotal,
      taskTodo,
      taskInProgress,
      taskReview,
      taskDone,
      documentTotal,
      memberTotal,
    ] = await Promise.all([
      tx.task.count({ where: { workspaceId, deletedAt: null } }),
      tx.task.count({ where: { workspaceId, deletedAt: null, status: "todo" } }),
      tx.task.count({ where: { workspaceId, deletedAt: null, status: "in_progress" } }),
      tx.task.count({ where: { workspaceId, deletedAt: null, status: "review" } }),
      tx.task.count({ where: { workspaceId, deletedAt: null, status: "done" } }),
      tx.document.count({ where: { workspaceId } }),
      tx.member.count({ where: { workspaceId } }),
    ]);

    const stats = {
      tasks: {
        total: taskTotal,
        todo: taskTodo,
        inProgress: taskInProgress,
        review: taskReview,
        done: taskDone,
      },
      documents: documentTotal,
      members: memberTotal,
    };

    return { success: true, data: stats };
  },
};

// ─── 注册 ────────────────────────────────────────────────────────────────────

/** 注册所有内置工具到 toolRegistry 单例 */
export function registerBuiltinTools(): void {
  toolRegistry.register(searchTasksTool);
  toolRegistry.register(createTaskTool);
  toolRegistry.register(searchDocumentsTool);
  toolRegistry.register(getWorkspaceStatsTool);
}

// 模块 import 时自动注册（单次，幂等——同名工具 register 覆盖）
registerBuiltinTools();

// 导出工具定义（供测试或文档生成使用）
export {
  searchTasksTool,
  createTaskTool,
  searchDocumentsTool,
  getWorkspaceStatsTool,
};

// Prisma.InputJsonValue 占位引用（部分工具未来扩展 JSON 字段时使用）
// 保留导入避免 tree-shaking 误删类型引用
export type { Prisma };