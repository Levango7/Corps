// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  toast: vi.fn(),
  push: vi.fn(),
  writeText: vi.fn(),
  createObjectURL: vi.fn(),
  revokeObjectURL: vi.fn(),
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
vi.mock("@/lib/api", () => ({ api: mocks.api }));

vi.mock("@/lib/i18n-navigation", async () => {
  const React = await import("react");
  return {
    useRouter: () => ({ push: mocks.push, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
    Link: (props: { href: string; children: React.ReactNode; className?: string }) =>
      React.createElement("a", { href: props.href, className: props.className }, props.children),
  };
});

vi.mock("@/components/Toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/components/DocumentPreview", () => ({
  DocumentPreview: ({ document: doc }: { document: { title: string } }) => (
    <div data-testid="doc-preview">{doc.title}</div>
  ),
}));

vi.mock("@/components/ExportPreview", () => ({
  ExportPreview: ({
    open,
    title,
    documents,
  }: {
    open: boolean;
    title: string;
    documents: unknown[];
  }) =>
    open ? (
      <div data-testid="export-preview" data-count={documents.length}>
        {title}
      </div>
    ) : null,
}));

vi.mock("@/components/Skeleton", () => ({
  DocumentListSkeleton: () => <div data-testid="list-skeleton" />,
}));

vi.mock("@/components/QuickActionMenu", () => ({
  QuickActionMenu: () => null,
}));

vi.mock("@/lib/use-long-press", () => ({
  useLongPress: () => ({
    onPointerDown: vi.fn(),
    onPointerUp: vi.fn(),
    onPointerLeave: vi.fn(),
    onPointerCancel: vi.fn(),
    onContextMenu: vi.fn(),
  }),
}));

vi.mock("@/lib/motion-tokens", () => ({
  useMotionTokens: () => ({ slow: 0.22, easeOut: [0.16, 1, 0.3, 1], reduced: true }),
}));

vi.mock("framer-motion", async () => {
  const React = await import("react");
  return {
    motion: new Proxy(
      {},
      {
        get: (_target, tag: string) => (props: Record<string, unknown>) => {
          // 剥掉 framer-motion 专有 props，剩余的透传给原生元素
          const {
            initial: _initial,
            animate: _animate,
            exit: _exit,
            transition: _transition,
            layout: _layout,
            ...rest
          } = props;
          return React.createElement(tag, rest);
        },
      },
    ),
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    LayoutGroup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

import { DocumentListView } from "@/components/DocumentListView";

const BASE = "/api/v1/workspaces/ws-1/documents";
const SEARCH_LABEL = "document:searchPlaceholder";
const PREVIEW_LABEL = "document:previewMode";
const MORE_LABEL = "document:moreActions";

interface DocItem {
  id: string;
  title: string;
  publishedAt: string | null;
  updatedAt: string;
  author: { id: string; name: string | null; email: string } | null;
}

function makeDoc(overrides: Partial<DocItem> = {}): DocItem {
  return {
    id: "d-1",
    title: "Alpha 文档",
    publishedAt: null,
    updatedAt: "2026-01-01T00:00:00Z",
    author: { id: "u-1", name: "Alice", email: "a@x.com" },
    ...overrides,
  };
}

beforeAll(() => {
  // jsdom 未实现 <dialog> 的 showModal/close；close 按 DOM 规范派发 close 事件
  HTMLDialogElement.prototype.showModal = vi.fn(function showModal(this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function close(this: HTMLDialogElement) {
    this.dispatchEvent(new Event("close"));
  });
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: mocks.writeText },
    configurable: true,
  });
  Object.defineProperty(URL, "createObjectURL", {
    value: mocks.createObjectURL,
    configurable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    value: mocks.revokeObjectURL,
    configurable: true,
  });
});

beforeEach(() => {
  mocks.api.mockReset();
  mocks.toast.mockReset();
  mocks.push.mockReset();
  mocks.writeText.mockReset();
  mocks.writeText.mockResolvedValue(undefined);
  mocks.createObjectURL.mockReset();
  mocks.createObjectURL.mockReturnValue("blob:mock");
  mocks.api.mockResolvedValue({ items: [], total: 0 });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function renderWithItems(docs: DocItem[]) {
  mocks.api.mockResolvedValueOnce({ items: docs, total: docs.length });
  render(<DocumentListView wid="ws-1" />);
  if (docs.length > 0) {
    await waitFor(() => expect(screen.getByText(docs[0].title)).toBeInTheDocument());
  } else {
    await waitFor(() => expect(screen.getByText("document:emptyState")).toBeInTheDocument());
  }
}

describe("DocumentListView", () => {
  it("挂载即拉取列表：URL 精确（空搜索为裸 ? 参数）；pending 时显示骨架屏", () => {
    mocks.api.mockReturnValue(new Promise(() => {}));
    render(<DocumentListView wid="ws-1" />);
    expect(mocks.api).toHaveBeenCalledWith(`${BASE}?`);
    expect(screen.getByTestId("list-skeleton")).toBeInTheDocument();
  });

  it("渲染条目：标题链接 / 作者 / 未发布草稿徽章与已发布徽章分支", async () => {
    await renderWithItems([
      makeDoc({ id: "d-1", title: "草稿文档", publishedAt: null }),
      makeDoc({ id: "d-2", title: "已发布文档", publishedAt: "2026-02-01T00:00:00Z" }),
    ]);
    expect(screen.getByRole("link", { name: /草稿文档/ })).toHaveAttribute(
      "href",
      "/w/ws-1/documents/d-1",
    );
    expect(screen.getByText("document:draftBadge")).toBeInTheDocument();
    expect(screen.getByText("document:publishedBadge")).toBeInTheDocument();
    expect(screen.getAllByText("Alice").length).toBe(2);
  });

  it("空列表（无搜索词）显示 emptyState 空态", async () => {
    await renderWithItems([]);
    expect(screen.getByText("document:emptyState")).toBeInTheDocument();
  });

  it("列表加载失败显示 e.message", async () => {
    mocks.api.mockRejectedValueOnce(new Error("网络断了"));
    render(<DocumentListView wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("网络断了")).toBeInTheDocument());
  });

  it("搜索：输入后按 q= 重新拉取；无结果显示 noSearchResults；点清除按钮恢复", async () => {
    await renderWithItems([]);
    const input = screen.getByLabelText(SEARCH_LABEL);
    // 先给出有结果的一次（搜索中转空结果需要两次：q 搜索返回空 → noSearchResults）
    mocks.api.mockResolvedValueOnce({ items: [], total: 0 });
    fireEvent.change(input, { target: { value: "不存在的词" } });
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith(`${BASE}?q=${encodeURIComponent("不存在的词")}`),
    );
    await waitFor(() => expect(screen.getByText("document:noSearchResults")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "document:clearSearch" })).toBeInTheDocument();

    mocks.api.mockResolvedValueOnce({ items: [], total: 0 });
    fireEvent.click(screen.getByRole("button", { name: "document:clearSearch" }));
    await waitFor(() => expect(mocks.api).toHaveBeenLastCalledWith(`${BASE}?`));
    await waitFor(() => expect(screen.getByText("document:emptyState")).toBeInTheDocument());
  });

  it("新建文档：POST body 精确，成功后 router.push 到编辑页", async () => {
    await renderWithItems([]);
    mocks.api.mockResolvedValueOnce({ id: "doc-9", title: "document:untitledDoc" });
    fireEvent.click(screen.getByRole("button", { name: "document:newDocument" }));
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith(BASE, {
        method: "POST",
        body: JSON.stringify({ title: "document:untitledDoc" }),
      }),
    );
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/w/ws-1/documents/doc-9"));
  });

  it("新建文档失败：显示 e.message 且按钮恢复可点", async () => {
    await renderWithItems([]);
    mocks.api.mockRejectedValueOnce(new Error("配额不足"));
    const newBtn = screen.getByRole("button", { name: "document:newDocument" });
    fireEvent.click(newBtn);
    await waitFor(() => expect(screen.getByText("配额不足")).toBeInTheDocument());
    await waitFor(() => expect(newBtn).toBeEnabled());
  });

  it("勾选条目出现批量工具栏（选中计数），取消勾选后消失", async () => {
    await renderWithItems([makeDoc({ id: "d-1", title: "Alpha 文档" })]);
    expect(screen.queryByText(/documentsSelectedInline/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Alpha 文档"));
    expect(
      screen.getByText('exportPreview:documentsSelectedInline:{"count":1}'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Alpha 文档"));
    expect(screen.queryByText(/documentsSelectedInline/)).not.toBeInTheDocument();
  });

  it("全选 / 取消全选切换所有勾选框，工具栏随之出现与消失", async () => {
    await renderWithItems([
      makeDoc({ id: "d-1", title: "Alpha 文档" }),
      makeDoc({ id: "d-2", title: "Beta 文档" }),
    ]);
    fireEvent.click(screen.getByLabelText("Alpha 文档"));
    const selectAllBtn = screen.getByRole("button", { name: "exportPreview:selectAll" });
    fireEvent.click(selectAllBtn);
    expect(screen.getByLabelText("Alpha 文档")).toBeChecked();
    expect(screen.getByLabelText("Beta 文档")).toBeChecked();
    expect(screen.getByRole("button", { name: "exportPreview:deselectAll" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "exportPreview:deselectAll" }));
    expect(screen.getByLabelText("Alpha 文档")).not.toBeChecked();
    expect(screen.queryByText(/documentsSelectedInline/)).not.toBeInTheDocument();
  });

  it("批量导出：POST body 精确（ids/format/toc），成功打开批量预览（标题含 count）", async () => {
    await renderWithItems([
      makeDoc({ id: "d-1", title: "Alpha 文档" }),
      makeDoc({ id: "d-2", title: "Beta 文档" }),
    ]);
    fireEvent.click(screen.getByLabelText("Alpha 文档"));
    fireEvent.click(screen.getByLabelText("Beta 文档"));
    const twoSections =
      '<section class="doc-section" id="doc-1"><h1>Alpha</h1><div class="doc-meta">m</div><p>one</p></section>' +
      '<section class="doc-section" id="doc-2"><h1>Beta</h1><div class="doc-meta">m</div><p>two</p></section>';
    mocks.api.mockResolvedValueOnce({ html: twoSections, documentCount: 2 });

    fireEvent.click(screen.getByRole("button", { name: "exportPreview:exportBatch" }));
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith(`${BASE}/batch-export`, {
        method: "POST",
        body: JSON.stringify({
          documentIds: ["d-1", "d-2"],
          format: "pdf",
          includeTableOfContents: true,
        }),
      }),
    );
    await waitFor(() => expect(screen.getByTestId("export-preview")).toBeInTheDocument());
    const preview = screen.getByTestId("export-preview");
    expect(preview.getAttribute("data-count")).toBe("2");
    expect(preview).toHaveTextContent('exportPreview:batchTitle:{"count":2}');
  });

  it("批量导出失败：显示 e.message 且按钮恢复", async () => {
    await renderWithItems([makeDoc({ id: "d-1", title: "Alpha 文档" })]);
    fireEvent.click(screen.getByLabelText("Alpha 文档"));
    mocks.api.mockRejectedValueOnce(new Error("导出服务过载"));
    fireEvent.click(screen.getByRole("button", { name: "exportPreview:exportBatch" }));
    await waitFor(() => expect(screen.getByText("导出服务过载")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "exportPreview:exportBatch" })).toBeEnabled();
  });

  it("预览：GET 单文档详情 → 打开原生 dialog 渲染预览；关闭后再失败时 toast error", async () => {
    await renderWithItems([makeDoc({ id: "d-1", title: "Alpha 文档" })]);
    mocks.api.mockResolvedValueOnce({ title: "详情标题", markdown: "# hi" });
    fireEvent.click(screen.getByRole("button", { name: PREVIEW_LABEL }));
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith(
        `${BASE}/d-1`,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
    await waitFor(() => expect(screen.getByTestId("doc-preview")).toBeInTheDocument());
    expect(screen.getByTestId("doc-preview")).toHaveTextContent("详情标题");

    fireEvent.click(screen.getByRole("button", { name: "document:close" }));
    await waitFor(() => expect(screen.queryByTestId("doc-preview")).not.toBeInTheDocument());

    mocks.api.mockRejectedValueOnce(new Error("详情拉取失败"));
    fireEvent.click(screen.getByRole("button", { name: PREVIEW_LABEL }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("error", "document:loadFailed"));
  });

  it("分享：POST share body 精确 → 复制绝对链接并 toast 成功；失败时 toast shareFailed", async () => {
    await renderWithItems([makeDoc({ id: "d-1", title: "Alpha 文档" })]);
    fireEvent.click(screen.getByRole("button", { name: MORE_LABEL }));
    expect(screen.getByRole("button", { name: "document:share" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "document:export" })).toBeInTheDocument();
    mocks.api.mockResolvedValueOnce({ shareUrl: "/s/tok1" });

    fireEvent.click(screen.getByRole("button", { name: "document:share" }));
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith(`${BASE}/d-1/share`, {
        method: "POST",
        body: JSON.stringify({ visibility: "private", expiresIn: 24 }),
      }),
    );
    await waitFor(() =>
      expect(mocks.writeText).toHaveBeenCalledWith(new URL("/s/tok1", window.location.origin).href),
    );
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith("success", "document:shareLinkCopied"),
    );

    // 失败分支：再次打开菜单分享，api 拒绝 → toast error
    mocks.api.mockRejectedValueOnce(new Error("x"));
    fireEvent.click(screen.getByRole("button", { name: MORE_LABEL }));
    fireEvent.click(screen.getByRole("button", { name: "document:share" }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("error", "document:shareFailed"));
  });

  it("导出 HTML：更多菜单 → POST convert body 精确 → createObjectURL 生成下载", async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await renderWithItems([makeDoc({ id: "d-1", title: "Alpha 文档" })]);
    fireEvent.click(screen.getByRole("button", { name: MORE_LABEL }));
    mocks.api.mockResolvedValueOnce({ content: "<p>converted</p>" });

    try {
      fireEvent.click(screen.getByRole("button", { name: "document:export" }));
      await waitFor(() =>
        expect(mocks.api).toHaveBeenCalledWith(`${BASE}/d-1/convert`, {
          method: "POST",
          body: JSON.stringify({ format: "html" }),
        }),
      );
      await waitFor(() => expect(mocks.createObjectURL).toHaveBeenCalledTimes(1));
      const blob = mocks.createObjectURL.mock.calls[0][0] as Blob;
      expect(blob).toBeInstanceOf(Blob);
      await waitFor(() => expect(clickSpy).toHaveBeenCalled());
      await waitFor(() =>
        expect(mocks.toast).toHaveBeenCalledWith("success", "document:exportStarted"),
      );
    } finally {
      clickSpy.mockRestore();
    }
  });
});
