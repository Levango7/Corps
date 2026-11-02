// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { WikiEditor, type WikiPageData } from "@/components/wiki/WikiEditor";

const apiMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({ api: apiMock }));

vi.mock("@/components/wiki/WikiViewer", () => ({
  WikiViewer: (props: { content: string }) => <div data-testid="wiki-viewer">{props.content}</div>,
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

const PAGE: WikiPageData = {
  id: "p-1",
  title: "首页",
  slug: "home",
  content: "正文内容",
  parentId: null,
  sortOrder: 0,
  updatedAt: "2026-10-02T00:00:00Z",
};

interface RenderOpts {
  page?: Partial<WikiPageData>;
  onSaved?: () => void;
  onDeleted?: () => void;
}

function renderEditor(opts: RenderOpts = {}) {
  const onSaved = opts.onSaved ?? vi.fn();
  const onDeleted = opts.onDeleted ?? vi.fn();
  const utils = render(
    <WikiEditor
      wid="ws-1"
      page={{ ...PAGE, ...opts.page }}
      onSaved={onSaved}
      onDeleted={onDeleted}
    />,
  );
  return { ...utils, onSaved, onDeleted };
}

const saveButton = () => screen.getByRole("button", { name: "wiki:save" });
const titleInput = () => screen.getByDisplayValue("首页");
const contentArea = () => screen.getByDisplayValue("正文内容");

afterEach(() => {
  cleanup();
  apiMock.mockReset();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("WikiEditor 初始渲染", () => {
  it("编辑模式：标题与内容回填，保存按钮禁用", () => {
    renderEditor();
    expect(titleInput()).toBeInTheDocument();
    expect(contentArea()).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it("工具栏含编辑/预览/删除按钮", () => {
    renderEditor();
    expect(screen.getByRole("button", { name: "wiki:edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "wiki:preview" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "wiki:delete" })).toBeInTheDocument();
  });
});

describe("WikiEditor 编辑/预览切换", () => {
  it("切到预览渲染 WikiViewer 与标题", async () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "wiki:preview" }));
    await act(async () => {});
    expect(screen.getByRole("heading", { name: "首页" })).toBeInTheDocument();
    const viewer = screen.getByTestId("wiki-viewer");
    expect(viewer).toHaveTextContent("正文内容");
  });

  it("预览时空标题回退到占位文案", async () => {
    renderEditor();
    fireEvent.change(titleInput(), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "wiki:preview" }));
    await act(async () => {});
    expect(screen.getByRole("heading", { name: "wiki:titlePlaceholder" })).toBeInTheDocument();
  });

  it("切回编辑模式恢复输入框", async () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "wiki:preview" }));
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "wiki:edit" }));
    await act(async () => {});
    expect(titleInput()).toBeInTheDocument();
    expect(contentArea()).toBeInTheDocument();
  });

  it("预览模式不渲染编辑输入框", async () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "wiki:preview" }));
    await act(async () => {});
    expect(screen.queryByDisplayValue("正文内容")).toBeNull();
  });
});

describe("WikiEditor 手动保存", () => {
  it("编辑后保存按钮可用，点击发起 PATCH", async () => {
    const { onSaved } = renderEditor();
    fireEvent.change(titleInput(), { target: { value: "新标题" } });
    expect(saveButton()).toBeEnabled();
    fireEvent.click(saveButton());
    await act(async () => {});
    expect(apiMock).toHaveBeenCalledWith("/api/v1/workspaces/ws-1/wiki/p-1", {
      method: "PATCH",
      body: JSON.stringify({ title: "新标题", content: "正文内容" }),
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("保存成功显示 saved 指示并再次禁用保存按钮", async () => {
    renderEditor();
    fireEvent.change(titleInput(), { target: { value: "新标题" } });
    fireEvent.click(saveButton());
    await act(async () => {});
    expect(screen.getByText("wiki:saved")).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it("未传 onSaved 时保存不报错", async () => {
    render(<WikiEditor wid="ws-1" page={PAGE} />);
    fireEvent.change(screen.getByDisplayValue("首页"), { target: { value: "新标题" } });
    fireEvent.click(screen.getByRole("button", { name: "wiki:save" }));
    await act(async () => {});
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("wiki:saved")).toBeInTheDocument();
  });

  it("saved 指示 2 秒后自动清除", async () => {
    renderEditor();
    // 先切假时钟，使保存后注册的清除计时器也被假时钟接管
    vi.useFakeTimers();
    fireEvent.change(titleInput(), { target: { value: "新标题" } });
    fireEvent.click(saveButton());
    await act(async () => {});
    expect(screen.getByText("wiki:saved")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.queryByText("wiki:saved")).toBeNull();
  });

  it("保存中显示 saving 指示且按钮禁用", async () => {
    renderEditor();
    apiMock.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.change(titleInput(), { target: { value: "新标题" } });
    fireEvent.click(saveButton());
    await act(async () => {});
    expect(screen.getByText("wiki:saving")).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });
});

describe("WikiEditor 保存失败", () => {
  it("Error 展示错误信息与 saveError 指示", async () => {
    renderEditor();
    apiMock.mockRejectedValueOnce(new Error("网络错误"));
    fireEvent.change(titleInput(), { target: { value: "新标题" } });
    fireEvent.click(saveButton());
    await act(async () => {});
    expect(screen.getByText("网络错误")).toBeInTheDocument();
    expect(screen.getByText("wiki:saveError")).toBeInTheDocument();
  });

  it("非 Error 抛出回退到 saveError 文案", async () => {
    const { container } = renderEditor();
    apiMock.mockRejectedValueOnce("boom");
    fireEvent.change(titleInput(), { target: { value: "新标题" } });
    fireEvent.click(saveButton());
    await act(async () => {});
    expect(container.querySelector("p")).toHaveTextContent("wiki:saveError");
  });

  it("失败后可再次修改并重试保存", async () => {
    renderEditor();
    apiMock.mockRejectedValueOnce(new Error("网络错误"));
    fireEvent.change(titleInput(), { target: { value: "新标题" } });
    fireEvent.click(saveButton());
    await act(async () => {});
    fireEvent.change(contentArea(), { target: { value: "改过的内容" } });
    fireEvent.click(saveButton());
    await act(async () => {});
    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(apiMock).toHaveBeenLastCalledWith("/api/v1/workspaces/ws-1/wiki/p-1", {
      method: "PATCH",
      body: JSON.stringify({ title: "新标题", content: "改过的内容" }),
    });
  });
});

describe("WikiEditor 自动保存", () => {
  it("编辑后 2 秒自动发起 PATCH，无需点保存", async () => {
    renderEditor();
    vi.useFakeTimers();
    fireEvent.change(titleInput(), { target: { value: "自动保存标题" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(apiMock).toHaveBeenCalledWith("/api/v1/workspaces/ws-1/wiki/p-1", {
      method: "PATCH",
      body: JSON.stringify({ title: "自动保存标题", content: "正文内容" }),
    });
    expect(screen.getByText("wiki:saved")).toBeInTheDocument();
  });

  it("无改动时不会自动保存", async () => {
    renderEditor();
    vi.useFakeTimers();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(apiMock).not.toHaveBeenCalled();
  });
});

describe("WikiEditor 删除", () => {
  it("确认后发起 DELETE 并通知父组件", async () => {
    const { onDeleted } = renderEditor();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "wiki:delete" }));
    await act(async () => {});
    expect(window.confirm).toHaveBeenCalledWith("wiki:deleteConfirm");
    expect(apiMock).toHaveBeenCalledWith("/api/v1/workspaces/ws-1/wiki/p-1", {
      method: "DELETE",
    });
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it("取消确认不删除", async () => {
    const { onDeleted } = renderEditor();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "wiki:delete" }));
    await act(async () => {});
    expect(apiMock).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("删除失败显示错误信息", async () => {
    renderEditor();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    apiMock.mockRejectedValueOnce(new Error("删除失败"));
    fireEvent.click(screen.getByRole("button", { name: "wiki:delete" }));
    await act(async () => {});
    expect(screen.getByText("删除失败")).toBeInTheDocument();
  });

  it("删除失败（非 Error）回退到 saveError 文案", async () => {
    const { container } = renderEditor();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    apiMock.mockRejectedValueOnce("boom");
    fireEvent.click(screen.getByRole("button", { name: "wiki:delete" }));
    await act(async () => {});
    expect(container.querySelector("p")).toHaveTextContent("wiki:saveError");
  });
});

describe("WikiEditor 页面切换重置", () => {
  it("page.id 变化后重置标题、内容与 dirty 状态", async () => {
    const { rerender, onSaved, onDeleted } = renderEditor();
    fireEvent.change(titleInput(), { target: { value: "改动" } });
    expect(saveButton()).toBeEnabled();
    rerender(
      <WikiEditor
        wid="ws-1"
        page={{ ...PAGE, id: "p-2", title: "另一页", content: "其他内容" }}
        onSaved={onSaved}
        onDeleted={onDeleted}
      />,
    );
    await act(async () => {});
    expect(screen.getByDisplayValue("另一页")).toBeInTheDocument();
    expect(screen.getByDisplayValue("其他内容")).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it("仅内容改动也标记 dirty", () => {
    renderEditor();
    fireEvent.change(contentArea(), { target: { value: "新内容" } });
    expect(saveButton()).toBeEnabled();
  });
});
