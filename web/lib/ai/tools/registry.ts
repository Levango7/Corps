/**
 * AI 工具注册表（Tool Registry）。
 *
 * 为 AI 编排层提供可插拔的工具调用能力：每个工具声明 name / description /
 * JSON Schema 参数 + execute 回调，注册表统一管理生命周期与执行派发。
 *
 * 设计要点：
 *  - 工具与 MCP（Model Context Protocol）工具调用语义对齐：AI 模型根据
 *    name + description + parameters schema 决定是否调用，execute 返回
 *    ToolResult 供 AI 参考下一步推理，不自动执行有副作用的操作。
 *  - 注册表为进程内单例（toolRegistry），内置工具在 builtins.ts 末尾注册。
 *  - execute 接收 ToolContext（含 Prisma 事务客户端 tx、workspaceId、userId），
 *    所有 DB 操作在 RLS 事务内执行，受行级安全策略约束。
 *  - JSON Schema 用宽松结构类型（JsonSchema），避免引入 ajv 等运行时校验依赖；
 *    参数校验由各工具 execute 内部自行处理（zod 或手动断言）。
 */

import type { Prisma } from "@prisma/client";

/**
 * JSON Schema 子集（足够描述工具参数，不追求完整 JSON Schema 规范）。
 * 用宽松结构避免与 ajv / json-schema-to-ts 等依赖耦合。
 */
export interface JsonSchema {
  type?: "object" | "string" | "number" | "integer" | "boolean" | "array" | "null";
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  additionalProperties?: boolean;
  /** 允许任意扩展字段（如 minLength、format 等），不强制类型 */
  [key: string]: unknown;
}

/**
 * 工具执行上下文：由 API 路由层注入。
 * tx 为 RLS 事务客户端，所有 DB 操作受行级安全策略约束。
 */
export interface ToolContext {
  /** 工作区 ID（RLS app.workspace_id） */
  workspaceId: string;
  /** 当前用户 ID（RLS app.user_id） */
  userId: string;
  /** Prisma 事务客户端（已注入 RLS GUC） */
  tx: Prisma.TransactionClient;
}

/** 工具执行结果：返回给 AI 供参考，不自动执行有副作用的操作 */
export interface ToolResult {
  /** 是否成功 */
  success: boolean;
  /** 成功时的返回数据（任意 JSON 可序列化结构） */
  data?: unknown;
  /** 失败时的错误信息 */
  error?: string;
}

/**
 * 工具定义：描述工具元信息 + 执行回调。
 * 与 MCP Tool 定义对齐（name + description + inputSchema → execute）。
 */
export interface ToolDefinition {
  /** 工具名（唯一键，snake_case，如 search_tasks） */
  name: string;
  /** 工具描述（供 AI 决策调用，应清晰说明用途与边界） */
  description: string;
  /** 参数 JSON Schema（供 AI 构造调用参数） */
  parameters: JsonSchema;
  /** 执行回调：在 RLS 事务内运行，返回 ToolResult */
  execute: (args: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;
}

/**
 * 工具注册表：管理工具的注册 / 注销 / 查询 / 执行。
 *
 * 线程安全说明：单进程内存 Map，Next.js 服务端单例。多实例部署时各实例
 * 独立注册（内置工具在模块 import 时自注册），无跨实例同步需求。
 */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  /** 注册工具：同名工具将被覆盖（支持热更新） */
  register(tool: ToolDefinition): void {
    if (!tool.name) throw new Error("[toolRegistry] 工具 name 不能为空");
    this.tools.set(tool.name, tool);
  }

  /** 注销工具 */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /** 获取单个工具定义（不存在返回 undefined） */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /** 列出所有已注册工具（返回副本，防外部遍历篡改内部 Map） */
  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  /**
   * 执行指定工具。
   *
   * 工具不存在时返回失败 ToolResult（不抛异常），便于调用方统一处理。
   * 工具内部异常被捕获并转为失败 ToolResult，避免单工具崩溃影响编排层。
   */
  async execute(
    name: string,
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, error: `工具不存在: ${name}` };
    }
    try {
      return await tool.execute(args, context);
    } catch (error) {
      // 工具执行异常转为失败结果，不向上抛出
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `工具执行异常: ${message}` };
    }
  }
}

/** 工具注册表单例（进程级共享） */
export const toolRegistry = new ToolRegistry();