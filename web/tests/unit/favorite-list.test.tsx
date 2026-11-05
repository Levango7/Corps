// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * FavoriteList 契约（components/common/FavoriteList.tsx）：
 *  1. 挂载即 GET /api/v1/favorites?wid={wid}&limit=200（带 AbortSignal），先显示 loading
 *  2. 空数据 → noFavorites 空态；加载失败 → 错误条 error（close 清除后转空态）
 *  3. 按 TYPE_ORDER（task→document→wiki→whiteboard→form→meeting→message）分组渲染，
 *     分组标题 t(typeXxx) + "(n)"，组内仅含对应 targetType
 *  4. 收藏项：targetId + 相对时间（justNow/minutesAgo{count}）+ note（有才渲染）+ 类型图标
 *  5. 点击项 → window.open(`${route}/${targetId}`, "_blank", "noopener,noreferrer")，
 *     未知 targetType 不渲染（无路由）
 *  6. 取消收藏 → DELETE /api/v1/favorites/{id}?wid={wid}，行移除 + toast success removed；
 *     删除中该项按钮 disabled；失败 toast error
 *  7. 头部计数 span = favorites.length
 */

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  toast: vi.fn(),
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
vi.mock("@/components/Toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

import FavoriteList from "@/components/common/FavoriteList";

const WID = "ws-fl-1";
const NOW = Date.now();

const FAV_TASK = {
  id: "fav-1",
  targetType: "task",
  targetId: "task-9",
  note: "优先处理",
  createdAt: new Date(NOW - 90_000).toISOString(),
};
const FAV_DOC = {
  id: "fav-2",
  targetType: "document",
  targetId: "doc-3",
  note: null,
  createdAt: new Date(NOW).toISOString(),
};
const FAV_MEETING = {
  id: "fav-3",
  targetType: "meeting",
  targetId: "mtg-1",
  note: null,
  createdAt: new Date(NOW).toISOString(),
};

function renderList() {
  return render(<FavoriteList workspaceId={WID} />);
}

beforeEach(() => {
  mocks.api.mockReset();
  mocks.toast.mockReset();
  mocks.api.mockResolvedValue([]);
});
afterEach(() => cleanup());

describe("FavoriteList", () => {
  it("挂载即 GET 收藏列表：URL 精确（wid + limit=200），期间显示 loading", () => {
    let resolve!: (v: unknown) => void;
    mocks.api.mockReturnValueOnce(
      new Promise((res) => {
        resolve = res;
      }),
    );
    renderList();

    expect(mocks.api).toHaveBeenCalledWith("/api/v1/favorites?wid=ws-fl-1&limit=200", {
      signal: expect.any(AbortSignal),
    });
    expect(screen.getByText("common.favorite:loading")).toBeInTheDocument();
    resolve([]);
  });

  it("空数据：显示 noFavorites 空态，头部计数 0", async () => {
    const { container } = renderList();
    await waitFor(() => expect(screen.queryByText("common.favorite:loading")).toBeFalsy());

    expect(screen.getByText("common.favorite:noFavorites")).toBeInTheDocument();
    expect(container.querySelector("header span")?.textContent).toBe("0");
  });

  it("加载失败：错误条 error，close 清除后转空态", async () => {
    mocks.api.mockRejectedValueOnce(new Error("boom"));
    renderList();

    await waitFor(() => expect(screen.getByText("common.favorite:error")).toBeInTheDocument());
    expect(screen.queryByText("common.favorite:noFavorites")).toBeFalsy();

    fireEvent.click(screen.getByLabelText("common.favorite:close"));
    await waitFor(() =>
      expect(screen.getByText("common.favorite:noFavorites")).toBeInTheDocument(),
    );
  });

  it("分组按 TYPE_ORDER 顺序渲染（task 在 document 前、meeting 在 message 前），分组计数 (n)", async () => {
    mocks.api.mockResolvedValueOnce([
      FAV_MEETING,
      FAV_DOC,
      FAV_TASK,
      { ...FAV_MEETING, id: "fav-4", targetType: "message", targetId: "msg-7" },
    ]);
    const { container } = renderList();
    await waitFor(() => expect(screen.getByText("common.favorite:typeTask")).toBeInTheDocument());

    const text = container.textContent ?? "";
    expect(text.indexOf("common.favorite:typeTask")).toBeGreaterThan(-1);
    expect(text.indexOf("common.favorite:typeTask")).toBeLessThan(
      text.indexOf("common.favorite:typeDocument"),
    );
    expect(text.indexOf("common.favorite:typeMeeting")).toBeLessThan(
      text.indexOf("common.favorite:typeMessage"),
    );
    // 前三组各一条计数 (1)，message 组一条 (1)
    expect(screen.getAllByText("(1)")).toHaveLength(4);
  });

  it("收藏项渲染：targetId、note（有才显示）、相对时间", async () => {
    mocks.api.mockResolvedValueOnce([FAV_TASK, FAV_DOC]);
    renderList();
    await waitFor(() => expect(screen.getByText("task-9")).toBeInTheDocument());

    expect(screen.getByText("doc-3")).toBeInTheDocument();
    expect(screen.getByText("优先处理")).toBeInTheDocument();
    expect(screen.queryByText("common.favorite:justNow")).toBeInTheDocument();
    expect(screen.getByText('common.favorite:minutesAgo:{"count":1}')).toBeInTheDocument();
  });

  it("点击项：window.open 路由精确（task→/dashboard/tasks/task-9），noopener,noreferrer", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    try {
      mocks.api.mockResolvedValueOnce([FAV_TASK, FAV_DOC]);
      renderList();
      await waitFor(() => expect(screen.getByText("task-9")).toBeInTheDocument());

      fireEvent.click(screen.getByText("task-9"));
      expect(openSpy).toHaveBeenCalledWith(
        "/dashboard/tasks/task-9",
        "_blank",
        "noopener,noreferrer",
      );
      // 另一项不点击不触发
      expect(openSpy).toHaveBeenCalledTimes(1);
    } finally {
      openSpy.mockRestore();
    }
  });

  it("未知 targetType 的收藏不渲染（无对应分组与路由）", async () => {
    mocks.api.mockResolvedValueOnce([{ ...FAV_TASK, id: "fav-x", targetType: "widget" }]);
    renderList();
    await waitFor(() => expect(screen.queryByText("common.favorite:loading")).toBeFalsy());

    expect(screen.queryByText("task-9")).toBeFalsy();
    expect(screen.queryByText("common.favorite:noFavorites")).toBeFalsy(); // 有数据但被过滤，非空态
  });

  it("取消收藏：DELETE /favorites/{id}?wid，行移除 + success toast removed", async () => {
    mocks.api.mockResolvedValueOnce([FAV_TASK]);
    mocks.api.mockResolvedValueOnce(undefined);
    renderList();
    await waitFor(() => expect(screen.getByText("task-9")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("common.favorite:remove"));
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    expect(mocks.api).toHaveBeenLastCalledWith("/api/v1/favorites/fav-1?wid=ws-fl-1", {
      method: "DELETE",
    });
    await waitFor(() => expect(screen.queryByText("task-9")).toBeFalsy());
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith("success", "common.favorite:removed"),
    );
  });

  it("取消收藏失败：toast error，行保留", async () => {
    mocks.api.mockResolvedValueOnce([FAV_TASK]);
    mocks.api.mockRejectedValueOnce(new Error("delete boom"));
    renderList();
    await waitFor(() => expect(screen.getByText("task-9")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("common.favorite:remove"));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("error", "common.favorite:error"));
    expect(screen.getByText("task-9")).toBeInTheDocument();
  });

  it("头部计数 span = 收藏总数", async () => {
    mocks.api.mockResolvedValueOnce([FAV_TASK, FAV_DOC]);
    const { container } = renderList();
    await waitFor(() => expect(screen.getByText("task-9")).toBeInTheDocument());
    expect(container.querySelector("header span")?.textContent).toBe("2");
  });
});
