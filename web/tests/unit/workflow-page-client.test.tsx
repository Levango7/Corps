// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

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

import { WorkflowPageClient } from "@/components/workflow/WorkflowPageClient";

const WORKFLOW = {
  id: "wf-1",
  name: "请假审批",
  description: "员工请假自动审批",
  trigger: { event: "leave.requested" },
  actions: [{ type: "notify", config: {}, order: 1 }],
  active: true,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-02T00:00:00.000Z",
};

function renderPage(wid = "ws-1") {
  mocks.api.mockReset();
  mocks.api.mockImplementation((url: string) => {
    if (url.includes("/executions")) {
      return Promise.resolve({ items: [], total: 0 });
    }
    return Promise.resolve({ items: [WORKFLOW], total: 1 });
  });
  return render(<WorkflowPageClient wid={wid} />);
}

function apiCalls() {
  return mocks.api.mock.calls as [string, { method?: string; body?: string }?][];
}

function listGets() {
  return apiCalls().filter((c) => c[0].endsWith("/workflows") && !c[1]?.method);
}

describe("WorkflowPageClient", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("组合渲染工作流列表（标题与新建钮）", async () => {
    renderPage();
    expect(await screen.findByText("请假审批")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "workflow:create" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("wid 透传到列表 URL", async () => {
    renderPage("ws-9");
    await screen.findByText("请假审批");
    expect(listGets()[0][0]).toBe("/api/v1/workspaces/ws-9/workflows");
  });

  it("点击新建打开编辑弹窗（create 模式），ESC 关闭后弹窗消失", async () => {
    renderPage();
    await screen.findByText("请假审批");
    fireEvent.click(screen.getByRole("button", { name: "workflow:create" }));
    expect(await screen.findByRole("heading", { name: "workflow:create" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "workflow:create" })).not.toBeInTheDocument(),
    );
  });

  it("从列表编辑既有工作流：弹窗为 edit 模式且回填名称", async () => {
    renderPage();
    await screen.findByText("请假审批");
    fireEvent.click(screen.getAllByRole("button", { name: "workflow:edit" }).at(-1)!);
    expect(await screen.findByRole("heading", { name: "workflow:edit" })).toBeInTheDocument();
    expect(screen.getByLabelText("workflow:name")).toHaveValue("请假审批");
  });

  it("编辑弹窗保存：POST → 列表恰刷新一次（GET 计数 2）且弹窗关闭", async () => {
    renderPage();
    await screen.findByText("请假审批");
    fireEvent.click(screen.getByRole("button", { name: "workflow:create" }));
    await screen.findByRole("heading", { name: "workflow:create" });
    fireEvent.change(screen.getByLabelText("workflow:name"), { target: { value: "新流程" } });
    fireEvent.click(screen.getByRole("button", { name: /workflow:save/ }));
    // 编辑器关闭
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "workflow:create" })).not.toBeInTheDocument(),
    );
    // 保存发起 POST，且 refreshKey +1 触发列表再次 GET
    expect(apiCalls().filter((c) => c[1]?.method === "POST")).toHaveLength(1);
    await waitFor(() => expect(listGets()).toHaveLength(2));
    const post = apiCalls().find((c) => c[1]?.method === "POST")!;
    expect(JSON.parse(post[1]!.body!)).toEqual({
      name: "新流程",
      description: undefined,
      trigger: { event: "task.created" },
      actions: [{ type: "notify", config: {}, order: 1 }],
      active: true,
    });
  });

  it("点击执行历史打开执行列表弹窗（GET 执行 URL、标题含工作流名）", async () => {
    renderPage();
    await screen.findByText("请假审批");
    fireEvent.click(screen.getAllByRole("button", { name: "workflow:executions" }).at(-1)!);
    expect(await screen.findByRole("heading", { name: /workflow:executions/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /请假审批/ })).toBeInTheDocument();
    expect(apiCalls().filter((c) => c[0].includes("/executions") && !c[1]?.method)).toHaveLength(1);
    expect(apiCalls().filter((c) => c[0].includes("/executions") && !c[1]?.method)[0][0]).toBe(
      "/api/v1/workspaces/ws-1/workflows/wf-1/executions",
    );
  });

  it("执行历史 X 按钮关闭后弹窗消失", async () => {
    renderPage();
    await screen.findByText("请假审批");
    fireEvent.click(screen.getAllByRole("button", { name: "workflow:executions" }).at(-1)!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "workflow:close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("执行历史的遮罩点击关闭弹窗", async () => {
    renderPage();
    await screen.findByText("请假审批");
    fireEvent.click(screen.getAllByRole("button", { name: "workflow:executions" }).at(-1)!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(dialog);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("编辑弹窗与执行历史可同时打开，互不影响", async () => {
    renderPage();
    await screen.findByText("请假审批");
    fireEvent.click(screen.getByRole("button", { name: "workflow:create" }));
    await screen.findByRole("heading", { name: "workflow:create" });
    fireEvent.click(screen.getAllByRole("button", { name: "workflow:executions" }).at(-1)!);
    expect(screen.getByRole("heading", { name: "workflow:create" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /workflow:executions/ })).toBeInTheDocument();
    // 两个 role=dialog/容器同时存在（编辑器外层为 presentation、内层 dialog）
    expect(screen.getAllByRole("dialog").length).toBeGreaterThanOrEqual(2);
    // 关闭编辑器后执行历史仍在
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "workflow:create" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("heading", { name: /workflow:executions/ })).toBeInTheDocument();
  });
});
