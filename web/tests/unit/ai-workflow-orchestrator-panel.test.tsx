// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";

/**
 * WorkflowOrchestratorPanel 契约（components/ai/WorkflowOrchestratorPanel.tsx）：
 *  1. props {wid}；自然语言描述必填（空时生成 disabled + noDescription 提示），空态 emptyWorkflow
 *  2. 生成 → POST /api/v1/ai/workflow-orchestrator {wid, description(trim)}；generating 中
 *     按钮 disabled（重复点击只发一次请求）
 *  3. 成功渲染：trigger event/conditions chips、节点（nodeTypeLabel 类型标签 + 名称 + id +
 *     config JSON 超 80 字符截断加省略号 + 计数 (N)）、edges（from/to 节点名 + 可选 label chip）、
 *     explanation；无 conditions → noConditions，无 edges → noEdges
 *  4. 失败：ApiError → e.message；其他 → t("generateFailed")；错误条 aria-label="close" 可 dismiss
 *  5. 确认执行：setTimeout 300ms 后 confirmed=true + toast success confirmed，
 *     按钮文案 confirm → confirmed 且 disabled（重复点击不重复 toast）
 */

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("next-intl", () => {
  const cache = new Map<string, (key: string, vars?: Record<string, unknown>) => string>();
  const useTranslations = (ns: string) => {
    let fn = cache.get(ns);
    if (!fn) {
      const created = (key: string, vars?: Record<string, unknown>) =>
        vars ? `${ns}:${key}:${JSON.stringify(vars)}` : `${ns}:${key}`;
      cache.set(ns, created);
      fn = created;
    }
    return fn;
  };
  return { useTranslations };
});
vi.mock("@/lib/api", () => ({
  api: mocks.api,
  ApiError: class ApiError extends Error {},
}));
vi.mock("@/components/Toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

import WorkflowOrchestratorPanel from "@/components/ai/WorkflowOrchestratorPanel";
import { ApiError } from "@/lib/api";

const WID = "ws-wop-1";
const NS = "ai.workflowOrchestrator";
const DESC = "  新任务创建后自动拆解并通知负责人  ";

const LONG_CONFIG = { data: "y".repeat(100) };

const WORKFLOW = {
  trigger: { event: "task.created", conditions: ["priority=high", "assignee IS NULL"] },
  nodes: [
    { id: "node-1", type: "action", name: "创建子任务", config: { title: "x" } },
    { id: "node-2", type: "condition", name: "是否紧急", config: {} },
    { id: "node-3", type: "approval", name: "主管审批", config: LONG_CONFIG },
  ],
  edges: [
    { from: "node-1", to: "node-2", label: "通过" },
    { from: "node-2", to: "node-3" },
  ],
  explanation: "先创建任务再判断是否需要审批",
};

function renderPanel() {
  return render(<WorkflowOrchestratorPanel wid={WID} />);
}

function descArea() {
  return screen.getByLabelText(`${NS}:descriptionLabel`) as HTMLTextAreaElement;
}
function generateButton() {
  return screen.getByText(`${NS}:generate`).closest("button") as HTMLButtonElement;
}
/** 完成一次生成（点击生成按钮并等待节点区渲染） */
async function generated() {
  fireEvent.click(generateButton());
  await waitFor(() => expect(screen.getByText(`${NS}:nodes`)).toBeInTheDocument());
}

beforeEach(() => {
  mocks.api.mockReset();
  mocks.toast.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("WorkflowOrchestratorPanel", () => {
  it("初始骨架：aria-label 标题容器、textarea、生成 disabled + noDescription 提示、空态 emptyWorkflow", () => {
    renderPanel();
    expect(screen.getByLabelText(`${NS}:title`)).toBeInTheDocument();
    expect(screen.getByText(`${NS}:title`)).toBeInTheDocument();
    expect(descArea()).toBeInTheDocument();
    expect(generateButton()).toBeDisabled();
    expect(screen.getByText(`${NS}:noDescription`)).toBeInTheDocument();
    expect(screen.getByText(`${NS}:emptyWorkflow`)).toBeInTheDocument();

    // 输入后 noDescription 消失、按钮可用
    fireEvent.change(descArea(), { target: { value: "x" } });
    expect(screen.queryByText(`${NS}:noDescription`)).toBeFalsy();
    expect(generateButton()).toBeEnabled();
  });

  it("生成请求：POST /api/v1/ai/workflow-orchestrator body {wid, description(trim)}；generating 态", async () => {
    let resolveApi!: (v: unknown) => void;
    mocks.api.mockReturnValueOnce(
      new Promise((res) => {
        resolveApi = res;
      }),
    );
    renderPanel();
    fireEvent.change(descArea(), { target: { value: DESC } });
    fireEvent.click(generateButton());

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    expect(mocks.api).toHaveBeenCalledWith("/api/v1/ai/workflow-orchestrator", {
      method: "POST",
      body: JSON.stringify({ wid: WID, description: DESC.trim() }),
    });
    // generating 中按钮 disabled，重复点击不重发请求（generating 文案同时在按钮与加载块出现）
    const genBtn = screen
      .getAllByText(`${NS}:generating`)
      .map((el) => el.closest("button"))
      .find((b): b is HTMLButtonElement => b !== null)!;
    expect(genBtn).toBeDisabled();
    fireEvent.click(genBtn);
    expect(mocks.api).toHaveBeenCalledTimes(1);

    resolveApi(WORKFLOW);
    await waitFor(() => expect(screen.getByText("node-1")).toBeInTheDocument());
  });

  it("成功渲染：trigger event/conditions chips、节点类型标签/名称/id/config、edges（含 label）、explanation、计数", async () => {
    mocks.api.mockResolvedValueOnce(WORKFLOW);
    renderPanel();
    fireEvent.change(descArea(), { target: { value: DESC } });
    await generated();

    expect(screen.getByText(`${NS}:trigger`)).toBeInTheDocument();
    expect(screen.getByText(WORKFLOW.trigger.event)).toBeInTheDocument();
    expect(screen.getByText("priority=high")).toBeInTheDocument();
    expect(screen.getByText("assignee IS NULL")).toBeInTheDocument();

    // 节点：计数 (3)、类型标签、id code
    expect(screen.getByText("(3)")).toBeInTheDocument();
    expect(screen.getByText(`${NS}:nodeTypeAction`)).toBeInTheDocument();
    expect(screen.getByText(`${NS}:nodeTypeCondition`)).toBeInTheDocument();
    expect(screen.getByText(`${NS}:nodeTypeApproval`)).toBeInTheDocument();
    expect(screen.getByText("node-1")).toBeInTheDocument();
    expect(screen.getByText("node-3")).toBeInTheDocument();
    // 空 config 不渲染 config 段；有 config 的节点渲染 "config: {json}"
    expect(screen.getByText(`${NS}:config: ${JSON.stringify({ title: "x" })}`)).toBeInTheDocument();
    expect(screen.queryByText(`${NS}:config: ${JSON.stringify(LONG_CONFIG)}`)).toBeFalsy();

    // edges：from/to 用节点名渲染，label chip 单独渲染（节点名在节点列表与 edges 中重复出现）
    expect(screen.getByText(`${NS}:edges`)).toBeInTheDocument();
    const edgeRow = screen.getByText("通过").closest("div")!;
    expect(edgeRow.textContent).toContain("创建子任务");
    expect(edgeRow.textContent).toContain("是否紧急");
    expect(screen.getAllByText("创建子任务").length).toBeGreaterThanOrEqual(2);

    expect(screen.getByText(`${NS}:explanation`)).toBeInTheDocument();
    expect(screen.getByText(WORKFLOW.explanation)).toBeInTheDocument();
    expect(screen.getByText(`${NS}:confirm`)).toBeInTheDocument();
  });

  it("空 conditions 与空 edges → noConditions / noEdges", async () => {
    mocks.api.mockResolvedValueOnce({
      trigger: { event: "manual", conditions: [] },
      nodes: [{ id: "n1", type: "action", name: "唯一节点", config: {} }],
      edges: [],
      explanation: "单节点",
    });
    renderPanel();
    fireEvent.change(descArea(), { target: { value: DESC } });
    await generated();

    expect(screen.getByText(`${NS}:noConditions`)).toBeInTheDocument();
    expect(screen.getByText(`${NS}:noEdges`)).toBeInTheDocument();
    expect(screen.getByText("(1)")).toBeInTheDocument();
  });

  it("config JSON 超 80 字符截断并追加省略号", async () => {
    mocks.api.mockResolvedValueOnce(WORKFLOW);
    renderPanel();
    fireEvent.change(descArea(), { target: { value: DESC } });
    await generated();

    const expected = `${NS}:config: ${JSON.stringify(LONG_CONFIG).slice(0, 80)}…`;
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("生成失败：普通 Error → generateFailed；ApiError → e.message；close dismiss 清除", async () => {
    renderPanel();
    fireEvent.change(descArea(), { target: { value: DESC } });

    mocks.api.mockRejectedValueOnce(new Error("boom"));
    fireEvent.click(generateButton());
    await waitFor(() => expect(screen.getByText(`${NS}:generateFailed`)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("close"));
    expect(screen.queryByText(`${NS}:generateFailed`)).toBeFalsy();

    mocks.api.mockRejectedValueOnce(new ApiError("配额不足", 429, 1001));
    fireEvent.click(generateButton());
    await waitFor(() => expect(screen.getByText("配额不足")).toBeInTheDocument());
    expect(screen.queryByText(`${NS}:generateFailed`)).toBeFalsy();
  });

  it("edges 引用未知节点 id 时回退显示原始 id", async () => {
    mocks.api.mockResolvedValueOnce({
      trigger: { event: "manual", conditions: [] },
      nodes: [{ id: "n1", type: "action", name: "已知节点", config: {} }],
      edges: [{ from: "ghost-node", to: "n1" }],
      explanation: "",
    });
    renderPanel();
    fireEvent.change(descArea(), { target: { value: DESC } });
    await generated();

    expect(screen.getByText("ghost-node")).toBeInTheDocument();
  });

  it("二次生成：新结果覆盖旧渲染，旧节点消失、按钮恢复 generate 文案", async () => {
    mocks.api.mockResolvedValueOnce(WORKFLOW).mockResolvedValueOnce({
      trigger: { event: "manual", conditions: [] },
      nodes: [{ id: "node-9", type: "loop", name: "循环体", config: {} }],
      edges: [],
      explanation: "第二次结果",
    });
    renderPanel();
    fireEvent.change(descArea(), { target: { value: DESC } });
    await generated();
    expect(screen.getByText("node-1")).toBeInTheDocument();

    fireEvent.click(generateButton());
    await waitFor(() => expect(screen.getByText("node-9")).toBeInTheDocument());
    expect(screen.queryByText("node-1")).toBeFalsy();
    expect(screen.queryByText("node-3")).toBeFalsy();
    expect(screen.getByText("第二次结果")).toBeInTheDocument();
    expect(generateButton()).toBeEnabled();
  });

  it("确认执行：300ms 后 confirmed + toast success，按钮变 confirmed 且 disabled", async () => {
    mocks.api.mockResolvedValueOnce(WORKFLOW);
    renderPanel();
    fireEvent.change(descArea(), { target: { value: DESC } });
    await generated();

    vi.useFakeTimers();
    try {
      const btn = screen.getByText(`${NS}:confirm`).closest("button")!;
      expect(btn).toBeEnabled();
      fireEvent.click(btn);
      // 300ms 未到：仍是 confirm 文案、无 toast
      expect(screen.queryByText(`${NS}:confirmed`)).toBeFalsy();
      expect(mocks.toast).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(300);
      });
      expect(mocks.toast).toHaveBeenCalledTimes(1);
      expect(mocks.toast).toHaveBeenCalledWith("success", `${NS}:confirmed`);
      const doneBtn = screen.getByText(`${NS}:confirmed`).closest("button")!;
      expect(doneBtn).toBeDisabled();
      // 确认后再点击不重复 toast
      fireEvent.click(doneBtn);
      expect(mocks.toast).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
