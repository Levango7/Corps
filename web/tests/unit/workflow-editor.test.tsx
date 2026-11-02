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

import { WorkflowEditor } from "@/components/workflow/WorkflowEditor";
import type { WorkflowItem } from "@/components/workflow/WorkflowList";

function makeWorkflow(overrides: Partial<WorkflowItem> = {}): WorkflowItem {
  return {
    id: "wf-1",
    name: "请假审批",
    description: "员工请假自动审批",
    trigger: { event: "leave.requested" },
    actions: [{ type: "notify", config: {}, order: 1 }],
    active: false,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
    ...overrides,
  } as WorkflowItem;
}

function renderEditor(overrides: { workflow?: WorkflowItem | null } = {}) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const workflow = overrides.workflow === undefined ? makeWorkflow() : overrides.workflow;
  const utils = render(
    <WorkflowEditor wid="ws-1" workflow={workflow} onClose={onClose} onSaved={onSaved} />,
  );
  return { ...utils, onClose, onSaved };
}

function setField(id: string, value: string) {
  fireEvent.change(screen.getByLabelText(id), { target: { value } });
}

function submitButton() {
  return screen.getByRole("button", { name: /workflow:save/ });
}

describe("WorkflowEditor", () => {
  afterEach(() => {
    cleanup();
    mocks.api.mockReset();
    vi.restoreAllMocks();
  });

  it("新建模式：标题为 create，字段为空白 + 默认 trigger/actions 模板，active 勾选", () => {
    renderEditor({ workflow: null });
    expect(screen.getByRole("heading", { name: "workflow:create" })).toBeInTheDocument();
    expect(screen.getByLabelText("workflow:name")).toHaveValue("");
    expect(screen.getByLabelText("workflow:description")).toHaveValue("");
    expect(screen.getByLabelText("workflow:trigger")).toHaveValue(
      JSON.stringify({ event: "task.created" }, null, 2),
    );
    expect(screen.getByLabelText("workflow:actions")).toHaveValue(
      JSON.stringify([{ type: "notify", config: {}, order: 1 }], null, 2),
    );
    expect(screen.getByLabelText("workflow:active")).toBeChecked();
  });

  it("编辑模式：标题为 edit，字段按既有工作流回填", () => {
    renderEditor();
    expect(screen.getByRole("heading", { name: "workflow:edit" })).toBeInTheDocument();
    expect(screen.getByLabelText("workflow:name")).toHaveValue("请假审批");
    expect(screen.getByLabelText("workflow:description")).toHaveValue("员工请假自动审批");
    expect(screen.getByLabelText("workflow:trigger")).toHaveValue(
      JSON.stringify({ event: "leave.requested" }, null, 2),
    );
    expect(screen.getByLabelText("workflow:actions")).toHaveValue(
      JSON.stringify([{ type: "notify", config: {}, order: 1 }], null, 2),
    );
    expect(screen.getByLabelText("workflow:active")).not.toBeChecked();
  });

  it("aria 语义：dialog + aria-modal + aria-labelledby 指向标题", () => {
    renderEditor();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "workflow-editor-title");
    expect(screen.getByText("workflow:edit")).toBeInTheDocument();
  });

  it("ESC 键关闭弹窗", () => {
    const { onClose } = renderEditor();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("遮罩点击关闭、内容区点击不关闭", () => {
    const { onClose, container } = renderEditor();
    const overlay = container.querySelector('[role="presentation"]') as HTMLElement;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("X 按钮与取消按钮均关闭弹窗", () => {
    const { onClose, rerender } = renderEditor({ workflow: null });
    fireEvent.click(screen.getByRole("button", { name: "workflow:close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    const onClose2 = vi.fn();
    rerender(<WorkflowEditor wid="ws-1" workflow={null} onClose={onClose2} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "workflow:cancel" }));
    expect(onClose2).toHaveBeenCalledTimes(1);
  });

  it("挂载后首个可聚焦元素（关闭钮）自动获得焦点", () => {
    renderEditor({ workflow: null });
    const closeBtn = screen.getByRole("button", { name: "workflow:close" });
    expect(document.activeElement).toBe(closeBtn);
  });

  it("名称为空时提交按钮禁用，不发请求", () => {
    const { onSaved } = renderEditor({ workflow: null });
    expect(submitButton()).toBeDisabled();
    fireEvent.click(submitButton());
    expect(mocks.api).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("trigger 非法 JSON 显示 triggerJsonInvalid 且不发请求", async () => {
    const { onSaved } = renderEditor({ workflow: null });
    setField("workflow:name", "新流程");
    setField("workflow:trigger", "{不是合法 json");
    fireEvent.click(submitButton());
    expect(await screen.findByText("workflow:triggerJsonInvalid")).toBeInTheDocument();
    expect(mocks.api).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("actions 非法 JSON 显示 actionsJsonInvalid 且不发请求", async () => {
    renderEditor({ workflow: null });
    setField("workflow:name", "新流程");
    setField("workflow:actions", "[oops");
    fireEvent.click(submitButton());
    expect(await screen.findByText("workflow:actionsJsonInvalid")).toBeInTheDocument();
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it("actions 不是数组或为空数组均显示 actionsEmpty 且不发请求", async () => {
    renderEditor({ workflow: null });
    setField("workflow:name", "新流程");
    setField("workflow:actions", JSON.stringify({ type: "notify" }));
    fireEvent.click(submitButton());
    expect(await screen.findByText("workflow:actionsEmpty")).toBeInTheDocument();
    expect(mocks.api).not.toHaveBeenCalled();
    setField("workflow:actions", JSON.stringify([]));
    fireEvent.click(submitButton());
    expect(screen.getAllByText("workflow:actionsEmpty").length).toBeGreaterThanOrEqual(1);
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it("新建提交：POST 工作区 URL，负载含 trim 后名称与解析后的 trigger/actions，保存后回调并关闭", async () => {
    const { onSaved, onClose } = renderEditor({ workflow: null });
    setField("workflow:name", "  状态同步  ");
    setField("workflow:description", "  同步备注  ");
    fireEvent.click(submitButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
    const [url, opts] = mocks.api.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe("/api/v1/workspaces/ws-1/workflows");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({
      name: "状态同步",
      description: "同步备注",
      trigger: { event: "task.created" },
      actions: [{ type: "notify", config: {}, order: 1 }],
      active: true,
    });
  });

  it("新建提交且描述为空时负载 description 为 undefined", async () => {
    const { onSaved } = renderEditor({ workflow: null });
    setField("workflow:name", "无描述流程");
    fireEvent.click(submitButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [, opts] = mocks.api.mock.calls[0] as [string, { method: string; body: string }];
    expect(JSON.parse(opts.body).description).toBeUndefined();
  });

  it("编辑提交：PATCH 工作流 URL，负载使用原 id 与原 active 状态", async () => {
    const { onSaved } = renderEditor();
    setField("workflow:name", "请假审批 v2");
    fireEvent.click(submitButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [url, opts] = mocks.api.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe("/api/v1/workspaces/ws-1/workflows/wf-1");
    expect(opts.method).toBe("PATCH");
    expect(JSON.parse(opts.body)).toEqual({
      name: "请假审批 v2",
      description: "员工请假自动审批",
      trigger: { event: "leave.requested" },
      actions: [{ type: "notify", config: {}, order: 1 }],
      active: false,
    });
  });

  it("保存失败时显示错误消息，弹窗不关闭且 onSaved 不触发", async () => {
    mocks.api.mockRejectedValueOnce(new Error("名称重复"));
    const { onSaved, onClose } = renderEditor({ workflow: null });
    setField("workflow:name", "重名流程");
    fireEvent.click(submitButton());
    expect(await screen.findByText("名称重复")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "workflow:create" })).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // 错误后可再次提交（submitting 已复位）
    expect(submitButton()).not.toBeDisabled();
  });

  it("提交中按钮禁用并显示加载图标", async () => {
    let resolveSave!: (v: unknown) => void;
    mocks.api.mockImplementationOnce(() => new Promise((r) => (resolveSave = r)));
    renderEditor({ workflow: null });
    setField("workflow:name", "延迟流程");
    fireEvent.click(submitButton());
    await waitFor(() => expect(submitButton()).toBeDisabled());
    resolveSave({});
    await waitFor(() => expect(submitButton()).not.toBeDisabled());
  });
});
