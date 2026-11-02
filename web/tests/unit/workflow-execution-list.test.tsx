// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

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

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: mocks.api }));

import { WorkflowExecutionList } from "@/components/workflow/WorkflowExecutionList";
import type { WorkflowItem } from "@/components/workflow/WorkflowList";

const WORKFLOW: WorkflowItem = {
  id: "wf-1",
  name: "请假审批",
  description: null,
  trigger: { event: "leave.requested" },
  actions: [],
  active: true,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-02T00:00:00.000Z",
};

function makeExec(overrides: Record<string, unknown> = {}) {
  return {
    id: "ex-1",
    workflowId: "wf-1",
    triggerData: { actor: "张三" },
    status: "completed",
    result: { ok: true },
    startedAt: "2026-10-02T08:00:00.000Z",
    completedAt: "2026-10-02T08:05:00.000Z",
    createdAt: "2026-10-02T08:00:00.000Z",
    ...overrides,
  };
}

function renderExecs(items: unknown[] = [makeExec()]) {
  const onClose = vi.fn();
  mocks.api.mockResolvedValue({ items, total: items.length });
  const utils = render(<WorkflowExecutionList wid="ws-1" workflow={WORKFLOW} onClose={onClose} />);
  return { ...utils, onClose };
}

describe("WorkflowExecutionList", () => {
  afterEach(() => {
    cleanup();
    mocks.api.mockReset();
    vi.restoreAllMocks();
  });

  it("挂载时拉取执行历史（GET，URL 含工作流 id）", async () => {
    renderExecs();
    expect(await screen.findByText("workflow:completed")).toBeInTheDocument();
    expect(mocks.api).toHaveBeenCalledTimes(1);
    const [url, opts] = mocks.api.mock.calls[0] as [string, { method?: string }?];
    expect(url).toBe("/api/v1/workspaces/ws-1/workflows/wf-1/executions");
    expect(opts?.method).toBeUndefined();
  });

  it("标题为工作流名称 + executions", async () => {
    renderExecs();
    expect(await screen.findByText(/请假审批/)).toBeInTheDocument();
    expect(screen.getByText(/workflow:executions/)).toBeInTheDocument();
  });

  it("加载中显示 loading 文案", () => {
    mocks.api.mockReset();
    mocks.api.mockImplementationOnce(() => new Promise(() => {}));
    renderExecs();
    expect(screen.getByText("workflow:loading")).toBeInTheDocument();
  });

  it("空列表显示 noExecutions 占位", async () => {
    renderExecs([]);
    expect(await screen.findByText("workflow:noExecutions")).toBeInTheDocument();
  });

  it("拉取失败显示错误消息", async () => {
    mocks.api.mockReset();
    mocks.api.mockRejectedValueOnce(new Error("读取历史失败"));
    renderExecs();
    expect(await screen.findByText("读取历史失败")).toBeInTheDocument();
  });

  it("状态徽标按状态映射文案，未知状态原文回显", async () => {
    renderExecs([
      makeExec({ id: "ex-a", status: "pending" }),
      makeExec({ id: "ex-b", status: "running" }),
      makeExec({ id: "ex-c", status: "completed" }),
      makeExec({ id: "ex-d", status: "failed" }),
      makeExec({ id: "ex-e", status: "paused" }),
    ]);
    await screen.findByText("workflow:pending");
    expect(screen.getByText("workflow:pending")).toBeInTheDocument();
    expect(screen.getByText("workflow:running")).toBeInTheDocument();
    expect(screen.getByText("workflow:completed")).toBeInTheDocument();
    expect(screen.getByText("workflow:failed")).toBeInTheDocument();
    expect(screen.getByText("paused")).toBeInTheDocument();
  });

  it("状态圆点按状态取色，未知状态回退 muted", async () => {
    const { container } = renderExecs([
      makeExec({ id: "ex-a", status: "completed" }),
      makeExec({ id: "ex-b", status: "paused" }),
    ]);
    await screen.findByText("workflow:completed");
    const dots = container.querySelectorAll("li > div > span.rounded-full");
    expect(dots.length).toBe(2);
    expect((dots[0] as HTMLElement).style.background).toBe("var(--success)");
    expect((dots[1] as HTMLElement).style.background).toBe("var(--muted)");
  });

  it("渲染 triggerData JSON 截断与 result 行；result 为 null 时不渲染", async () => {
    renderExecs([makeExec({ id: "ex-a", result: null })]);
    await screen.findByText("workflow:completed");
    expect(screen.getByText(/"actor":"张三"/)).toBeInTheDocument();
    expect(screen.queryByText(/^workflow:result:/)).not.toBeInTheDocument();
    expect(screen.getByText(/^workflow:startedAt:/)).toBeInTheDocument();
    expect(screen.getByText(/^workflow:completedAt:/)).toBeInTheDocument();
  });

  it("startedAt/completedAt 为 null 时相应行不渲染", async () => {
    renderExecs([makeExec({ id: "ex-a", startedAt: null, completedAt: null })]);
    await screen.findByText("workflow:completed");
    expect(screen.queryByText(/^workflow:startedAt:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^workflow:completedAt:/)).not.toBeInTheDocument();
  });

  it("triggerData 超过 100 字符时按 slice 截断", async () => {
    const longPayload = { note: "n".repeat(200) };
    renderExecs([makeExec({ id: "ex-a", triggerData: longPayload })]);
    await screen.findByText("workflow:completed");
    const code = document.querySelector("code") as HTMLElement;
    expect(code.textContent).toBe(JSON.stringify(longPayload).slice(0, 100));
  });

  it("手动触发：POST 空负载，结果插到列表最前", async () => {
    renderExecs([makeExec({ id: "ex-a", status: "completed" })]);
    await screen.findByText("workflow:completed");
    mocks.api.mockResolvedValueOnce(makeExec({ id: "ex-new", status: "running" }));
    fireEvent.click(screen.getByRole("button", { name: /workflow:execute/ }));
    await waitFor(() => expect(screen.getByText("workflow:running")).toBeInTheDocument());
    const calls = mocks.api.mock.calls as [string, { method?: string; body?: string }][];
    const post = calls.find((c) => c[1]?.method === "POST")!;
    expect(post[0]).toBe("/api/v1/workspaces/ws-1/workflows/wf-1/executions");
    expect(JSON.parse(post[1]!.body!)).toEqual({});
    // 新执行在最前
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("workflow:running");
    expect(rows[1]).toHaveTextContent("workflow:completed");
  });

  it("触发失败显示错误且列表不变", async () => {
    renderExecs([makeExec({ id: "ex-a", status: "completed" })]);
    await screen.findByText("workflow:completed");
    mocks.api.mockRejectedValueOnce(new Error("执行被拒绝"));
    fireEvent.click(screen.getByRole("button", { name: /workflow:execute/ }));
    expect(await screen.findByText("执行被拒绝")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").length).toBe(1);
  });

  it("触发进行中按钮禁用，防止重复提交", async () => {
    mocks.api.mockReset();
    mocks.api.mockResolvedValueOnce({ items: [makeExec()], total: 1 });
    let resolvePost!: (v: unknown) => void;
    mocks.api.mockImplementationOnce(() => new Promise((r) => (resolvePost = r)));
    renderExecs();
    await screen.findByText("workflow:completed");
    const btn = screen.getByRole("button", { name: /workflow:execute/ });
    fireEvent.click(btn);
    expect(btn).toBeDisabled();
    resolvePost(makeExec({ id: "ex-new", status: "pending" }));
    await waitFor(() => expect(btn).not.toBeDisabled());
  });

  it("aria 语义：dialog + aria-modal；X 按钮与遮罩点击均关闭", async () => {
    const { onClose, container } = renderExecs();
    await screen.findByText("workflow:completed");
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    fireEvent.click(screen.getByRole("button", { name: "workflow:close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    // 遮罩层=dialog 自身：点击内部子节点不关闭
    fireEvent.click(container.querySelector("li") as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
    // 点击 dialog 自身（target===currentTarget）关闭
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
