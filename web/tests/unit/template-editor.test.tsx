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
  return { api: vi.fn(), ApiErrorClass: ApiError };
});
vi.mock("@/lib/api", () => ({ api: mocks.api, ApiError: mocks.ApiErrorClass, apiList: vi.fn() }));

import { TemplateEditor } from "@/components/template/TemplateEditor";

const BASE = "/api/v1/workspaces/ws-1/project-templates";

const template = {
  id: "tp-1",
  name: "Sprint kickoff",
  description: "Standard sprint",
  category: "agile",
  templateData: {
    tasks: [
      { title: "Plan", description: "write plan", priority: "high" },
      { title: "Retro", priority: "urgent" },
      { title: "Ship" },
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

function renderEditor(overrides: Partial<Parameters<typeof TemplateEditor>[0]> = {}) {
  const props = {
    wid: "ws-1",
    template: null,
    open: true,
    onClose: vi.fn(),
    onSaved: vi.fn(),
    ...overrides,
  };
  const utils = render(<TemplateEditor {...props} />);
  return { ...utils, ...props };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TemplateEditor", () => {
  it("open=false 时不渲染对话框", () => {
    mocks.api.mockImplementation(async () => ({}));
    renderEditor({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("新建模式：默认一条空任务、名称为空且提交按钮禁用", () => {
    mocks.api.mockImplementation(async () => ({}));
    renderEditor();
    expect(screen.getByLabelText("projectTemplate:name")).toHaveValue("");
    expect(screen.getByLabelText("projectTemplate:taskTitle 1")).toHaveValue("");
    expect(screen.getByRole("button", { name: "projectTemplate:create" })).toBeDisabled();
  });

  it("新建提交：POST 载荷含 trim 后的字段与空 labels/milestones", async () => {
    mocks.api.mockImplementation(async () => ({}));
    const { onSaved, onClose } = renderEditor();

    fireEvent.change(screen.getByLabelText("projectTemplate:name"), {
      target: { value: "  New tpl  " },
    });
    fireEvent.change(screen.getByLabelText("projectTemplate:description"), {
      target: { value: "  desc  " },
    });
    fireEvent.change(screen.getByLabelText("projectTemplate:category"), {
      target: { value: "  ops  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "projectTemplate:private" }));
    fireEvent.change(screen.getByLabelText("projectTemplate:taskTitle 1"), {
      target: { value: "  First  " },
    });
    fireEvent.change(screen.getByLabelText("projectTemplate:taskDescription 1"), {
      target: { value: "  detail  " },
    });

    const row = screen.getByLabelText("projectTemplate:taskTitle 1").closest("li") as HTMLElement;
    const priority = within(row).getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(priority, { target: { value: "urgent" } });

    fireEvent.click(screen.getByRole("button", { name: "projectTemplate:create" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
    const posts = mocks.api.mock.calls.filter(([, o]) => o?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0][0]).toBe(BASE);
    expect(bodyOf(posts[0])).toEqual({
      name: "New tpl",
      description: "desc",
      category: "ops",
      isPublic: true,
      templateData: {
        tasks: [{ title: "First", description: "detail", priority: "urgent" }],
        labels: [],
        milestones: [],
      },
    });
  });

  it("空标题任务被过滤；全空时报 needAtLeastOneTask 且不发请求", async () => {
    mocks.api.mockImplementation(async () => ({}));
    const { onSaved } = renderEditor();

    fireEvent.change(screen.getByLabelText("projectTemplate:name"), { target: { value: "T" } });
    fireEvent.click(screen.getByText("projectTemplate:addTask"));
    fireEvent.change(screen.getByLabelText("projectTemplate:taskTitle 2"), {
      target: { value: "Keep me" },
    });
    fireEvent.click(screen.getByRole("button", { name: "projectTemplate:create" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const post = mocks.api.mock.calls.find(([, o]) => o?.method === "POST");
    const tasks = (bodyOf(post ?? []).templateData as { tasks: { title: string }[] }).tasks;
    expect(tasks.map((tk) => tk.title)).toEqual(["Keep me"]);

    // 再把唯一有标题的那条任务清空 → 拦截（第 1 条本来就是空标题，是第 2 条带标题）
    mocks.api.mockClear();
    fireEvent.change(screen.getByLabelText("projectTemplate:taskTitle 2"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "projectTemplate:create" }));
    await waitFor(() =>
      expect(screen.getByText("projectTemplate:needAtLeastOneTask")).toBeInTheDocument(),
    );
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it("编辑模式：预填名称/描述/分类/公开与任务优先级默认值", () => {
    mocks.api.mockImplementation(async () => ({}));
    renderEditor({ template: template as never });

    expect(screen.getByLabelText("projectTemplate:name")).toHaveValue("Sprint kickoff");
    expect(screen.getByLabelText("projectTemplate:description")).toHaveValue("Standard sprint");
    expect(screen.getByLabelText("projectTemplate:category")).toHaveValue("agile");
    expect(screen.getByRole("button", { name: "projectTemplate:public" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("projectTemplate:taskTitle 3")).toHaveValue("Ship");
    const third = screen.getByLabelText("projectTemplate:taskTitle 3").closest("li") as HTMLElement;
    // 缺失 priority 回退 medium
    expect((within(third).getByRole("combobox") as HTMLSelectElement).value).toBe("medium");
  });

  it("编辑提交：PATCH 到模板子路径", async () => {
    mocks.api.mockImplementation(async () => ({}));
    const { onSaved, onClose } = renderEditor({ template: template as never });

    fireEvent.change(screen.getByLabelText("projectTemplate:name"), {
      target: { value: "Renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "projectTemplate:save" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const patch = mocks.api.mock.calls.find(([, o]) => o?.method === "PATCH");
    expect(patch?.[0]).toBe(`${BASE}/tp-1`);
    expect(bodyOf(patch ?? []).name).toBe("Renamed");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("任务增删与上下移动（边界禁用）", () => {
    mocks.api.mockImplementation(async () => ({}));
    renderEditor();

    expect(screen.getAllByLabelText("projectTemplate:moveUp")[0]).toBeDisabled();
    expect(screen.getAllByLabelText("projectTemplate:moveDown")).toHaveLength(1);

    fireEvent.click(screen.getByText("projectTemplate:addTask"));
    fireEvent.click(screen.getByText("projectTemplate:addTask"));
    expect(screen.getAllByLabelText("projectTemplate:removeTask")).toHaveLength(3);

    fireEvent.change(screen.getByLabelText("projectTemplate:taskTitle 1"), {
      target: { value: "A" },
    });
    fireEvent.change(screen.getByLabelText("projectTemplate:taskTitle 2"), {
      target: { value: "B" },
    });
    fireEvent.change(screen.getByLabelText("projectTemplate:taskTitle 3"), {
      target: { value: "C" },
    });

    // 首行可下移、末行可上移，中间两向都可
    fireEvent.click(screen.getAllByLabelText("projectTemplate:moveDown")[0]);
    expect(screen.getByLabelText("projectTemplate:taskTitle 1")).toHaveValue("B");
    expect(screen.getByLabelText("projectTemplate:taskTitle 2")).toHaveValue("A");

    fireEvent.click(screen.getAllByLabelText("projectTemplate:moveUp")[2]);
    expect(screen.getByLabelText("projectTemplate:taskTitle 2")).toHaveValue("C");

    // 顺序此时为 [B, C, A]，删掉中间一行 → [B, A]
    fireEvent.click(screen.getAllByLabelText("projectTemplate:removeTask")[1]);
    expect(screen.getAllByLabelText("projectTemplate:removeTask")).toHaveLength(2);
    expect(screen.getByLabelText("projectTemplate:taskTitle 1")).toHaveValue("B");
    expect(screen.getByLabelText("projectTemplate:taskTitle 2")).toHaveValue("A");
    expect(screen.queryByLabelText("projectTemplate:taskTitle 3")).not.toBeInTheDocument();
  });

  it("删除到零任务时提示 noTasks", () => {
    mocks.api.mockImplementation(async () => ({}));
    renderEditor();
    fireEvent.click(screen.getByLabelText("projectTemplate:removeTask"));
    expect(screen.getByText("projectTemplate:noTasks")).toBeInTheDocument();
  });

  it("提交失败：错误横幅显示、对话框仍开、按钮恢复", async () => {
    mocks.api.mockImplementation(async () => {
      throw new Error("save-boom");
    });
    const { onSaved, onClose } = renderEditor();
    fireEvent.change(screen.getByLabelText("projectTemplate:name"), { target: { value: "T" } });
    fireEvent.change(screen.getByLabelText("projectTemplate:taskTitle 1"), {
      target: { value: "Task" },
    });
    fireEvent.click(screen.getByRole("button", { name: "projectTemplate:create" }));

    await waitFor(() => expect(screen.getByText("save-boom")).toBeInTheDocument());
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "projectTemplate:create" })).toBeEnabled();
  });

  it("错误横幅可关闭", async () => {
    mocks.api.mockImplementation(async () => {
      throw new Error("save-boom");
    });
    const { container } = renderEditor();
    fireEvent.change(screen.getByLabelText("projectTemplate:name"), { target: { value: "T" } });
    fireEvent.change(screen.getByLabelText("projectTemplate:taskTitle 1"), {
      target: { value: "Task" },
    });
    fireEvent.click(screen.getByRole("button", { name: "projectTemplate:create" }));
    await waitFor(() => expect(screen.getByText("save-boom")).toBeInTheDocument());

    const dismiss = within(container).getAllByLabelText("button:close");
    fireEvent.click(dismiss[dismiss.length - 1]);
    expect(screen.queryByText("save-boom")).not.toBeInTheDocument();
  });

  it("Esc 与遮罩点击关闭，内容区点击不关闭", () => {
    mocks.api.mockImplementation(async () => ({}));
    const { onClose, container } = renderEditor();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);

    const overlay = container.querySelector('[role="presentation"]') as HTMLElement;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("头部关闭按钮回调 onClose", () => {
    mocks.api.mockImplementation(async () => ({}));
    const { onClose } = renderEditor();
    fireEvent.click(screen.getByLabelText("button:close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
