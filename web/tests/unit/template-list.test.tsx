// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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

import { TemplateList } from "@/components/template/TemplateList";

const LIST_BASE = "/api/v1/workspaces/ws-1/project-templates";

/** jsdom 未实现 matchMedia（EmptyState 走 framer-motion + 减弱动效偏好） */
const mqMock = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
beforeAll(() => {
  vi.stubGlobal("matchMedia", (_query: string) => mqMock as unknown as MediaQueryList);
});

const items = [
  {
    id: "tp-1",
    name: "Sprint kickoff",
    description: "Standard sprint",
    category: "agile",
    templateData: { tasks: [{ title: "a" }, { title: "b" }] },
    isPublic: true,
    createdBy: "u-1",
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-02T00:00:00Z",
    creator: null,
  },
  {
    id: "tp-2",
    name: "Bug triage",
    description: null,
    category: "ops",
    templateData: { tasks: [] },
    isPublic: false,
    createdBy: null,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-02T00:00:00Z",
    creator: null,
    taskCount: 5,
  },
  {
    id: "tp-3",
    name: "Ad hoc",
    description: "misc",
    category: null,
    templateData: {},
    isPublic: false,
    createdBy: null,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-02T00:00:00Z",
    creator: null,
  },
];

function renderList(overrides: Partial<Parameters<typeof TemplateList>[0]> = {}) {
  const props = {
    wid: "ws-1",
    onCreate: vi.fn(),
    onEdit: vi.fn(),
    onApply: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  const utils = render(<TemplateList {...props} />);
  return { ...utils, ...props };
}

function defaultApi(list: unknown[] = items) {
  mocks.api.mockImplementation(async (path: string, opts?: RequestInit) => {
    if (opts?.method === "DELETE") return {};
    if (path.startsWith(LIST_BASE)) return { items: list };
    return {};
  });
}

function listUrls() {
  return mocks.api.mock.calls
    .map((c) => c[0] as string)
    .filter((p) => p.startsWith(LIST_BASE) && !p.includes("/project-templates/"));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TemplateList", () => {
  it("加载中显示加载文案，首次请求不带 category 参数", () => {
    defaultApi();
    renderList();
    expect(screen.getByText("projectTemplate:loading")).toBeInTheDocument();
    expect(listUrls()[0]).toBe(`${LIST_BASE}?`);
  });

  it("卡片渲染：名称/分类/描述或占位/任务数/公开标记", async () => {
    defaultApi();
    const { container } = renderList();
    await waitFor(() => expect(screen.getByText("Sprint kickoff")).toBeInTheDocument());

    expect(screen.getByText("Standard sprint")).toBeInTheDocument();
    expect(screen.getByText("misc")).toBeInTheDocument();
    // 无描述回退
    expect(screen.getAllByText("projectTemplate:noDescription")).toHaveLength(1);
    // 任务数：模板数据长度 / 显式 taskCount / 缺失回退 0
    expect(screen.getByText('projectTemplate:taskCount:{"count":2}')).toBeInTheDocument();
    expect(screen.getByText('projectTemplate:taskCount:{"count":5}')).toBeInTheDocument();
    expect(screen.getByText('projectTemplate:taskCount:{"count":0}')).toBeInTheDocument();
    // 公开/私有标记（图标 span 的 title）
    expect(container.querySelectorAll('[title="projectTemplate:isPublic"]')).toHaveLength(1);
    expect(container.querySelectorAll('[title="projectTemplate:isPrivate"]')).toHaveLength(2);
  });

  it("分类下拉：去重排序 + 全部占位；切换后带 category 重拉", async () => {
    defaultApi();
    renderList();
    await waitFor(() => expect(screen.getByText("Sprint kickoff")).toBeInTheDocument());

    const select = screen.getByLabelText("projectTemplate:category") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "projectTemplate:allCategories",
      "agile",
      "ops",
    ]);
    expect(listUrls()).toHaveLength(1);

    fireEvent.change(select, { target: { value: "ops" } });
    await waitFor(() => expect(listUrls()).toHaveLength(2));
    expect(listUrls()[1]).toBe(`${LIST_BASE}?category=ops`);
  });

  it("无分类数据时不渲染分类下拉", async () => {
    defaultApi([items[2]]);
    renderList();
    await waitFor(() => expect(screen.getByText("Ad hoc")).toBeInTheDocument());
    expect(screen.queryByLabelText("projectTemplate:category")).not.toBeInTheDocument();
  });

  it("空列表渲染空态且两处新建按钮都回调 onCreate", async () => {
    defaultApi([]);
    const { onCreate } = renderList();
    await waitFor(() =>
      expect(screen.getByText("projectTemplate:noTemplates")).toBeInTheDocument(),
    );
    expect(screen.getByText("projectTemplate:noTemplatesHint")).toBeInTheDocument();

    const buttons = screen.getAllByRole("button", { name: "projectTemplate:create" });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0]);
    expect(onCreate).toHaveBeenCalledTimes(1);
    fireEvent.click(buttons[1]);
    expect(onCreate).toHaveBeenCalledTimes(2);
  });

  it("应用/编辑按钮把整条模板回传", async () => {
    defaultApi();
    const { onApply, onEdit } = renderList();
    await waitFor(() => expect(screen.getByText("Sprint kickoff")).toBeInTheDocument());

    fireEvent.click(screen.getAllByTitle("projectTemplate:apply")[0]);
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ id: "tp-1" }));

    fireEvent.click(screen.getAllByTitle("projectTemplate:edit")[1]);
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "tp-2" }));
  });

  it("删除：确认文案带模板名，成功后本地移除并回调", async () => {
    defaultApi();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { onDelete } = renderList();
    await waitFor(() => expect(screen.getByText("Sprint kickoff")).toBeInTheDocument());

    fireEvent.click(screen.getAllByTitle("projectTemplate:delete")[0]);
    await waitFor(() => expect(screen.queryByText("Sprint kickoff")).not.toBeInTheDocument());

    expect(confirmSpy).toHaveBeenCalledWith(
      'projectTemplate:confirmDelete:{"name":"Sprint kickoff"}',
    );
    expect(mocks.api).toHaveBeenCalledWith(`${LIST_BASE}/tp-1`, { method: "DELETE" });
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: "tp-1" }));
    expect(screen.getByText("Bug triage")).toBeInTheDocument();
  });

  it("删除取消：不发请求也不回调", async () => {
    defaultApi();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { onDelete } = renderList();
    await waitFor(() => expect(screen.getByText("Sprint kickoff")).toBeInTheDocument());

    fireEvent.click(screen.getAllByTitle("projectTemplate:delete")[0]);
    await waitFor(() =>
      expect(mocks.api.mock.calls.filter(([, o]) => o?.method === "DELETE")).toHaveLength(0),
    );
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText("Sprint kickoff")).toBeInTheDocument();
  });

  it("删除失败：显示错误、列表不变、不回调", async () => {
    mocks.api.mockImplementation(async (path: string, opts?: RequestInit) => {
      if (opts?.method === "DELETE") throw { weird: true };
      return { items };
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { onDelete } = renderList();
    await waitFor(() => expect(screen.getByText("Sprint kickoff")).toBeInTheDocument());

    fireEvent.click(screen.getAllByTitle("projectTemplate:delete")[0]);
    await waitFor(() =>
      expect(screen.getByText("projectTemplate:deleteFailed")).toBeInTheDocument(),
    );
    expect(screen.getByText("Sprint kickoff")).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("加载失败：Error 显示消息，非 Error 回退 loadFailed", async () => {
    mocks.api.mockImplementation(async () => {
      throw new Error("list-boom");
    });
    const first = renderList();
    await waitFor(() => expect(screen.getByText("list-boom")).toBeInTheDocument());
    first.unmount();

    mocks.api.mockImplementation(async () => {
      throw "nope";
    });
    renderList();
    await waitFor(() => expect(screen.getByText("projectTemplate:loadFailed")).toBeInTheDocument());
  });
});
