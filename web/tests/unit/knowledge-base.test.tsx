// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";

/**
 * KnowledgeBase 契约（components/KnowledgeBase.tsx，named 导出）：
 *  - 挂载 apiList GET /api/v1/workspaces/{wid}/spaces；loading / 空态 / 失败 e.message
 *  - 空间默认展开，文件夹按 expanded 字段展开；点击行折叠/展开（chevron aria-label 切换）
 *  - 点击文档 → router.push /w/{wid}/documents/{docId}
 *  - 新建空间：底部按钮 → 输入 → POST /spaces body {name}（trim）
 *  - 右键菜单：新建子文件夹 POST /spaces/{sid}/folders body {parentId,name}；
 *    重命名 PATCH /spaces/{id} body {name}；删除走 window.confirm，确认后 DELETE
 *  - 拖拽文档到另一空间 → PATCH /documents/{id}/move body {spaceId,folderId} + 重拉列表
 *  - 移动端：浮动按钮开抽屉，遮罩点击关闭
 */

const h = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(
      message: string,
      public status = 500,
      public code = 0,
    ) {
      super(message);
      this.name = "ApiError";
    }
  }
  return {
    api: vi.fn(),
    apiList: vi.fn(),
    ApiError,
    push: vi.fn(),
  };
});

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
vi.mock("@/lib/api", () => ({ api: h.api, apiList: h.apiList, ApiError: h.ApiError }));
vi.mock("@/lib/i18n-navigation", () => ({ useRouter: () => ({ push: h.push }) }));

import { KnowledgeBase } from "@/components/KnowledgeBase";

const WID = "ws-kb-1";

function doc(id: string, title: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title,
    icon: "file-text",
    emoji: null,
    sortOrder: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function folder(id: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name,
    icon: "folder",
    sortOrder: 1,
    expanded: true,
    parentId: null,
    children: [],
    documents: [],
    ...overrides,
  };
}

function space(id: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name,
    icon: "book",
    color: "var(--accent)",
    sortOrder: 1,
    folders: [],
    documents: [],
    ...overrides,
  };
}

/** 单空间：根文档 + 展开的子文件夹（内含文档） */
const SINGLE_SPACE = [
  space("sp-1", "产品", {
    folders: [folder("fo-1", "需求", { documents: [doc("doc-1", "PRD")] })],
    documents: [doc("doc-root", "首页")],
  }),
];

/** 双空间（供拖拽跨空间移动用） */
const TWO_SPACES = [...SINGLE_SPACE, space("sp-2", "研发")];

/** 桌面端目录树容器（div.hidden）内查询，避开移动端抽屉的重复渲染 */
const desktopRoot = (container: HTMLElement) =>
  within(container.querySelector("div.hidden") as HTMLElement);

async function renderLoaded(spaces: object[] = TWO_SPACES) {
  h.apiList.mockResolvedValue(spaces);
  const utils = render(<KnowledgeBase wid={WID} />);
  await waitFor(() => expect(screen.getByText("产品")).toBeInTheDocument());
  return utils;
}

let confirmSpy: MockInstance;

beforeEach(() => {
  h.api.mockReset();
  h.apiList.mockReset();
  h.push.mockReset();
  confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe("KnowledgeBase", () => {
  it("loading 初态：显示 loading 文案", () => {
    h.apiList.mockReturnValue(new Promise(() => {}));
    render(<KnowledgeBase wid={WID} />);
    expect(screen.getByText("knowledgeBase:loading")).toBeInTheDocument();
  });

  it("挂载：apiList 精确 URL；渲染空间/文件夹/文档树", async () => {
    await renderLoaded();
    expect(h.apiList).toHaveBeenCalledWith(`/api/v1/workspaces/${WID}/spaces`);
    expect(screen.getByText("需求")).toBeInTheDocument();
    expect(screen.getByText("PRD")).toBeInTheDocument();
    expect(screen.getByText("首页")).toBeInTheDocument();
  });

  it("空态：empty 标题 + hint + newSpace 引导按钮", async () => {
    h.apiList.mockResolvedValue([]);
    render(<KnowledgeBase wid={WID} />);
    await waitFor(() => expect(screen.getByText("knowledgeBase:empty")).toBeInTheDocument());
    expect(screen.getByText("knowledgeBase:emptyHint")).toBeInTheDocument();
    // 空态引导按钮 + 底部新建按钮 + 移动端浮动按钮均可见
    expect(
      screen.getAllByRole("button", { name: "knowledgeBase:newSpace" }).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("加载失败：显示 e.message", async () => {
    h.apiList.mockRejectedValue(new Error("加载空间失败：403"));
    render(<KnowledgeBase wid={WID} />);
    await waitFor(() => expect(screen.getByText("加载空间失败：403")).toBeInTheDocument());
  });

  it("折叠/展开：点击空间行收起子树，chevron aria-label 随之切换", async () => {
    const { container } = await renderLoaded();
    const desktop = desktopRoot(container);
    const spaceRow = desktop.getByRole("button", { name: /产品/ });
    fireEvent.click(spaceRow);
    expect(desktop.queryByText("PRD")).not.toBeInTheDocument();
    expect(desktop.queryByText("首页")).not.toBeInTheDocument();
    // 折叠后子树（含文件夹 chevron）不在 DOM：空间行内 chevron 唯一且为 expand
    expect(
      within(spaceRow).getByRole("button", { name: "knowledgeBase:expand" }),
    ).toBeInTheDocument();
    fireEvent.click(spaceRow);
    expect(desktop.getByText("PRD")).toBeInTheDocument();
    // 展开后文件夹 fo-1（expanded:true）的 chevron 也是 collapse，与空间行同名——
    // 断言限定在空间行内部，避免多命中
    expect(
      within(spaceRow).getByRole("button", { name: "knowledgeBase:collapse" }),
    ).toBeInTheDocument();
  });

  it("点击文档 → router.push /w/{wid}/documents/{docId}", async () => {
    const { container } = await renderLoaded();
    fireEvent.click(desktopRoot(container).getByRole("button", { name: /PRD/ }));
    expect(h.push).toHaveBeenCalledWith(`/w/${WID}/documents/doc-1`);
  });

  it("新建空间：POST /spaces body {name}（trim），新空间出现且输入关闭", async () => {
    h.apiList.mockResolvedValue(TWO_SPACES);
    h.api.mockResolvedValue(space("sp-3", "新空间", { sortOrder: 2 }));
    const { container } = await renderLoaded();
    fireEvent.click(desktopRoot(container).getByRole("button", { name: "knowledgeBase:newSpace" }));
    const input = screen.getByLabelText("knowledgeBase:untitledSpace");
    fireEvent.change(input, { target: { value: "  新空间  " } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    await waitFor(() =>
      expect(h.api).toHaveBeenCalledWith(`/api/v1/workspaces/${WID}/spaces`, {
        method: "POST",
        body: JSON.stringify({ name: "新空间" }),
      }),
    );
    await waitFor(() => expect(screen.getByText("新空间")).toBeInTheDocument());
    expect(screen.queryByLabelText("knowledgeBase:untitledSpace")).not.toBeInTheDocument();
  });

  it("新建空间失败（ApiError）：显示 e.message", async () => {
    h.apiList.mockResolvedValue([]);
    h.api.mockRejectedValue(new h.ApiError("空间名已存在", 409, 40901));
    render(<KnowledgeBase wid={WID} />);
    await waitFor(() => expect(screen.getByText("knowledgeBase:empty")).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: "knowledgeBase:newSpace" })[0]);
    const input = screen.getByLabelText("knowledgeBase:untitledSpace");
    fireEvent.change(input, { target: { value: "重复名" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    await waitFor(() => expect(screen.getByText("空间名已存在")).toBeInTheDocument());
  });

  it("右键空间 → 新建子文件夹：POST /spaces/{sid}/folders body {parentId:null,name}", async () => {
    h.apiList.mockResolvedValue(TWO_SPACES);
    h.api.mockResolvedValue(folder("fo-9", "设计"));
    const { container } = await renderLoaded();
    fireEvent.contextMenu(desktopRoot(container).getByRole("button", { name: /产品/ }));
    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("button", { name: "knowledgeBase:newFolder" }),
    );
    const input = screen.getByLabelText("knowledgeBase:untitledFolder");
    fireEvent.change(input, { target: { value: "设计" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    await waitFor(() =>
      expect(h.api).toHaveBeenCalledWith(`/api/v1/workspaces/${WID}/spaces/sp-1/folders`, {
        method: "POST",
        body: JSON.stringify({ parentId: null, name: "设计" }),
      }),
    );
  });

  it("重命名空间：PATCH /spaces/{id} body {name} 并就地更新", async () => {
    h.apiList.mockResolvedValue(TWO_SPACES);
    h.api.mockResolvedValue({});
    const { container } = await renderLoaded();
    fireEvent.contextMenu(desktopRoot(container).getByRole("button", { name: /产品/ }));
    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("button", { name: "knowledgeBase:rename" }),
    );
    const input = screen.getByLabelText("knowledgeBase:rename");
    fireEvent.change(input, { target: { value: "产品锦囊" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    await waitFor(() =>
      expect(h.api).toHaveBeenCalledWith(`/api/v1/workspaces/${WID}/spaces/sp-1`, {
        method: "PATCH",
        body: JSON.stringify({ name: "产品锦囊" }),
      }),
    );
    await waitFor(() => expect(screen.getByText("产品锦囊")).toBeInTheDocument());
    expect(screen.queryByText("产品")).not.toBeInTheDocument();
  });

  it("删除空间：window.confirm 确认 → DELETE /spaces/{id}，菜单关闭", async () => {
    h.apiList.mockResolvedValue(TWO_SPACES);
    h.api.mockResolvedValue({});
    const { container } = await renderLoaded();
    fireEvent.contextMenu(desktopRoot(container).getByRole("button", { name: /产品/ }));
    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("button", { name: "knowledgeBase:delete" }),
    );
    expect(confirmSpy).toHaveBeenCalledWith("knowledgeBase:deleteConfirm");
    await waitFor(() =>
      expect(h.api).toHaveBeenCalledWith(`/api/v1/workspaces/${WID}/spaces/sp-1`, {
        method: "DELETE",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(desktopRoot(container).queryByText("产品")).not.toBeInTheDocument();
  });

  it("删除取消（confirm=false）：不发 DELETE，菜单保留", async () => {
    confirmSpy.mockReturnValue(false);
    const { container } = await renderLoaded();
    fireEvent.contextMenu(desktopRoot(container).getByRole("button", { name: /产品/ }));
    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("button", { name: "knowledgeBase:delete" }),
    );
    expect(confirmSpy).toHaveBeenCalled();
    expect(h.api).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("拖拽文档到另一空间：PATCH /documents/{id}/move body {spaceId,folderId:null} + 重拉", async () => {
    h.apiList.mockResolvedValue(TWO_SPACES);
    h.api.mockResolvedValue({});
    const { container } = await renderLoaded();
    const payload = JSON.stringify({
      kind: "document",
      id: "doc-root",
      fromSpaceId: "sp-1",
      fromFolderId: null,
    });
    const dataTransfer = {
      setData: vi.fn(),
      getData: vi.fn(() => payload),
      effectAllowed: "",
      dropEffect: "",
    };
    fireEvent.dragStart(desktopRoot(container).getByRole("button", { name: /首页/ }), {
      dataTransfer,
    });
    const target = desktopRoot(container).getByRole("button", { name: /研发/ });
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
    await waitFor(() =>
      expect(h.api).toHaveBeenCalledWith(`/api/v1/workspaces/${WID}/documents/doc-root/move`, {
        method: "PATCH",
        body: JSON.stringify({ spaceId: "sp-2", folderId: null }),
      }),
    );
    // 移动成功后重新拉取空间树
    await waitFor(() => expect(h.apiList).toHaveBeenCalledTimes(2));
  });

  it("移动端：浮动按钮打开抽屉，遮罩点击关闭", async () => {
    h.apiList.mockResolvedValue(TWO_SPACES);
    const { container } = await renderLoaded();
    const floatBtn = container.querySelector(
      'button[aria-label="knowledgeBase:newSpace"]',
    ) as HTMLButtonElement;
    expect(floatBtn).toBeTruthy();
    expect(screen.queryByRole("presentation")).not.toBeInTheDocument();
    fireEvent.click(floatBtn);
    expect(screen.getByRole("presentation")).toBeInTheDocument();
    // 抽屉内渲染完整树（桌面 + 抽屉两份）
    expect(screen.getAllByText("PRD").length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByRole("presentation"));
    expect(screen.queryByRole("presentation")).not.toBeInTheDocument();
  });
});
