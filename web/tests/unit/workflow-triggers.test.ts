// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * 工作流事件触发器契约（lib/workflow/triggers.ts）：
 *  - 匹配：只触发 active=true 且 trigger.event === eventName 的工作流
 *    （trigger 是 JSON 字段 → 代码层过滤；非对象 trigger 一律不匹配）
 *  - 触发形态：每个匹配工作流先建 execution（status=pending，triggerData=payload）再同步执行
 *  - **单工作流失败不影响其他工作流**；整链失败只记日志**不向调用方抛**
 *    （业务调用方 .catch(()=>{}) 之外还要求本函数自身不抛）
 *  - 全部经 runWithWorkspace（workflows/workflow_execution 是 FORCE RLS 表，
 *    裸查询在加固模式下静默读空 → 事件链路整条失效，2026-10-09 收编）
 */
const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  create: vi.fn(),
  executeWorkflow: vi.fn(),
  logInfo: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  runWithWorkspace: vi.fn(async (_wid: string, fn: (tx: unknown) => unknown) =>
    fn({ workflow: { findMany: h.findMany }, workflowExecution: { create: h.create } }),
  ),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: h.logInfo, error: h.logError, warn: vi.fn() },
}));

vi.mock("@/lib/workflow/executor", () => ({
  executeWorkflow: h.executeWorkflow,
}));

import { emitWorkflowEvent } from "@/lib/workflow/triggers";

beforeEach(() => {
  h.findMany.mockReset();
  h.create.mockReset();
  h.executeWorkflow.mockReset();
  h.logInfo.mockReset();
  h.logError.mockReset();
  h.executeWorkflow.mockResolvedValue(undefined);
});

describe("匹配与触发", () => {
  it("只触发 active 且 trigger.event 匹配的工作流；每匹配一个建 execution 并同步执行", async () => {
    h.findMany.mockResolvedValue([
      { id: "wf1", name: "on-create", trigger: { event: "task.created" } },
      { id: "wf2", name: "on-update", trigger: { event: "task.updated" } },
      { id: "wf3", name: "no-event", trigger: { type: "schedule" } },
      { id: "wf4", name: "bad-trigger", trigger: "not-an-object" },
      { id: "wf5", name: "null-trigger", trigger: null },
    ]);
    h.create.mockResolvedValue({ id: "exec-1" });

    await emitWorkflowEvent("w1", "task.created", { taskId: "t1" });

    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.create).toHaveBeenCalledWith({
      data: {
        workflowId: "wf1",
        workspaceId: "w1",
        triggerData: { taskId: "t1" },
        status: "pending",
      },
      select: { id: true },
    });
    expect(h.executeWorkflow).toHaveBeenCalledWith("w1", "wf1", "exec-1", { taskId: "t1" });
    // 查询条件：本工作区 + active=true
    expect(h.findMany).toHaveBeenCalledWith({
      where: { workspaceId: "w1", active: true },
      select: { id: true, name: true, trigger: true },
    });
  });

  it("无匹配：静默返回，不建执行、不记日志（高频路径免噪声）", async () => {
    h.findMany.mockResolvedValue([{ id: "wf", name: "n", trigger: { event: "other" } }]);
    await emitWorkflowEvent("w1", "task.created", {});
    expect(h.create).not.toHaveBeenCalled();
    expect(h.logInfo).not.toHaveBeenCalled();
    expect(h.logError).not.toHaveBeenCalled();
  });

  it("多匹配：串行逐个执行（顺序与查询一致）", async () => {
    h.findMany.mockResolvedValue([
      { id: "wfA", name: "A", trigger: { event: "e" } },
      { id: "wfB", name: "B", trigger: { event: "e" } },
    ]);
    h.create.mockResolvedValueOnce({ id: "x1" }).mockResolvedValueOnce({ id: "x2" });
    const order: string[] = [];
    h.executeWorkflow.mockImplementation(async () => {
      order.push("run");
    });
    await emitWorkflowEvent("w1", "e", {});
    expect(h.executeWorkflow.mock.calls.map((c) => c[2])).toEqual(["x1", "x2"]);
    expect(order).toEqual(["run", "run"]);
  });
});

describe("容错边界", () => {
  it("单个工作流失败（建执行或执行抛错）：记 error、继续下一个，整体不抛", async () => {
    h.findMany.mockResolvedValue([
      { id: "wf1", name: "A", trigger: { event: "e" } },
      { id: "wf2", name: "B", trigger: { event: "e" } },
    ]);
    h.create.mockRejectedValueOnce(new Error("create boom")).mockResolvedValueOnce({ id: "x2" });
    await expect(emitWorkflowEvent("w1", "e", {})).resolves.toBeUndefined();
    expect(h.logError).toHaveBeenCalledWith(
      "[workflow:trigger] single workflow trigger failed",
      expect.objectContaining({ workflowId: "wf1", error: "create boom" }),
    );
    expect(h.executeWorkflow).toHaveBeenCalledTimes(1); // 只跑了 wf2
    expect(h.executeWorkflow).toHaveBeenCalledWith("w1", "wf2", "x2", {});
  });

  it("executeWorkflow 抛错同样被单条 try-catch 兜住", async () => {
    h.findMany.mockResolvedValue([{ id: "wf1", name: "A", trigger: { event: "e" } }]);
    h.create.mockResolvedValue({ id: "x1" });
    h.executeWorkflow.mockRejectedValue(new Error("exec boom"));
    await expect(emitWorkflowEvent("w1", "e", {})).resolves.toBeUndefined();
    expect(h.logError).toHaveBeenCalledWith(
      "[workflow:trigger] single workflow trigger failed",
      expect.objectContaining({ error: "exec boom" }),
    );
  });

  it("查询整体失败：记 error 且不向调用方抛（业务操作不应被触发器拖垮）", async () => {
    h.findMany.mockRejectedValue(new Error("db down"));
    await expect(emitWorkflowEvent("w1", "e", {})).resolves.toBeUndefined();
    expect(h.logError).toHaveBeenCalledWith(
      "[workflow:trigger] emitWorkflowEvent failed",
      expect.objectContaining({ workspaceId: "w1", eventName: "e", error: "db down" }),
    );
  });
});
