// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  evaluateCondition,
  evaluateAllConditions,
  getActiveNodes,
  buildNodeGraph,
  validateConditionExpression,
} from "@/lib/approval/condition-engine";
import type {
  ConditionNode,
  ApprovalNodeGraph,
  FlatApprovalNode,
} from "@/lib/approval/condition-engine";

/**
 * 条件审批引擎（lib/approval/condition-engine.ts）契约。
 *
 * 引擎职责：JSON Logic 条件求值 + 图遍历定活跃路径 + 扁平↔图结构互转。
 * 契约重点是健壮性：求值失败落默认分支不崩溃、图遍历防循环引用、
 * 非法表达式被 validateConditionExpression 拒绝（而不是运行时炸）。
 */

const amountNode: ConditionNode = {
  nodeId: "cond-1",
  name: "金额判断",
  type: "condition",
  order: 2,
  conditions: [
    { label: "大于1000", expression: { ">": [{ var: "amount" }, 1000] }, targetNodeId: "manager" },
    { label: "默认", expression: true, targetNodeId: "auto" },
  ],
};

describe("evaluateCondition", () => {
  it("返回第一个 truthy 分支的 targetNodeId", () => {
    expect(evaluateCondition(amountNode, { amount: 5000 })).toBe("manager");
  });

  it("无分支命中 → 默认分支（最后一个 targetNodeId）", () => {
    expect(evaluateCondition(amountNode, { amount: 500 })).toBe("auto");
  });

  it("多分支按顺序求值：第一个不满足、第二个满足 → 取第二个", () => {
    const node: ConditionNode = {
      ...amountNode,
      conditions: [
        { label: "大于1000", expression: { ">": [{ var: "amount" }, 1000] }, targetNodeId: "a" },
        { label: "大于500", expression: { ">": [{ var: "amount" }, 500] }, targetNodeId: "b" },
        { label: "默认", expression: true, targetNodeId: "c" },
      ],
    };
    expect(evaluateCondition(node, { amount: 700 })).toBe("b");
  });

  it("表达式求值抛异常 → 跳过该分支继续，最终落默认分支", () => {
    const node: ConditionNode = {
      ...amountNode,
      conditions: [
        { label: "坏表达式", expression: { "!!!": "not-json-logic" } as never, targetNodeId: "bad" },
        { label: "默认", expression: true, targetNodeId: "auto" },
      ],
    };
    expect(evaluateCondition(node, {})).toBe("auto");
  });

  it("无条件分支 → 空字符串（防御性，不应发生但不崩）", () => {
    expect(evaluateCondition({ ...amountNode, conditions: [] }, {})).toBe("");
    expect(evaluateCondition({ ...amountNode, conditions: undefined as never }, {})).toBe("");
  });

  it("表单数据缺失字段 → 该分支不满足（不抛错，落默认）", () => {
    expect(evaluateCondition(amountNode, {})).toBe("auto");
  });
});

describe("evaluateAllConditions", () => {
  const graph: ApprovalNodeGraph = {
    nodes: [
      { nodeId: "start", name: "开始", type: "start", order: -1 },
      { nodeId: "cond-1", name: "金额", type: "condition", order: 1, conditions: amountNode.conditions },
      { nodeId: "cond-2", name: "类型", type: "condition", order: 2, conditions: [
        { label: "采购", expression: { "==": [{ var: "type" }, "purchase"] }, targetNodeId: "t-purchase" },
        { label: "默认", expression: true, targetNodeId: "t-other" },
      ] },
      { nodeId: "manager", name: "主管", type: "approval", order: 3 },
    ],
    edges: [],
    startNodeId: "start",
  };

  it("只求值 condition 节点，产出 nodeId → targetNodeId 映射", () => {
    const cache = evaluateAllConditions(graph, { amount: 5000, type: "leave" });
    expect(cache).toEqual({ "cond-1": "manager", "cond-2": "t-other" });
  });

  it("各条件节点独立求值（一个图可同时含金额与类型分流）", () => {
    const cache = evaluateAllConditions(graph, { amount: 100, type: "purchase" });
    expect(cache["cond-1"]).toBe("auto");
    expect(cache["cond-2"]).toBe("t-purchase");
  });

  it("无 condition 节点 → 空缓存对象", () => {
    const noCond = { ...graph, nodes: graph.nodes.filter((n) => n.type !== "condition") };
    expect(evaluateAllConditions(noCond, {})).toEqual({});
  });

  it("condition 节点缺 conditions 字段 → 不进缓存（不抛错）", () => {
    const broken = {
      ...graph,
      nodes: [
        ...graph.nodes.filter((n) => n.type !== "condition"),
        { nodeId: "cond-x", name: "x", type: "condition", order: 9 },
      ],
    };
    expect(evaluateAllConditions(broken, {})).toEqual({});
  });
});

describe("getActiveNodes", () => {
  function linearGraph(): ApprovalNodeGraph {
    return {
      nodes: [
        { nodeId: "start", name: "开始", type: "start", order: -1 },
        { nodeId: "a1", name: "主管", type: "approval", order: 1 },
        { nodeId: "cond", name: "金额", type: "condition", order: 2, conditions: amountNode.conditions },
        { nodeId: "big", name: "总监", type: "approval", order: 3 },
        { nodeId: "small", name: "自动通过", type: "approval", order: 4 },
        { nodeId: "cc1", name: "抄送财务", type: "cc", order: 5, ccUserIds: ["u-fin"] },
        { nodeId: "end", name: "结束", type: "end", order: 99 },
      ],
      edges: [
        { fromNodeId: "start", toNodeId: "a1" },
        { fromNodeId: "a1", toNodeId: "cond" },
        { fromNodeId: "cond", toNodeId: "big", conditionLabel: "大于1000" },
        { fromNodeId: "cond", toNodeId: "small", conditionLabel: "默认" },
        { fromNodeId: "big", toNodeId: "cc1" },
        { fromNodeId: "small", toNodeId: "end" },
        { fromNodeId: "cc1", toNodeId: "end" },
      ],
      startNodeId: "start",
    };
  }

  it("start/condition/end 不入激活列表；approval/cc 入列", () => {
    const active = getActiveNodes(linearGraph(), { cond: "big" });
    expect(active.map((n) => n.nodeId)).toEqual(["a1", "big", "cc1"]);
  });

  it("按 conditionCache 的分支选择路径（默认分支走 small → end，不含后续Approval）", () => {
    const active = getActiveNodes(linearGraph(), { cond: "small" });
    expect(active.map((n) => n.nodeId)).toEqual(["a1", "small"]);
  });

  it("cache 缺条件节点的条目 → 该节点不再继续遍历（不因缓存缺失而走错分支）", () => {
    const active = getActiveNodes(linearGraph(), {});
    expect(active.map((n) => n.nodeId)).toEqual(["a1"]);
  });

  it("循环引用不陷入死循环（visited 防护）", () => {
    const cyclic: ApprovalNodeGraph = {
      nodes: [
        { nodeId: "start", name: "s", type: "start", order: -1 },
        { nodeId: "a", name: "A", type: "approval", order: 1 },
        { nodeId: "end", name: "e", type: "end", order: 99 },
      ],
      edges: [
        { fromNodeId: "start", toNodeId: "a" },
        { fromNodeId: "a", toNodeId: "a" }, // 自环
        { fromNodeId: "a", toNodeId: "end" },
      ],
      startNodeId: "start",
    };
    const active = getActiveNodes(cyclic, {});
    expect(active.map((n) => n.nodeId)).toEqual(["a"]);
  });

  it("边指向不存在的节点 → 跳过不抛错", () => {
    const g = linearGraph();
    g.edges.push({ fromNodeId: "a1", toNodeId: "ghost" });
    expect(() => getActiveNodes(g, { cond: "big" })).not.toThrow();
  });

  it("cc 节点同样进入激活列表（抄送需要执行）", () => {
    const active = getActiveNodes(linearGraph(), { cond: "big" });
    expect(active.some((n) => n.type === "cc")).toBe(true);
  });
});

describe("buildNodeGraph", () => {
  it("直传图结构 → 原样返回（不做二次加工）", () => {
    const graph: ApprovalNodeGraph = {
      nodes: [{ nodeId: "x", name: "X", type: "approval", order: 0 }],
      edges: [],
      startNodeId: "x",
    };
    expect(buildNodeGraph(graph)).toBe(graph);
  });

  it("扁平数组 → 自动补 start/end 节点并按 order 连边", () => {
    const flat: FlatApprovalNode[] = [
      { name: "主管", order: 1, approverRole: "manager" },
      { name: "总监", order: 0, approverRole: "director" },
    ];
    const g = buildNodeGraph(flat);
    const ids = g.nodes.map((n) => n.nodeId);
    expect(ids).toEqual(["start", "node-0", "node-1", "end"]);
    expect(g.startNodeId).toBe("start");
    const froms = g.edges.map((e) => e.fromNodeId);
    expect(froms).toContain("start");
    expect(froms).toContain("node-0");
    // 按 order 排序：order 0 的在前（node-0 = 总监）
    expect(g.nodes[1].name).toBe("总监");
    expect(g.nodes[2].name).toBe("主管");
  });

  it("显式 nodeId 保留（不覆盖为 node-N）", () => {
    const g = buildNodeGraph([{ name: "主管", order: 0, nodeId: "custom-1" }]);
    expect(g.nodes.some((n) => n.nodeId === "custom-1")).toBe(true);
  });

  it("扁平节点字段透传：approverRole/mode/ccUserIds/requiredCount", () => {
    const g = buildNodeGraph([
      { name: "会签", order: 0, mode: "countersign", requiredCount: 2, approverUserId: "u-1" },
      { name: "抄送", order: 1, type: "cc", ccUserIds: ["u-2"], ccRole: "fin" },
    ]);
    const countersign = g.nodes.find((n) => n.name === "会签");
    expect(countersign).toMatchObject({ mode: "countersign", requiredCount: 2, approverUserId: "u-1" });
    const cc = g.nodes.find((n) => n.name === "抄送");
    expect(cc).toMatchObject({ type: "cc", ccUserIds: ["u-2"], ccRole: "fin" });
  });

  it("无 type 时默认 approval", () => {
    const g = buildNodeGraph([{ name: "审批", order: 0 }]);
    expect(g.nodes[1].type).toBe("approval");
  });

  it("空数组 → start 直连 end（空流程不报错）", () => {
    const g = buildNodeGraph([]);
    expect(g.nodes.map((n) => n.nodeId)).toEqual(["start", "end"]);
    expect(g.edges).toEqual([{ fromNodeId: "start", toNodeId: "end" }]);
  });

  it("condition 节点 → 每个分支一条带 conditionLabel 的边（不再按顺序连下一节点）", () => {
    const g = buildNodeGraph([
      { name: "金额", order: 0, type: "condition", conditions: [
        { label: "大", expression: true, targetNodeId: "big" },
        { label: "小", expression: true, targetNodeId: "small" },
      ] },
      { name: "主管", order: 1 },
    ]);
    const condEdges = g.edges.filter((e) => e.fromNodeId === "node-0");
    expect(condEdges).toEqual([
      { fromNodeId: "node-0", toNodeId: "big", conditionLabel: "大" },
      { fromNodeId: "node-0", toNodeId: "small", conditionLabel: "小" },
    ]);
  });

  it("中间的 condition 节点：分支边取代顺序边（不再连 node-N+1），其后节点继续连 end", () => {
    const g = buildNodeGraph([
      { name: "主管", order: 0 },
      { name: "金额", order: 1, type: "condition", conditions: [
        { label: "大", expression: true, targetNodeId: "node-2" },
        { label: "小", expression: true, targetNodeId: "end" },
      ] },
      { name: "总监", order: 2 },
    ]);
    expect(g.edges).toEqual([
      { fromNodeId: "start", toNodeId: "node-0" },
      { fromNodeId: "node-0", toNodeId: "node-1" },
      { fromNodeId: "node-1", toNodeId: "node-2", conditionLabel: "大" },
      { fromNodeId: "node-1", toNodeId: "end", conditionLabel: "小" },
      { fromNodeId: "node-2", toNodeId: "end" },
    ]);
  });

  it("端到端：扁平带条件 → 图 → 条件求值 → 活跃节点", () => {
    const g = buildNodeGraph([
      { name: "主管", order: 0 },
      { name: "金额", order: 1, type: "condition", conditions: [
        { label: "大于1000", expression: { ">": [{ var: "amount" }, 1000] }, targetNodeId: "node-2" },
        { label: "默认", expression: true, targetNodeId: "end" },
      ] },
      { name: "总监", order: 2 },
    ]);
    const cache = evaluateAllConditions(g, { amount: 5000 });
    const active = getActiveNodes(g, cache);
    expect(active.map((n) => n.name)).toEqual(["主管", "总监"]);
  });

  it("端到端：小额走默认分支 → 只剩主管", () => {
    const g = buildNodeGraph([
      { name: "主管", order: 0 },
      { name: "金额", order: 1, type: "condition", conditions: [
        { label: "大于1000", expression: { ">": [{ var: "amount" }, 1000] }, targetNodeId: "node-2" },
        { label: "默认", expression: true, targetNodeId: "end" },
      ] },
      { name: "总监", order: 2 },
    ]);
    const active = getActiveNodes(g, evaluateAllConditions(g, { amount: 100 }));
    expect(active.map((n) => n.name)).toEqual(["主管"]);
  });
});

describe("validateConditionExpression", () => {
  it("合法 JSON Logic 表达式 → true", () => {
    expect(validateConditionExpression({ ">": [{ var: "amount" }, 1000] })).toBe(true);
    expect(validateConditionExpression({ "==": [{ var: "type" }, "purchase"] })).toBe(true);
    expect(validateConditionExpression({ "!": [{ var: "flag" }] })).toBe(true);
    expect(validateConditionExpression({ and: [{ var: "a" }, { var: "b" }] })).toBe(true);
  });

  it("null / undefined / 非对象 → false", () => {
    expect(validateConditionExpression(null)).toBe(false);
    expect(validateConditionExpression(undefined as never)).toBe(false);
    expect(validateConditionExpression("amount > 1000" as never)).toBe(false);
    expect(validateConditionExpression(42 as never)).toBe(false);
  });

  it("结构非法（无法求值）→ false", () => {
    expect(validateConditionExpression({ "!!!": "bogus" } as never)).toBe(false);
  });

  it("只验结构不验语义：对空数据求值不抛异常即合法", () => {
    // 表达式引用了不存在的字段，apply 返回 undefined/null 而非抛错 → 合法
    expect(validateConditionExpression({ var: "nonexistent.deep.path" })).toBe(true);
  });
});
