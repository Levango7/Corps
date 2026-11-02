// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

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

import { WorkflowList, type WorkflowItem } from "@/components/workflow/WorkflowList";

function makeWorkflow(overrides: Partial<WorkflowItem> = {}): WorkflowItem {
  return {
    id: "wf-1",
    name: "请假审批",
    description: "员工请假自动审批",
    trigger: { event: "leave.requested" },
    actions: [{ type: "notify", config: {}, order: 1 }],
    active: true,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-02T03:04:05.000Z",
    ...overrides,
  } as WorkflowItem;
}

function renderList(
  overrides: { items?: WorkflowItem[]; refreshKey?: number } = {},
  handlers: {
    onCreate?: () => void;
    onEdit?: (wf: WorkflowItem) => void;
    onShowExecutions?: (wf: WorkflowItem) => void;
  } = {},
) {
  const onCreate = handlers.onCreate ?? vi.fn();
  const onEdit = handlers.onEdit ?? vi.fn();
  const onShowExecutions = handlers.onShowExecutions ?? vi.fn();
  const items = overrides.items ?? [makeWorkflow()];
  mocks.api.mockResolvedValue({ items, total: items.length });
  const utils = render(
    <WorkflowList
      wid="ws-1"
      onCreate={onCreate}
      onEdit={onEdit}
      onShowExecutions={onShowExecutions}
      refreshKey={overrides.refreshKey ?? 0}
    />,
  );
  return { ...utils, onCreate, onEdit, onShowExecutions, items };
}

describe("WorkflowList", () => {
  afterEach(() => {
    cleanup();
    mocks.api.mockReset();
    vi.restoreAllMocks();
  });

  it("挂载时按工作区 URL 拉取工作流列表（GET、无 body）", async () => {
    renderList();
    await screen.findByText("请假审批");
    expect(mocks.api).toHaveBeenCalledTimes(1);
    const [url, opts] = mocks.api.mock.calls[0] as [string, { method?: string }?];
    expect(url).toBe("/api/v1/workspaces/ws-1/workflows");
    expect(opts?.method).toBeUndefined();
  });

  it("加载中显示 loading 文案", () => {
    mocks.api.mockImplementationOnce(() => new Promise(() => {}));
    renderList();
    expect(screen.getByText("workflow:loading")).toBeInTheDocument();
  });

  it("加载完成后渲染名称/描述/状态徽标/触发器摘要/更新时间", async () => {
    renderList();
    await screen.findByText("请假审批");
    expect(screen.getByText("员工请假自动审批")).toBeInTheDocument();
    expect(screen.getByText("workflow:active")).toBeInTheDocument();
    expect(screen.getByText(/leave\.requested/)).toBeInTheDocument();
    expect(
      screen.getByText(new Date("2026-10-02T03:04:05.000Z").toLocaleString()),
    ).toBeInTheDocument();
  });

  it("description 为 null 时不渲染描述行；trigger 无 event 字段时摘要为占位符", async () => {
    renderList({
      items: [
        makeWorkflow({
          id: "wf-2",
          name: "手动触发",
          description: null,
          trigger: { kind: "manual" },
        }),
      ],
    });
    await screen.findByText("手动触发");
    expect(screen.queryByText("员工请假自动审批")).not.toBeInTheDocument();
    expect(screen.getByText(/workflow:trigger: —/)).toBeInTheDocument();
  });

  it("空列表显示 noWorkflows 占位", async () => {
    renderList({ items: [] });
    expect(await screen.findByText("workflow:noWorkflows")).toBeInTheDocument();
  });

  it("拉取失败时显示错误消息且不渲染列表", async () => {
    mocks.api.mockReset();
    mocks.api.mockRejectedValueOnce(new Error("网关超时"));
    renderList();
    expect(await screen.findByText("网关超时")).toBeInTheDocument();
    // 失败时 items 保持空数组 → 渲染空态占位，而非任何条目名称
    expect(screen.getByText("workflow:noWorkflows")).toBeInTheDocument();
    expect(screen.queryByText("请假审批")).not.toBeInTheDocument();
  });

  it("refreshKey 递增触发重新拉取", async () => {
    const { rerender } = renderList();
    await screen.findByText("请假审批");
    expect(mocks.api).toHaveBeenCalledTimes(1);
    rerender(
      <WorkflowList
        wid="ws-1"
        onCreate={vi.fn()}
        onEdit={vi.fn()}
        onShowExecutions={vi.fn()}
        refreshKey={1}
      />,
    );
    await screen.findByText("请假审批");
    expect(mocks.api).toHaveBeenCalledTimes(2);
  });

  it("点击新建按钮调用 onCreate", async () => {
    const { onCreate } = renderList();
    await screen.findByText("请假审批");
    fireEvent.click(screen.getByRole("button", { name: "workflow:create" }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("启用→禁用：发送 PATCH {active:false} 且徽标翻转为 inactive", async () => {
    renderList();
    await screen.findByText("请假审批");
    fireEvent.click(screen.getByRole("button", { name: "workflow:disable" }));
    await screen.findByText("workflow:inactive");
    const patch = mocks.api.mock.calls.find(
      (c) => (c[1] as { method?: string })?.method === "PATCH",
    ) as [string, { method: string; body: string }];
    expect(patch[0]).toBe("/api/v1/workspaces/ws-1/workflows/wf-1");
    expect(JSON.parse(patch[1].body)).toEqual({ active: false });
    expect(screen.getByText("workflow:enable")).toBeInTheDocument();
  });

  it("禁用→启用：发送 PATCH {active:true}", async () => {
    renderList({ items: [makeWorkflow({ active: false })] });
    await screen.findByText("请假审批");
    fireEvent.click(screen.getByRole("button", { name: "workflow:enable" }));
    await screen.findByText("workflow:active");
    const patch = mocks.api.mock.calls.find(
      (c) => (c[1] as { method?: string })?.method === "PATCH",
    ) as [string, { method: string; body: string }];
    expect(JSON.parse(patch[1].body)).toEqual({ active: true });
  });

  it("toggle 进行中按钮禁用，防止重复提交", async () => {
    mocks.api.mockReset();
    mocks.api.mockResolvedValueOnce({ items: [makeWorkflow()], total: 1 });
    let resolvePatch!: (v: { items: WorkflowItem[] }) => void;
    mocks.api.mockImplementationOnce(() => new Promise((r) => (resolvePatch = r)));
    renderList();
    await screen.findByText("请假审批");
    const toggle = screen.getByRole("button", { name: "workflow:disable" });
    fireEvent.click(toggle);
    // PATCH 挂起期间按钮禁用（第二个调用尚未发生）
    expect(toggle).toBeDisabled();
    resolvePatch({ items: [] });
    await screen.findByText("workflow:inactive");
  });

  it("toggle 失败时显示错误且条目状态不变", async () => {
    mocks.api.mockReset();
    mocks.api.mockResolvedValueOnce({ items: [makeWorkflow()], total: 1 });
    mocks.api.mockRejectedValueOnce(new Error("冲突"));
    renderList();
    await screen.findByText("请假审批");
    fireEvent.click(screen.getByRole("button", { name: "workflow:disable" }));
    expect(await screen.findByText("冲突")).toBeInTheDocument();
    expect(screen.getByText("workflow:active")).toBeInTheDocument();
  });

  it("删除确认通过后发送 DELETE 且条目从列表消失", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderList({
      items: [makeWorkflow(), makeWorkflow({ id: "wf-2", name: "报销流转" })],
    });
    await screen.findByText("请假审批");
    fireEvent.click(screen.getAllByRole("button", { name: "workflow:delete" })[0]);
    await screen.findByText("报销流转");
    const del = mocks.api.mock.calls.find(
      (c) => (c[1] as { method?: string })?.method === "DELETE",
    ) as [string, { method: string }];
    expect(del[0]).toBe("/api/v1/workspaces/ws-1/workflows/wf-1");
    expect(screen.queryByText("请假审批")).not.toBeInTheDocument();
    expect(screen.getByText("报销流转")).toBeInTheDocument();
  });

  it("删除被 confirm 拦截时无 DELETE 且条目保留", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderList();
    await screen.findByText("请假审批");
    fireEvent.click(screen.getAllByRole("button", { name: "workflow:delete" })[0]);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(mocks.api).toHaveBeenCalledTimes(1); // 仅初始 GET
    expect(screen.getByText("请假审批")).toBeInTheDocument();
  });

  it("删除失败时显示错误且条目保留", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.api.mockReset();
    mocks.api.mockResolvedValueOnce({ items: [makeWorkflow()], total: 1 });
    mocks.api.mockRejectedValueOnce(new Error("删除被拒"));
    renderList();
    await screen.findByText("请假审批");
    fireEvent.click(screen.getAllByRole("button", { name: "workflow:delete" })[0]);
    expect(await screen.findByText("删除被拒")).toBeInTheDocument();
    expect(screen.getByText("请假审批")).toBeInTheDocument();
  });

  it("手机端菜单展开后可执行编辑/执行历史/删除", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { onEdit, onShowExecutions } = renderList();
    await screen.findByText("请假审批");
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    const menuEdit = screen.getAllByRole("button", { name: "workflow:edit" })[0];
    fireEvent.click(menuEdit);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "wf-1" }));
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getAllByRole("button", { name: "workflow:executions" })[0]);
    expect(onShowExecutions).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getAllByRole("button", { name: "workflow:delete" })[0]);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    await screen.findByText("workflow:noWorkflows");
  });

  it("手机端菜单的遮罩点击收起菜单", async () => {
    renderList();
    await screen.findByText("请假审批");
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    // 展开时移动端菜单 + 桌面端各一个编辑钮
    expect(screen.getAllByRole("button", { name: "workflow:edit" }).length).toBe(2);
    const overlay = document.querySelector(".fixed.inset-0") as HTMLElement;
    fireEvent.click(overlay);
    // 收起后只剩桌面端编辑钮
    expect(screen.getAllByRole("button", { name: "workflow:edit" }).length).toBe(1);
  });

  it("桌面端按钮直接调用 onEdit / onShowExecutions", async () => {
    const { onEdit, onShowExecutions } = renderList();
    await screen.findByText("请假审批");
    // md+ 按钮在 DOM 顺序上排在移动端菜单之后
    fireEvent.click(screen.getAllByRole("button", { name: "workflow:edit" }).at(-1)!);
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "wf-1" }));
    fireEvent.click(screen.getAllByRole("button", { name: "workflow:executions" }).at(-1)!);
    expect(onShowExecutions).toHaveBeenCalledWith(expect.objectContaining({ id: "wf-1" }));
  });
});
