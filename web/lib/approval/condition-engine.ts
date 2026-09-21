/**
 * 条件审批引擎 — 基于 JSON Logic 的条件分支路由
 *
 * 设计原则：
 * - 使用 json-logic-js 进行条件求值，支持复杂业务规则
 * - 兼容现有扁平 nodes 数组格式（order 顺序连接）和新的图结构格式（nodes + edges）
 * - 条件求值失败时返回默认分支，不崩溃
 * - 所有函数纯函数化，便于测试和缓存
 *
 * 核心概念：
 * - ConditionBranch：条件分支，包含 JSON Logic 表达式和目标节点 ID
 * - ConditionNode：条件节点，包含多个条件分支，按顺序求值
 * - conditionCache：条件求值结果缓存（nodeId → targetNodeId），用于初始化时一次性求值
 *
 * @module condition-engine
 */

import jsonLogic from "json-logic-js";

// ─── 类型定义 ───────────────────────────────────────────────

/**
 * 条件分支 — 对应设计文档中的 ConditionBranch
 * 每个分支包含一个 JSON Logic 表达式和满足条件时跳转的目标节点
 */
export interface ConditionBranch {
  /** 分支标签（用于展示和日志） */
  label: string;
  /** JSON Logic 表达式（如 `{ "===": [{ "var": "amount" }, 1000] }`） */
  expression: object;
  /** 满足条件时跳转的节点 ID */
  targetNodeId: string;
}

/**
 * 条件节点 — 审批流中的条件判断节点
 * 按 conditions 数组顺序求值，返回第一个满足条件的分支
 */
export interface ConditionNode {
  /** 节点 ID */
  nodeId: string;
  /** 节点名称 */
  name: string;
  /** 节点类型固定为 condition */
  type: "condition";
  /** 条件分支列表（按顺序求值，最后一个为默认分支） */
  conditions: ConditionBranch[];
  /** 节点顺序（兼容扁平数组格式） */
  order: number;
}

/**
 * 审批节点图 — 完整的审批流图结构
 * 支持条件分支、并行审批、会签等多种模式
 */
export interface ApprovalNodeGraph {
  /** 图中所有节点 */
  nodes: ApprovalGraphNode[];
  /** 图中所有边（连接关系） */
  edges: ApprovalGraphEdge[];
  /** 起始节点 ID */
  startNodeId: string;
}

/**
 * 审批图节点 — 图结构中的节点定义
 * 支持多种节点类型：审批、抄送、条件、起点、终点
 */
export interface ApprovalGraphNode {
  /** 节点 ID */
  nodeId: string;
  /** 节点名称 */
  name: string;
  /** 节点类型 */
  type: "approval" | "cc" | "condition" | "start" | "end";
  /** 审批人角色（approval 节点） */
  approverRole?: string;
  /** 审批人用户 ID（approval 节点） */
  approverUserId?: string;
  /** 审批模式：顺序、并行、会签 */
  mode?: "sequential" | "parallel" | "countersign";
  /** 会签模式下需要通过的最少审批人数 */
  requiredCount?: number;
  /** 抄送人用户 ID 列表（cc 节点） */
  ccUserIds?: string[];
  /** 抄送角色（cc 节点） */
  ccRole?: string;
  /** 条件分支列表（condition 节点） */
  conditions?: ConditionBranch[];
  /** 节点顺序（兼容扁平数组格式） */
  order: number;
}

/**
 * 审批图边 — 图结构中的连接关系
 * conditionLabel 用于标识条件分支的标签
 */
export interface ApprovalGraphEdge {
  /** 源节点 ID */
  fromNodeId: string;
  /** 目标节点 ID */
  toNodeId: string;
  /** 条件标签（条件分支边） */
  conditionLabel?: string;
}

/**
 * 扁平审批节点 — 兼容现有系统的扁平数组格式
 * 现有系统使用 `nodes: ApprovalNode[]` 按 order 顺序连接
 */
export interface FlatApprovalNode {
  /** 审批人角色 */
  approverRole?: string;
  /** 审批人用户 ID */
  approverUserId?: string;
  /** 节点名称 */
  name: string;
  /** 节点顺序 */
  order: number;
  /** 审批模式 */
  mode?: "sequential" | "parallel" | "countersign";
  /** 会签模式下需要通过的最少审批人数 */
  requiredCount?: number;
  /** 节点类型（扩展字段，默认为 approval） */
  type?: "approval" | "cc" | "condition" | "start" | "end";
  /** 节点 ID（扩展字段，扁平格式中可选） */
  nodeId?: string;
  /** 条件分支列表（condition 节点） */
  conditions?: ConditionBranch[];
  /** 抄送人用户 ID 列表 */
  ccUserIds?: string[];
  /** 抄送角色 */
  ccRole?: string;
}

/**
 * 条件缓存 — 条件节点求值结果的映射
 * key: 条件节点 ID, value: 求值后应该跳转到的目标节点 ID
 */
export type ConditionCache = Record<string, string>;

/**
 * 表单数据 — 用于条件求值的上下文数据
 * 通常是审批实例的 content 字段
 */
export type FormData = Record<string, unknown>;

// ─── 核心函数 ───────────────────────────────────────────────

/**
 * 对单个条件节点用 JSON Logic 求值，返回应该跳转到的目标节点 ID
 *
 * 遍历 conditions 数组，用 `jsonLogic.apply(expression, formData)` 求值：
 * - 返回第一个满足条件（求值结果为 truthy）的 targetNodeId
 * - 如果无匹配分支，返回 conditions 数组最后一个 targetNodeId（默认分支）
 * - 如果求值过程中出错，返回默认分支（最后一个 conditions 的 targetNodeId）
 *
 * @param conditionNode - 条件节点，包含多个条件分支
 * @param formData - 表单数据，作为 JSON Logic 求值的上下文
 * @returns 满足条件的分支的 targetNodeId，或默认分支的 targetNodeId
 *
 * @example
 * ```ts
 * const node: ConditionNode = {
 *   nodeId: "cond-1",
 *   name: "金额判断",
 *   type: "condition",
 *   order: 1,
 *   conditions: [
 *     { label: "大于1000", expression: { ">": [{ var: "amount" }, 1000] }, targetNodeId: "manager-approval" },
 *     { label: "默认", expression: true, targetNodeId: "auto-approve" },
 *   ],
 * };
 * const result = evaluateCondition(node, { amount: 500 });
 * // 返回 "auto-approve"（默认分支）
 * ```
 */
export function evaluateCondition(conditionNode: ConditionNode, formData: FormData): string {
  const { conditions } = conditionNode;

  // 无条件分支时返回空字符串（不应发生，但防御性处理）
  if (!conditions || conditions.length === 0) {
    return "";
  }

  // 默认分支 = 最后一个条件的 targetNodeId
  const defaultTargetNodeId = conditions[conditions.length - 1].targetNodeId;

  for (const branch of conditions) {
    try {
      const result = jsonLogic.apply(branch.expression, formData);
      if (result) {
        return branch.targetNodeId;
      }
    } catch {
      // 求值失败时跳过当前分支，继续尝试下一个
      // 最终会落到默认分支
    }
  }

  // 所有分支都不满足，返回默认分支
  return defaultTargetNodeId;
}

/**
 * 对整个审批图的所有条件节点求值，返回 conditionCache
 *
 * 遍历图中所有 type="condition" 的节点，对每个条件节点用 formData 求值，
 * 生成 nodeId → targetNodeId 的映射，用于初始化 conditionCache。
 *
 * @param graph - 审批节点图
 * @param formData - 表单数据
 * @returns 条件缓存映射（nodeId → targetNodeId）
 *
 * @example
 * ```ts
 * const cache = evaluateAllConditions(graph, { amount: 5000 });
 * // cache = { "cond-1": "manager-approval", "cond-2": "ceo-approval" }
 * ```
 */
export function evaluateAllConditions(graph: ApprovalNodeGraph, formData: FormData): ConditionCache {
  const cache: ConditionCache = {};

  for (const node of graph.nodes) {
    if (node.type === "condition" && node.conditions) {
      const conditionNode: ConditionNode = {
        nodeId: node.nodeId,
        name: node.name,
        type: "condition",
        conditions: node.conditions,
        order: node.order,
      };
      cache[node.nodeId] = evaluateCondition(conditionNode, formData);
    }
  }

  return cache;
}

/**
 * 根据条件缓存确定当前激活的审批节点路径
 *
 * 从 startNodeId 开始遍历图：
 * - 遇到 approval/cc 节点 → 加入激活列表
 * - 遇到 condition 节点 → 查 conditionCache 确定分支，沿分支继续遍历
 * - 遇到 end 节点 → 停止遍历
 * - 防止循环引用：已访问的节点不再重复访问
 *
 * @param graph - 审批节点图
 * @param conditionCache - 条件缓存（nodeId → targetNodeId）
 * @returns 当前应该执行的审批节点列表（按遍历顺序）
 *
 * @example
 * ```ts
 * const activeNodes = getActiveNodes(graph, cache);
 * // activeNodes = [{ nodeId: "approval-1", ... }, { nodeId: "approval-2", ... }]
 * ```
 */
export function getActiveNodes(
  graph: ApprovalNodeGraph,
  conditionCache: ConditionCache,
): ApprovalGraphNode[] {
  const activeNodes: ApprovalGraphNode[] = [];
  const visited = new Set<string>();

  // 构建邻接表：fromNodeId → edges[]
  const adjacencyMap = new Map<string, ApprovalGraphEdge[]>();
  for (const edge of graph.edges) {
    const existing = adjacencyMap.get(edge.fromNodeId) ?? [];
    existing.push(edge);
    adjacencyMap.set(edge.fromNodeId, existing);
  }

  // 节点查找表
  const nodeMap = new Map<string, ApprovalGraphNode>();
  for (const node of graph.nodes) {
    nodeMap.set(node.nodeId, node);
  }

  // 从 startNodeId 开始 BFS/DFS 遍历
  const queue: string[] = [graph.startNodeId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;

    // 防止循环引用
    if (visited.has(currentId)) {
      continue;
    }
    visited.add(currentId);

    const currentNode = nodeMap.get(currentId);
    if (!currentNode) {
      continue;
    }

    switch (currentNode.type) {
      case "start":
        // start 节点不入激活列表，继续遍历后继节点
        break;

      case "end":
        // end 节点不入激活列表，停止该路径遍历
        continue;

      case "condition": {
        // condition 节点不入激活列表，查缓存确定分支
        const targetNodeId = conditionCache[currentId];
        if (targetNodeId) {
          queue.push(targetNodeId);
        }
        continue;
      }

      case "approval":
      case "cc":
        // 审批/抄送节点加入激活列表
        activeNodes.push(currentNode);
        break;
    }

    // 继续遍历后继节点（仅 start/approval/cc 类型会到达此处，
    // condition 和 end 类型已在 switch 中 continue）
    const edges = adjacencyMap.get(currentId) ?? [];
    for (const edge of edges) {
      queue.push(edge.toNodeId);
    }
  }

  return activeNodes;
}

/**
 * 将扁平 nodes 数组转换为图结构
 *
 * 兼容两种输入格式：
 * 1. 现有扁平数组格式：`FlatApprovalNode[]`，按 order 顺序连接
 *    - 自动生成 nodeId（如 "node-0", "node-1"）
 *    - 自动生成 start 和 end 节点
 *    - 按 order 顺序建立边连接
 * 2. 新的图结构格式：直接传入 `ApprovalNodeGraph`，原样返回
 *
 * @param nodes - 扁平审批节点数组或图结构
 * @returns 完整的审批节点图
 *
 * @example
 * ```ts
 * // 扁平数组 → 图结构
 * const graph = buildNodeGraph([
 *   { name: "主管审批", order: 0, approverRole: "manager" },
 *   { name: "总监审批", order: 1, approverRole: "director" },
 * ]);
 * ```
 */
export function buildNodeGraph(
  nodes: FlatApprovalNode[] | ApprovalNodeGraph,
): ApprovalNodeGraph {
  // 如果已经是图结构，直接返回
  if (!Array.isArray(nodes) && "nodes" in nodes && "edges" in nodes) {
    return nodes as ApprovalNodeGraph;
  }

  // 扁平数组 → 图结构
  const flatNodes = nodes as FlatApprovalNode[];

  // 按 order 排序
  const sortedNodes = [...flatNodes].sort((a, b) => a.order - b.order);

  // 生成图节点
  const graphNodes: ApprovalGraphNode[] = [];
  const graphEdges: ApprovalGraphEdge[] = [];

  // 起始节点
  const startNodeId = "start";
  graphNodes.push({
    nodeId: startNodeId,
    name: "开始",
    type: "start",
    order: -1,
  });

  // 转换扁平节点为图节点
  for (let i = 0; i < sortedNodes.length; i++) {
    const flatNode = sortedNodes[i];
    const nodeId = flatNode.nodeId ?? `node-${i}`;

    graphNodes.push({
      nodeId,
      name: flatNode.name,
      type: flatNode.type ?? "approval",
      approverRole: flatNode.approverRole,
      approverUserId: flatNode.approverUserId,
      mode: flatNode.mode,
      requiredCount: flatNode.requiredCount,
      ccUserIds: flatNode.ccUserIds,
      ccRole: flatNode.ccRole,
      conditions: flatNode.conditions,
      order: flatNode.order,
    });
  }

  // 终止节点
  const endNodeId = "end";
  graphNodes.push({
    nodeId: endNodeId,
    name: "结束",
    type: "end",
    order: sortedNodes.length,
  });

  // 建立边连接
  // start → 第一个节点
  if (sortedNodes.length > 0) {
    const firstNodeId = sortedNodes[0].nodeId ?? "node-0";
    graphEdges.push({ fromNodeId: startNodeId, toNodeId: firstNodeId });
  } else {
    // 无审批节点时，start 直接连 end
    graphEdges.push({ fromNodeId: startNodeId, toNodeId: endNodeId });
  }

  // 节点之间按顺序连接
  for (let i = 0; i < sortedNodes.length - 1; i++) {
    const fromId = sortedNodes[i].nodeId ?? `node-${i}`;
    const toId = sortedNodes[i + 1].nodeId ?? `node-${i + 1}`;

    // condition 节点的边需要带 conditionLabel
    const fromNode = sortedNodes[i];
    if (fromNode.type === "condition" && fromNode.conditions) {
      for (const branch of fromNode.conditions) {
        graphEdges.push({
          fromNodeId: fromId,
          toNodeId: branch.targetNodeId,
          conditionLabel: branch.label,
        });
      }
    } else {
      graphEdges.push({ fromNodeId: fromId, toNodeId: toId });
    }
  }

  // 最后一个节点 → end
  if (sortedNodes.length > 0) {
    const lastNodeId =
      sortedNodes[sortedNodes.length - 1].nodeId ?? `node-${sortedNodes.length - 1}`;
    // 如果最后一个节点是 condition，其分支已经直接连接到目标节点
    // 否则连接到 end
    if (sortedNodes[sortedNodes.length - 1].type !== "condition") {
      graphEdges.push({ fromNodeId: lastNodeId, toNodeId: endNodeId });
    }
  }

  return {
    nodes: graphNodes,
    edges: graphEdges,
    startNodeId,
  };
}

/**
 * 验证 JSON Logic 表达式是否合法
 *
 * 用 json-logic-js 尝试对一个空对象求值：
 * - 如果表达式结构合法（能被 jsonLogic.apply 解析），返回 true
 * - 如果表达式结构非法（抛出异常），返回 false
 *
 * 注意：此函数只验证表达式结构是否合法，
 * 不验证表达式在特定数据下是否能产生预期结果。
 *
 * @param expression - JSON Logic 表达式对象
 * @returns true 表示表达式合法，false 表示非法
 *
 * @example
 * ```ts
 * validateConditionExpression({ ">": [{ var: "amount" }, 1000] }); // true
 * validateConditionExpression(null); // false
 * ```
 */
export function validateConditionExpression(expression: object): boolean {
  if (expression === null || expression === undefined) {
    return false;
  }

  if (typeof expression !== "object") {
    return false;
  }

  try {
    // 用空对象求值，仅验证表达式结构是否可被解析
    // 求值结果本身不重要，只要不抛异常即可
    jsonLogic.apply(expression, {});
    return true;
  } catch {
    return false;
  }
}