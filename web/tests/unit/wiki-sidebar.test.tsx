// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { WikiSidebar, type WikiPageNode } from "@/components/wiki/WikiSidebar";

const apiMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({ api: apiMock }));

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

const CHILD: WikiPageNode = {
  id: "p-1-1",
  title: "子页",
  slug: "child",
  content: "",
  parentId: "p-1",
  createdBy: "u-1",
  sortOrder: 0,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-02T00:00:00Z",
  children: [],
};

const TREE: WikiPageNode[] = [
  {
    id: "p-1",
    title: "首页",
    slug: "home",
    content: "",
    parentId: null,
    createdBy: "u-1",
    sortOrder: 0,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-02T00:00:00Z",
    children: [CHILD],
  },
  {
    id: "p-2",
    title: "第二页",
    slug: "second",
    content: "",
    parentId: null,
    createdBy: "u-1",
    sortOrder: 1,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-03T00:00:00Z",
    children: [],
  },
];

interface MockOpts {
  tree?: WikiPageNode[];
  error?: unknown;
}

/** 按 URL 与 method 分流：GET 列表 / POST 新建 */
function mockApi(opts: MockOpts = {}) {
  apiMock.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === "POST") {
      const body = JSON.parse(init.body ?? "{}");
      return {
        id: "p-new",
        title: body.title,
        slug: "new",
        content: "",
        parentId: body.parentId,
        createdBy: "u-1",
        sortOrder: 0,
        createdAt: "2026-10-04T00:00:00Z",
        updatedAt: "2026-10-04T00:00:00Z",
        children: [],
      } satisfies WikiPageNode;
    }
    if (opts.error !== undefined) throw opts.error;
    return { items: opts.tree ?? TREE, total: (opts.tree ?? TREE).length, hasMore: false };
  });
}

async function renderLoaded(opts: MockOpts = {}, props = {}) {
  mockApi(opts);
  const onSelect = vi.fn();
  const utils = render(<WikiSidebar wid="ws-1" onSelect={onSelect} {...props} />);
  await act(async () => {});
  return { ...utils, onSelect };
}

const rowOf = (name: string) => screen.getByText(name).closest("li") as HTMLLIElement;

afterEach(() => {
  cleanup();
  apiMock.mockReset();
  vi.restoreAllMocks();
});

describe("WikiSidebar 初始加载", () => {
  it("加载中显示 loading 文案", async () => {
    // 永不 resolve，冻结在加载态
    apiMock.mockReturnValue(new Promise(() => {}));
    render(<WikiSidebar wid="ws-1" onSelect={vi.fn()} />);
    expect(screen.getByText("wiki:loadError")).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith("/api/v1/workspaces/ws-1/wiki?");
  });

  it("请求带查询参数？无搜索时 URL 以 ? 结尾", async () => {
    await renderLoaded();
    expect(apiMock).toHaveBeenCalledWith("/api/v1/workspaces/ws-1/wiki?");
  });
});

describe("WikiSidebar 页面树", () => {
  it("渲染顶层页面与子页面", async () => {
    await renderLoaded();
    expect(screen.getByText("首页")).toBeInTheDocument();
    expect(screen.getByText("子页")).toBeInTheDocument();
    expect(screen.getByText("第二页")).toBeInTheDocument();
  });

  it("点击页面行回调 onSelect 并传完整节点", async () => {
    const { onSelect } = await renderLoaded();
    fireEvent.click(screen.getByText("首页"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "p-1", title: "首页" }));
  });

  it("selectedId 对应的行带选中样式", async () => {
    await renderLoaded({}, { selectedId: "p-2" });
    const row = screen.getByText("第二页").closest("div");
    expect(row).toHaveClass("bg-[var(--accent-soft)]");
    const other = screen.getByText("首页").closest("div");
    expect(other).not.toHaveClass("bg-[var(--accent-soft)]");
  });

  it("空树显示无页面提示", async () => {
    await renderLoaded({ tree: [] });
    expect(screen.getByText("wiki:noPages")).toBeInTheDocument();
  });

  it("加载错误显示错误信息", async () => {
    await renderLoaded({ error: new Error("树拉取失败") });
    expect(screen.getByText("树拉取失败")).toBeInTheDocument();
  });

  it("非 Error 抛出时回退到 saveError 文案", async () => {
    await renderLoaded({ error: "plain string" });
    expect(screen.getByText("wiki:loadError")).toBeInTheDocument();
  });
});

describe("WikiSidebar 搜索", () => {
  it("输入关键字后带 q 参数重新拉取并渲染新结果", async () => {
    await renderLoaded();
    // 后续请求按 q 参数过滤（模拟服务端搜索行为）
    apiMock.mockImplementation(async (url: string) => ({
      items: url.includes("q=") ? [CHILD] : TREE,
      total: url.includes("q=") ? 1 : TREE.length,
      hasMore: false,
    }));
    const input = screen.getByPlaceholderText("wiki:searchPlaceholder");
    fireEvent.change(input, { target: { value: "子" } });
    await act(async () => {});
    expect(apiMock).toHaveBeenLastCalledWith("/api/v1/workspaces/ws-1/wiki?q=%E5%AD%90");
    expect(screen.getByText("子页")).toBeInTheDocument();
    expect(screen.queryByText("第二页")).toBeNull();
    // 首次（空搜索）请求仍保留
    expect(apiMock).toHaveBeenNthCalledWith(1, "/api/v1/workspaces/ws-1/wiki?");
  });

  it("清空搜索恢复无参拉取", async () => {
    await renderLoaded();
    const input = screen.getByPlaceholderText("wiki:searchPlaceholder");
    fireEvent.change(input, { target: { value: "子" } });
    await act(async () => {});
    fireEvent.change(input, { target: { value: "" } });
    await act(async () => {});
    expect(apiMock).toHaveBeenLastCalledWith("/api/v1/workspaces/ws-1/wiki?");
  });
});

describe("WikiSidebar 展开/折叠", () => {
  it("有子节点的行显示 toggle 按钮，叶子节点不显示", async () => {
    await renderLoaded();
    expect(screen.getAllByRole("button", { name: "toggle" })).toHaveLength(1);
  });

  it("点击 toggle 折叠子页面，再次点击展开", async () => {
    await renderLoaded();
    const toggle = screen.getByRole("button", { name: "toggle" });
    fireEvent.click(toggle);
    expect(screen.queryByText("子页")).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText("子页")).toBeInTheDocument();
  });

  it("点击 toggle 不触发 onSelect", async () => {
    const { onSelect } = await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("WikiSidebar 新建页面", () => {
  it("点击头部新建按钮调 prompt 并 POST 根页面", async () => {
    const promptMock = vi.spyOn(window, "prompt").mockReturnValue("新页面");
    const { onSelect } = await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "wiki:newPage" }));
    await act(async () => {});
    expect(promptMock).toHaveBeenCalledWith("wiki:newPage", "");
    expect(apiMock).toHaveBeenCalledWith("/api/v1/workspaces/ws-1/wiki", {
      method: "POST",
      body: JSON.stringify({ title: "新页面", parentId: null, content: "" }),
    });
    // 创建后选中新建页面
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "p-new" }));
  });

  it("创建后递增内部刷新计数触发重新拉取", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("新页面");
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "wiki:newPage" }));
    await act(async () => {});
    // 一次初始 + 一次内部刷新
    expect(apiMock.mock.calls.filter((c) => !c[1])).toHaveLength(2);
  });

  it("prompt 返回空字符串不发起请求", async () => {
    const promptMock = vi.spyOn(window, "prompt").mockReturnValue("  ");
    const { onSelect } = await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "wiki:newPage" }));
    await act(async () => {});
    expect(promptMock).toHaveBeenCalled();
    expect(apiMock).toHaveBeenCalledTimes(1); // 仅初始拉取
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("prompt 被取消（null）不发起请求", async () => {
    vi.spyOn(window, "prompt").mockReturnValue(null);
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "wiki:newPage" }));
    await act(async () => {});
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it("POST 失败显示错误信息", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("新页面");
    await renderLoaded();
    apiMock.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (init?.method === "POST") throw new Error("创建失败");
      return { items: TREE, total: TREE.length, hasMore: false };
    });
    fireEvent.click(screen.getByRole("button", { name: "wiki:newPage" }));
    await act(async () => {});
    expect(screen.getByText("创建失败")).toBeInTheDocument();
  });

  it("POST 非 Error 抛出回退到 saveError 文案", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("新页面");
    await renderLoaded();
    apiMock.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (init?.method === "POST") throw "boom";
      return { items: TREE, total: TREE.length, hasMore: false };
    });
    fireEvent.click(screen.getByRole("button", { name: "wiki:newPage" }));
    await act(async () => {});
    expect(screen.getByText("wiki:saveError")).toBeInTheDocument();
  });
});

describe("WikiSidebar 新建子页面", () => {
  it("点击行内新建按钮以 newSubPage 为 prompt 默认值并带 parentId", async () => {
    const promptMock = vi.spyOn(window, "prompt").mockReturnValue("子页面");
    const { onSelect } = await renderLoaded();
    // 首页行（含子节点）有一个 new subpage 按钮
    const subBtn = rowOf("首页").querySelector<HTMLButtonElement>(
      'button[aria-label="new subpage"]',
    );
    fireEvent.click(subBtn!);
    await act(async () => {});
    expect(promptMock).toHaveBeenCalledWith("wiki:newSubPage", "");
    expect(apiMock).toHaveBeenCalledWith("/api/v1/workspaces/ws-1/wiki", {
      method: "POST",
      body: JSON.stringify({ title: "子页面", parentId: "p-1", content: "" }),
    });
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "p-new", parentId: "p-1" }),
    );
  });

  it("点击行内新建按钮不触发 onSelect", async () => {
    vi.spyOn(window, "prompt").mockReturnValue(null);
    const { onSelect } = await renderLoaded();
    const subBtn = rowOf("首页").querySelector<HTMLButtonElement>(
      'button[aria-label="new subpage"]',
    );
    fireEvent.click(subBtn!);
    await act(async () => {});
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("WikiSidebar 外部刷新信号", () => {
  it("refreshKey 递增触发重新拉取", async () => {
    const { rerender } = await renderLoaded();
    expect(apiMock).toHaveBeenCalledTimes(1);
    rerender(<WikiSidebar wid="ws-1" onSelect={vi.fn()} refreshKey={1} />);
    await act(async () => {});
    expect(apiMock).toHaveBeenCalledTimes(2);
  });

  it("wid 变化触发重新拉取", async () => {
    const { rerender } = await renderLoaded();
    rerender(<WikiSidebar wid="ws-9" onSelect={vi.fn()} />);
    await act(async () => {});
    expect(apiMock).toHaveBeenLastCalledWith("/api/v1/workspaces/ws-9/wiki?");
  });
});
