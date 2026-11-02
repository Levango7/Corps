// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { WikiPageView } from "@/components/wiki/WikiPageView";

const { apiMock, ApiErrorMock } = vi.hoisted(() => {
  class ApiError extends Error {
    status?: number;
    constructor(message: string, status?: number) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  }
  return { apiMock: vi.fn(), ApiErrorMock: ApiError };
});

vi.mock("@/lib/api", () => ({ api: apiMock, ApiError: ApiErrorMock }));

const pushMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
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

vi.mock("@/components/wiki/WikiSidebar", () => ({
  WikiSidebar: (props: {
    wid: string;
    selectedId?: string;
    onSelect: (node: { id: string }) => void;
    refreshKey?: number;
  }) => (
    <div
      data-testid="wiki-sidebar"
      data-wid={props.wid}
      data-selected={props.selectedId ?? ""}
      data-refresh={props.refreshKey ?? 0}
    >
      <button type="button" onClick={() => props.onSelect({ id: "node-9" })}>
        side-select
      </button>
    </div>
  ),
}));

vi.mock("@/components/wiki/WikiEditor", () => ({
  WikiEditor: (props: {
    wid: string;
    page: { id: string; title: string };
    onSaved?: () => void;
    onDeleted?: () => void;
  }) => (
    <div data-testid="wiki-editor" data-wid={props.wid} data-page-id={props.page.id}>
      <span>{props.page.title}</span>
      <button type="button" onClick={() => props.onSaved?.()}>
        editor-saved
      </button>
      <button type="button" onClick={() => props.onDeleted?.()}>
        editor-deleted
      </button>
    </div>
  ),
}));

const PAGE_DETAIL = {
  id: "p-1",
  title: "首页",
  slug: "home",
  content: "正文内容",
  parentId: null,
  sortOrder: 0,
  updatedAt: "2026-10-02T00:00:00Z",
  children: [
    { id: "p-1-1", title: "子页", slug: "child", sortOrder: 0, updatedAt: "2026-10-02T01:00:00Z" },
  ],
  createdBy: "u-1",
  createdAt: "2026-10-01T00:00:00Z",
};

afterEach(() => {
  cleanup();
  apiMock.mockReset();
  pushMock.mockReset();
  vi.restoreAllMocks();
});

/** 渲染并等待初始拉取结束 */
async function renderLoaded(
  opts: { detail?: unknown; error?: unknown; props?: { wid?: string; pageId?: string } } = {},
) {
  if (opts.error !== undefined) {
    apiMock.mockImplementationOnce(async () => {
      throw opts.error;
    });
  } else {
    apiMock.mockImplementationOnce(async () => opts.detail ?? PAGE_DETAIL);
  }
  const utils = render(
    <WikiPageView wid={opts.props?.wid ?? "ws-1"} pageId={opts.props?.pageId ?? "p-1"} />,
  );
  await act(async () => {});
  return utils;
}

describe("WikiPageView 初始加载", () => {
  it("加载中显示 loading 文案", () => {
    apiMock.mockReturnValue(new Promise(() => {}));
    render(<WikiPageView wid="ws-1" pageId="p-1" />);
    expect(screen.getByText("wiki:loadError")).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith("/api/v1/workspaces/ws-1/wiki/p-1");
  });

  it("加载完成渲染编辑器并传递页面", async () => {
    renderLoaded();
    const editor = await screen.findByTestId("wiki-editor");
    expect(editor).toHaveAttribute("data-wid", "ws-1");
    expect(editor).toHaveAttribute("data-page-id", "p-1");
    expect(editor).toHaveTextContent("首页");
  });

  it("加载完成向侧边栏传递 selectedId", async () => {
    renderLoaded();
    const sidebar = await screen.findByTestId("wiki-sidebar");
    expect(sidebar).toHaveAttribute("data-wid", "ws-1");
    expect(sidebar).toHaveAttribute("data-selected", "p-1");
    expect(sidebar).toHaveAttribute("data-refresh", "0");
  });
});

describe("WikiPageView 加载失败", () => {
  it("404 时显示 notFound 提示且不渲染编辑器", async () => {
    renderLoaded({ error: new ApiErrorMock("not found", 404) });
    expect(await screen.findByText("wiki:notFound")).toBeInTheDocument();
    expect(screen.queryByTestId("wiki-editor")).toBeNull();
  });

  it("ApiError 非 404 时显示错误信息", async () => {
    renderLoaded({ error: new ApiErrorMock("服务器错误", 500) });
    expect(await screen.findByText("服务器错误")).toBeInTheDocument();
    expect(screen.queryByTestId("wiki-editor")).toBeNull();
  });

  it("普通 Error 显示其信息", async () => {
    renderLoaded({ error: new Error("网络中断") });
    expect(await screen.findByText("网络中断")).toBeInTheDocument();
  });

  it("非 Error 抛出显示兜底文案", async () => {
    renderLoaded({ error: "boom" });
    expect(await screen.findByText("wiki:loadError")).toBeInTheDocument();
  });
});

describe("WikiPageView 交互", () => {
  it("侧边栏选中页面 → router.push 新页面", async () => {
    renderLoaded();
    fireEvent.click(await screen.findByText("side-select"));
    await act(async () => {});
    expect(pushMock).toHaveBeenCalledWith("/w/ws-1/wiki/node-9");
  });

  it("编辑器保存成功 → 侧边栏 refreshKey 递增", async () => {
    renderLoaded();
    await screen.findByTestId("wiki-editor");
    fireEvent.click(screen.getByText("editor-saved"));
    await act(async () => {});
    expect(screen.getByTestId("wiki-sidebar")).toHaveAttribute("data-refresh", "1");
  });

  it("编辑器删除成功 → 返回 wiki 首页", async () => {
    renderLoaded();
    fireEvent.click(await screen.findByText("editor-deleted"));
    await act(async () => {});
    expect(pushMock).toHaveBeenCalledWith("/w/ws-1/wiki");
  });

  it("pageId 变化后重新拉取新页面", async () => {
    apiMock.mockImplementationOnce(async () => PAGE_DETAIL);
    const { rerender } = render(<WikiPageView wid="ws-1" pageId="p-1" />);
    await act(async () => {});
    apiMock.mockImplementationOnce(async () => ({ ...PAGE_DETAIL, id: "p-2", title: "第二页" }));
    rerender(<WikiPageView wid="ws-1" pageId="p-2" />);
    await act(async () => {});
    expect(apiMock).toHaveBeenNthCalledWith(1, "/api/v1/workspaces/ws-1/wiki/p-1");
    expect(apiMock).toHaveBeenNthCalledWith(2, "/api/v1/workspaces/ws-1/wiki/p-2");
    expect(screen.getByTestId("wiki-editor")).toHaveAttribute("data-page-id", "p-2");
    expect(screen.getByTestId("wiki-editor")).toHaveTextContent("第二页");
    expect(screen.getByTestId("wiki-sidebar")).toHaveAttribute("data-selected", "p-2");
  });
});
