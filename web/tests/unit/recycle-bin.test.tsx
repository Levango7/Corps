// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";

/**
 * RecycleBin 契约（components/RecycleBin.tsx）：
 *  - 挂载 GET /api/v1/workspaces/{wid}/recycle-bin?page=1&limit=20（filter=all 无 type 参数）
 *  - 类型筛选切换：URL 带 type=task & 回到 page=1 & 清空多选
 *  - loading / 空态 / 加载失败（e.message）
 *  - 行渲染：类型标签、deletedBy null → unknown、剩余保留天数（30 天内）/ 到期 expired
 *  - 单项恢复 POST {id}：乐观移除 + total-1 + toast success
 *  - 永久删除 / 清空回收站走自定义确认对话框（非 window.confirm）：
 *    确认后 DELETE，Escape / 取消 / 遮罩点击均关闭且不发请求
 *  - 批量恢复：选中多项串行 POST，toast batchRestored {count}
 *  - 分页：page<=1 禁 prev；hasMore 才可 next，点击后以 page=2 重拉
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
    ApiError,
    toast: vi.fn(),
    postUrls: [] as string[],
    deleteUrls: [] as string[],
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
vi.mock("@/lib/api", () => ({ api: h.api, ApiError: h.ApiError }));
vi.mock("@/components/Toast", () => ({ useToast: () => ({ toast: h.toast }) }));

import { RecycleBin } from "@/components/RecycleBin";

const WID = "ws-rb-1";
const BASE = `/api/v1/workspaces/${WID}/recycle-bin`;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

function item(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: "task" as const,
    name: `条目-${id}`,
    deletedAt: new Date(Date.now() - HOUR).toISOString(),
    deletedBy: "张三" as string | null,
    ...overrides,
  };
}

/** 默认列表响应：2 条（1 任务 + 1 文档），无下一页 */
const LIST_TWO = {
  items: [item("t-1"), item("d-1", { type: "document", deletedBy: null })],
  page: 1,
  limit: 20,
  total: 2,
  hasMore: false,
};

/** 让 GET 返回 list，POST/DELETE 记录 URL 后成功 */
function mockListOnce(list: object) {
  h.api.mockImplementation(async (url: string, opts?: { method?: string }) => {
    if (!opts?.method) return list;
    if (opts.method === "POST") {
      h.postUrls.push(url);
      return {};
    }
    if (opts.method === "DELETE") {
      h.deleteUrls.push(url);
      return {};
    }
    return {};
  });
}

beforeEach(() => {
  h.api.mockReset();
  h.toast.mockReset();
  h.postUrls.length = 0;
  h.deleteUrls.length = 0;
});
afterEach(() => {
  cleanup();
});

const rowCheckboxes = () => screen.getAllByLabelText("recycleBin:itemLabel");

describe("RecycleBin", () => {
  it("挂载：GET 精确 URL（filter=all → 无 type 参数，page=1&limit=20）", async () => {
    mockListOnce(LIST_TWO);
    render(<RecycleBin workspaceId={WID} />);
    await waitFor(() => expect(screen.getByText("条目-t-1")).toBeInTheDocument());
    expect(h.api).toHaveBeenCalledTimes(1);
    expect(h.api.mock.calls[0][0]).toBe(`${BASE}?page=1&limit=20`);
  });

  it("loading 态：显示 loading、无表格与顶部批量操作", async () => {
    h.api.mockReturnValue(new Promise(() => {}));
    render(<RecycleBin workspaceId={WID} />);
    expect(screen.getByText("recycleBin:loading")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "recycleBin:batchRestore" }),
    ).not.toBeInTheDocument();
  });

  it("空态：显示 empty 提示，无表格、无分页", async () => {
    mockListOnce({ items: [], page: 1, limit: 20, total: 0, hasMore: false });
    render(<RecycleBin workspaceId={WID} />);
    await waitFor(() => expect(screen.getByText("recycleBin:empty")).toBeInTheDocument());
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("recycleBin:nextPage")).not.toBeInTheDocument();
  });

  it("加载失败：显示 e.message 错误文本", async () => {
    h.api.mockRejectedValue(new Error("网络中断"));
    render(<RecycleBin workspaceId={WID} />);
    await waitFor(() => expect(screen.getByText("网络中断")).toBeInTheDocument());
  });

  it("行渲染：类型标签、deletedBy null → unknown、剩余 30 天、分页计数", async () => {
    mockListOnce(LIST_TWO);
    render(<RecycleBin workspaceId={WID} />);
    await waitFor(() => expect(screen.getByText("条目-d-1")).toBeInTheDocument());
    const table = screen.getByRole("table");
    // 任务行：类型标签 tasks；文档行：documents
    expect(within(table).getAllByText("recycleBin:tasks")).toHaveLength(1);
    expect(within(table).getAllByText("recycleBin:documents")).toHaveLength(1);
    // deletedBy 为 null → unknown；非空显示原值
    expect(within(table).getByText("张三")).toBeInTheDocument();
    expect(within(table).getByText("recycleBin:unknown")).toBeInTheDocument();
    // 两行都是 1 小时前删除 → 都显示剩余 30 天
    expect(within(table).getAllByText(`recycleBin:retainDays:{"days":30}`)).toHaveLength(2);
    // 分页文本：page=1，totalPages=1，count=2
    expect(
      screen.getByText(`recycleBin:pagination:{"page":1,"total":1,"count":2}`),
    ).toBeInTheDocument();
  });

  it("到期条目（31 天前删除）：显示 expired 标记而非剩余天数", async () => {
    mockListOnce({
      items: [item("old-1", { deletedAt: new Date(Date.now() - 31 * DAY).toISOString() })],
      page: 1,
      limit: 20,
      total: 1,
      hasMore: false,
    });
    render(<RecycleBin workspaceId={WID} />);
    await waitFor(() => expect(screen.getByText("条目-old-1")).toBeInTheDocument());
    expect(screen.getByText("recycleBin:expired")).toBeInTheDocument();
    // 表头 retainDaysLabel 也含 "retainDays" 前缀，这里只匹配值文案（含 days 变量）
    expect(screen.queryByText(/recycleBin:retainDays:\{"days"/)).not.toBeInTheDocument();
  });

  it("切换筛选：GET 带 type=task 且回到 page=1", async () => {
    mockListOnce(LIST_TWO);
    render(<RecycleBin workspaceId={WID} />);
    await waitFor(() => expect(screen.getByText("条目-t-1")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "recycleBin:tasks" }));
    await waitFor(() => expect(h.api).toHaveBeenCalledTimes(2));
    expect(h.api.mock.calls[1][0]).toBe(`${BASE}?type=task&page=1&limit=20`);
  });

  it("单项恢复：POST {id}，行乐观移除、total-1、toast success", async () => {
    mockListOnce(LIST_TWO);
    render(<RecycleBin workspaceId={WID} />);
    await waitFor(() => expect(screen.getByText("条目-t-1")).toBeInTheDocument());
    fireEvent.click(screen.getAllByLabelText("recycleBin:restore")[0]);
    await waitFor(() => expect(h.postUrls).toEqual([`${BASE}/t-1`]));
    await waitFor(() => expect(screen.queryByText("条目-t-1")).not.toBeInTheDocument());
    expect(
      screen.getByText(`recycleBin:pagination:{"page":1,"total":1,"count":1}`),
    ).toBeInTheDocument();
    expect(h.toast).toHaveBeenCalledWith("success", "recycleBin:restored");
  });

  it("恢复失败（ApiError）：toast error 显示 e.message", async () => {
    mockListOnce(LIST_TWO);
    h.api.mockImplementation(async (url: string, opts?: { method?: string }) => {
      if (opts?.method === "POST") throw new h.ApiError("无权操作", 403, 40300);
      return LIST_TWO;
    });
    render(<RecycleBin workspaceId={WID} />);
    await waitFor(() => expect(screen.getByText("条目-t-1")).toBeInTheDocument());
    fireEvent.click(screen.getAllByLabelText("recycleBin:restore")[0]);
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith("error", "无权操作"));
    // 失败不移除行
    expect(screen.getByText("条目-t-1")).toBeInTheDocument();
  });

  it("永久删除：确认对话框确认后 DELETE {id} + toast + 对话框关闭", async () => {
    mockListOnce(LIST_TWO);
    render(<RecycleBin workspaceId={WID} />);
    await waitFor(() => expect(screen.getByText("条目-t-1")).toBeInTheDocument());
    fireEvent.click(screen.getAllByLabelText("recycleBin:permanentDelete")[0]);
    const dialog = screen.getByRole("dialog", { name: "recycleBin:confirmDeleteTitle" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("recycleBin:confirmDelete")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "recycleBin:confirm" }));
    await waitFor(() => expect(h.deleteUrls).toEqual([`${BASE}/t-1`]));
    expect(h.toast).toHaveBeenCalledWith("success", "recycleBin:deleted");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("确认对话框：Escape / 取消 / 遮罩点击均关闭且不发 DELETE", async () => {
    mockListOnce(LIST_TWO);
    const { container } = render(<RecycleBin workspaceId={WID} />);
    await waitFor(() => expect(screen.getByText("条目-t-1")).toBeInTheDocument());
    const deleteBtns = screen.getAllByLabelText("recycleBin:permanentDelete");

    // Escape 关闭
    fireEvent.click(deleteBtns[0]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // 取消按钮关闭
    fireEvent.click(deleteBtns[0]);
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "recycleBin:cancel" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // 遮罩点击关闭（点击内层面板不关闭由 stopPropagation 保证，此处点外层）
    fireEvent.click(deleteBtns[0]);
    fireEvent.click(screen.getByRole("dialog"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    expect(h.deleteUrls).toEqual([]);
    expect(container).toBeInTheDocument();
  });

  it("批量恢复：选中 2 项 → 串行 POST ×2 + batchRestored count=2 + 清空选择", async () => {
    mockListOnce(LIST_TWO);
    render(<RecycleBin workspaceId={WID} />);
    await waitFor(() => expect(screen.getByText("条目-t-1")).toBeInTheDocument());
    const batchBtn = screen.getByRole("button", { name: "recycleBin:batchRestore" });
    expect(batchBtn).toBeDisabled();

    fireEvent.click(rowCheckboxes()[0]);
    expect(screen.getByText(`recycleBin:selected:{"count":1}`)).toBeInTheDocument();
    fireEvent.click(rowCheckboxes()[1]);
    expect(batchBtn).toBeEnabled();
    fireEvent.click(batchBtn);

    await waitFor(() => expect(h.postUrls).toEqual([`${BASE}/t-1`, `${BASE}/d-1`]));
    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith("success", `recycleBin:batchRestored:{"count":2}`),
    );
    // 选择清空 + 重新拉取列表：1 次挂载 GET + 2 次 POST + 1 次重拉 GET = 4 次 api 调用
    await waitFor(() => expect(screen.queryByText(/recycleBin:selected/)).not.toBeInTheDocument());
    await waitFor(() => expect(h.api).toHaveBeenCalledTimes(4));
    expect(h.api.mock.calls[3][0]).toBe(`${BASE}?page=1&limit=20`);
  });

  it("清空回收站：确认后逐项 DELETE 当前页 + toast cleared", async () => {
    mockListOnce(LIST_TWO);
    render(<RecycleBin workspaceId={WID} />);
    await waitFor(() => expect(screen.getByText("条目-t-1")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "recycleBin:clearAll" }));
    const dialog = screen.getByRole("dialog", { name: "recycleBin:confirmClearTitle" });
    fireEvent.click(within(dialog).getByRole("button", { name: "recycleBin:confirm" }));
    await waitFor(() => expect(h.deleteUrls).toEqual([`${BASE}/t-1`, `${BASE}/d-1`]));
    expect(h.toast).toHaveBeenCalledWith("success", "recycleBin:cleared");
  });

  it("分页：page=1 禁 prev；hasMore 时点 next → 以 page=2 重拉", async () => {
    mockListOnce({ ...LIST_TWO, total: 21, hasMore: true });
    render(<RecycleBin workspaceId={WID} />);
    await waitFor(() => expect(screen.getByText("条目-t-1")).toBeInTheDocument());
    const prev = screen.getByLabelText("recycleBin:prevPage");
    const next = screen.getByLabelText("recycleBin:nextPage");
    expect(prev).toBeDisabled();
    expect(next).toBeEnabled();
    fireEvent.click(next);
    await waitFor(() => expect(h.api).toHaveBeenCalledTimes(2));
    expect(h.api.mock.calls[1][0]).toBe(`${BASE}?page=2&limit=20`);
  });
});
