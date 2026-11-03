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

const mocks = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(
      message: string,
      public status = 0,
      public code = 0,
    ) {
      super(message);
      this.name = "ApiError";
    }
  }
  return { api: vi.fn(), apiList: vi.fn(), ApiErrorClass: ApiError };
});
vi.mock("@/lib/api", () => ({
  api: mocks.api,
  apiList: mocks.apiList,
  ApiError: mocks.ApiErrorClass,
}));

import { TemplateApplyDialog } from "@/components/template/TemplateApplyDialog";

const APPLY_BASE = "/api/v1/workspaces/ws-1/project-templates";

const members = [
  { id: "u-1", name: "Alice", email: "alice@example.com" },
  { id: "u-2", name: null, email: "bob@example.com" },
];

const milestones = [
  { id: "m-1", name: "Kickoff", dueDate: "2026-12-01T00:00:00Z" },
  { id: "m-2", name: "Freeze", dueDate: null },
];

const template = {
  id: "tp-1",
  name: "Sprint kickoff",
  description: "Standard sprint",
  category: "agile",
  templateData: {
    tasks: [
      { title: "Plan", description: "write plan", priority: "high" },
      { title: "Ship", priority: "urgent" },
    ],
  },
  isPublic: true,
  createdBy: "u-1",
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-02T00:00:00Z",
  creator: null,
};

function bodyOf(call: unknown[]): Record<string, unknown> {
  return JSON.parse((call[1] as { body: string }).body);
}

function renderDialog(overrides: Partial<Parameters<typeof TemplateApplyDialog>[0]> = {}) {
  const props = {
    wid: "ws-1",
    template: template as never,
    open: true,
    onClose: vi.fn(),
    onApplied: vi.fn(),
    ...overrides,
  };
  const utils = render(<TemplateApplyDialog {...props} />);
  return { ...utils, ...props };
}

function defaultApi() {
  mocks.apiList.mockImplementation(async () => members);
  mocks.api.mockImplementation(async (path: string, opts?: RequestInit) => {
    if (opts?.method === "POST") return { count: 3, taskIds: ["t-1", "t-2", "t-3"] };
    if (path.endsWith("/milestones")) return milestones;
    return {};
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TemplateApplyDialog", () => {
  it("open=false 或 template=null 时不渲染", () => {
    defaultApi();
    renderDialog({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    cleanup();
    renderDialog({ template: null });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("打开时拉成员与里程碑，下拉含占位与格式化选项", async () => {
    defaultApi();
    renderDialog();
    await waitFor(() =>
      expect(mocks.apiList).toHaveBeenCalledWith("/api/v1/workspaces/ws-1/members"),
    );

    expect(screen.getByText("Sprint kickoff")).toBeInTheDocument();
    expect(screen.getByText("projectTemplate:name")).toBeInTheDocument();

    const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
    // 顺序：里程碑、负责人
    const milestoneLabels = Array.from(selects[0].options).map((o) => o.textContent);
    expect(milestoneLabels[0]).toBe("milestone:filterUnassigned");
    expect(milestoneLabels[1]).toBe(
      `Kickoff (${new Date("2026-12-01T00:00:00Z").toLocaleDateString()})`,
    );
    expect(milestoneLabels[2]).toBe("Freeze");

    const assigneeLabels = Array.from(selects[1].options).map((o) => o.textContent);
    expect(assigneeLabels).toEqual(["projectTemplate:unassigned", "Alice", "bob@example.com"]);
  });

  it("任务预览渲染标题与优先级标签", async () => {
    defaultApi();
    renderDialog();
    await waitFor(() => expect(screen.getByText("Plan")).toBeInTheDocument());
    expect(screen.getByText("Ship")).toBeInTheDocument();
    expect(screen.getByText("priority:high")).toBeInTheDocument();
    expect(screen.getByText("priority:urgent")).toBeInTheDocument();
    expect(screen.getByText("projectTemplate:applyPreview")).toBeInTheDocument();
  });

  it("模板无任务：空态文案且应用按钮禁用", async () => {
    defaultApi();
    renderDialog({
      template: { ...template, templateData: {} } as never,
    });
    await waitFor(() => expect(screen.getByText("projectTemplate:noTasks")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "projectTemplate:apply" })).toBeDisabled();
  });

  it("应用：POST 载荷带上所选里程碑与负责人，成功后显示数量并回调", async () => {
    defaultApi();
    const { onApplied } = renderDialog();
    await waitFor(() => expect(screen.getByText("Plan")).toBeInTheDocument());

    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "m-1" } });
    fireEvent.change(selects[1], { target: { value: "u-2" } });
    fireEvent.click(screen.getByRole("button", { name: "projectTemplate:apply" }));

    await waitFor(() => expect(onApplied).toHaveBeenCalledWith(3));
    const post = mocks.api.mock.calls.find(([, o]) => o?.method === "POST");
    expect(post?.[0]).toBe(`${APPLY_BASE}/tp-1/apply`);
    expect(bodyOf(post ?? [])).toEqual({ milestoneId: "m-1", assigneeId: "u-2" });

    expect(screen.getByText('projectTemplate:applySuccess:{"count":3}')).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "projectTemplate:apply" })).not.toBeInTheDocument();
    // 成功后底栏按钮文案由 cancel 切到 close：与头部 X 同名 ⇒ 共存 2 个
    expect(screen.queryByRole("button", { name: "button:cancel" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "button:close" })).toHaveLength(2);
  });

  it("未选里程碑与负责人时：milestoneId 为 null、assigneeId 省略", async () => {
    defaultApi();
    renderDialog();
    await waitFor(() => expect(screen.getByText("Plan")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "projectTemplate:apply" }));
    await waitFor(() =>
      expect(mocks.api.mock.calls.filter(([, o]) => o?.method === "POST")).toHaveLength(1),
    );
    const post = mocks.api.mock.calls.find(([, o]) => o?.method === "POST");
    expect(bodyOf(post ?? [])).toEqual({ milestoneId: null });
  });

  it("应用失败：错误横幅可关闭、按钮恢复、不回调", async () => {
    mocks.apiList.mockImplementation(async () => members);
    mocks.api.mockImplementation(async (path: string, opts?: RequestInit) => {
      if (opts?.method === "POST") throw new Error("apply-boom");
      if (path.endsWith("/milestones")) return milestones;
      return {};
    });
    const { onApplied } = renderDialog();
    await waitFor(() => expect(screen.getByText("Plan")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "projectTemplate:apply" }));
    await waitFor(() => expect(screen.getByText("apply-boom")).toBeInTheDocument());
    expect(onApplied).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "projectTemplate:apply" })).toBeEnabled();

    const dialog = screen.getByRole("dialog");
    const dismiss = within(dialog).getAllByLabelText("button:close");
    fireEvent.click(dismiss[dismiss.length - 1]);
    expect(screen.queryByText("apply-boom")).not.toBeInTheDocument();
  });

  it("非 Error 抛出回退 applyFailed 文案", async () => {
    mocks.apiList.mockImplementation(async () => members);
    mocks.api.mockImplementation(async (path: string, opts?: RequestInit) => {
      if (opts?.method === "POST") throw "nope";
      if (path.endsWith("/milestones")) return milestones;
      return {};
    });
    renderDialog();
    await waitFor(() => expect(screen.getByText("Plan")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "projectTemplate:apply" }));
    await waitFor(() =>
      expect(screen.getByText("projectTemplate:applyFailed")).toBeInTheDocument(),
    );
  });

  it("成员与里程碑拉取失败时静默：下拉只剩占位项", async () => {
    mocks.apiList.mockImplementation(async () => {
      throw new Error("members down");
    });
    mocks.api.mockImplementation(async () => {
      throw new Error("milestones down");
    });
    renderDialog();
    await waitFor(() => expect(screen.getByText("Plan")).toBeInTheDocument());

    const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
    expect(selects[0].options).toHaveLength(1);
    expect(selects[1].options).toHaveLength(1);
  });

  it("Esc 关闭；只认遮罩自身点击，内部元素冒泡不关闭", async () => {
    defaultApi();
    const { onClose } = renderDialog();
    await waitFor(() => expect(screen.getByText("Plan")).toBeInTheDocument());

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    // 该组件的遮罩层自身即 role="dialog"：点内部元素（target !== currentTarget）不关闭
    const overlay = screen.getByRole("dialog");
    fireEvent.click(screen.getByText("Sprint kickoff"));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("关闭按钮与取消按钮都回调 onClose（成功态按钮文案切换）", async () => {
    defaultApi();
    const { onClose } = renderDialog();
    await waitFor(() => expect(screen.getByText("Plan")).toBeInTheDocument());

    expect(screen.getByRole("button", { name: "button:cancel" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "button:cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText("button:close"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("重新打开会重置上一次的成功态与选择", async () => {
    defaultApi();
    const { onApplied, rerender } = renderDialog();
    await waitFor(() => expect(screen.getByText("Plan")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "projectTemplate:apply" }));
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: "projectTemplate:apply" })).not.toBeInTheDocument();

    rerender(
      <TemplateApplyDialog
        wid="ws-1"
        template={template as never}
        open={false}
        onClose={vi.fn()}
        onApplied={onApplied}
      />,
    );
    rerender(
      <TemplateApplyDialog
        wid="ws-1"
        template={template as never}
        open
        onClose={vi.fn()}
        onApplied={onApplied}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "projectTemplate:apply" })).toBeInTheDocument(),
    );
    expect(screen.queryByText(/projectTemplate:applySuccess/)).not.toBeInTheDocument();
  });
});
