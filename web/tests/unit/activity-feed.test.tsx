// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";

/**
 * ActivityFeed 契约（components/ActivityFeed.tsx，default 导出）：
 *  1. 挂载 GET /api/v1/workspaces/{wid}/activity（裸路径，无 signal）
 *  2. loading → 骨架（aria-busy + aria-label activity:loading）
 *  3. 失败且无数据 → role=status 显示 loadFailed + 重试按钮；重试可再拉
 *  4. 头部：activity:title + 手动刷新按钮（refreshing 时禁用+旋转）
 *  5. 列表 role=feed：类型图标（5 类映射）、actorName 回退 unknownUser、
 *     动作文案 labelKey、entityTitle、time dateTime + 相对时间（zh：刚刚/N 分钟前/N 小时前/N 天前）
 *  6. 空列表 → activity:empty
 *  7. limit 截断显示条数
 *  8. autoRefresh=true 每 30s 重拉；false 不挂定时器
 */

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
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
  return { useTranslations, useLocale: () => "zh" };
});
vi.mock("@/lib/api", () => ({ api: mocks.api }));

import ActivityFeed from "@/components/ActivityFeed";

const WID = "ws-actf-1";
const URL = `/api/v1/workspaces/${WID}/activity`;

function activity(overrides: Record<string, unknown> = {}) {
  return {
    id: "act-1",
    type: "task.created",
    actorId: "u-1",
    actorName: "Alice",
    entityType: "task",
    entityId: "t-1",
    entityTitle: "上线准备",
    createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    ...overrides,
  };
}

function renderFeed(props: Record<string, unknown> = {}) {
  return render(<ActivityFeed wid={WID} {...props} />);
}

beforeEach(() => {
  mocks.api.mockReset();
  mocks.api.mockResolvedValue({ items: [], nextCursor: null });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ActivityFeed", () => {
  it("挂载 GET（URL 精确、无 options）；loading 期骨架 aria-busy", async () => {
    mocks.api.mockImplementationOnce(() => new Promise(() => {}));
    renderFeed();

    expect(mocks.api).toHaveBeenCalledWith(URL);
    const skeleton = screen.getByLabelText("activity:loading");
    expect(skeleton).toHaveAttribute("aria-busy", "true");
  });

  it("成功：头部标题 + role=feed 列表，行含 操作者/动作/对象/时间", async () => {
    const createdAt = new Date(Date.now() - 5 * 60_000).toISOString();
    mocks.api.mockResolvedValueOnce({ items: [activity({ createdAt })], nextCursor: null });
    renderFeed();

    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
    expect(screen.getByRole("feed", { name: "activity:title" })).toBeInTheDocument();
    expect(screen.getByText("activity:taskCreated")).toBeInTheDocument();
    expect(screen.getByText("上线准备")).toBeInTheDocument();
    const time = screen.getByText("5 分钟前");
    expect(time).toHaveAttribute("dateTime", createdAt);
  });

  it("actorName 为 null → unknownUser 回退", async () => {
    mocks.api.mockResolvedValueOnce({ items: [activity({ actorName: null })], nextCursor: null });
    renderFeed();
    await waitFor(() => expect(screen.getByText("activity:unknownUser")).toBeInTheDocument());
  });

  it("五类活动图标映射（plus/message-square/git-branch 稳定断言）", async () => {
    mocks.api.mockResolvedValueOnce({
      items: [
        activity({ id: "1", type: "task.created" }),
        activity({ id: "2", type: "comment.created" }),
        activity({ id: "3", type: "decision.created" }),
        activity({ id: "4", type: "decision.updated" }),
      ],
      nextCursor: null,
    });
    const { container } = renderFeed();

    await waitFor(() => expect(screen.getByText("activity:decisionUpdated")).toBeInTheDocument());
    expect(container.querySelector("svg.lucide-plus")).toBeTruthy();
    expect(container.querySelector("svg.lucide-message-square")).toBeTruthy();
    // 决策两态同用 GitBranch
    expect(container.querySelectorAll("svg.lucide-git-branch").length).toBeGreaterThanOrEqual(2);
  });

  it("相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前", async () => {
    const NOW = Date.now();
    const spy = vi.spyOn(Date, "now").mockReturnValue(NOW);
    mocks.api.mockResolvedValueOnce({
      items: [
        activity({ id: "1", createdAt: new Date(NOW - 10_000).toISOString() }),
        activity({ id: "2", createdAt: new Date(NOW - 3 * 60_000).toISOString() }),
        activity({ id: "3", createdAt: new Date(NOW - 5 * 3_600_000).toISOString() }),
        activity({ id: "4", createdAt: new Date(NOW - 2 * 86_400_000).toISOString() }),
      ],
      nextCursor: null,
    });
    renderFeed();

    await waitFor(() => expect(screen.getByText("刚刚")).toBeInTheDocument());
    expect(screen.getByText("3 分钟前")).toBeInTheDocument();
    expect(screen.getByText("5 小时前")).toBeInTheDocument();
    expect(screen.getByText("2 天前")).toBeInTheDocument();
    spy.mockRestore();
  });

  it("空列表 → activity:empty，不渲染 feed 角色", async () => {
    renderFeed();
    await waitFor(() => expect(screen.getByText("activity:empty")).toBeInTheDocument());
    expect(screen.queryByRole("feed")).toBeFalsy();
  });

  it("失败且无数据 → loadFailed + 重试按钮可再拉", async () => {
    mocks.api.mockRejectedValueOnce(new Error("boom"));
    renderFeed();

    await waitFor(() => expect(screen.getByText("activity:loadFailed")).toBeInTheDocument());
    expect(screen.getByRole("status")).toBeInTheDocument();

    mocks.api.mockResolvedValueOnce({ items: [activity()], nextCursor: null });
    // 错误分支的重试按钮没有 aria-label，accessible name 来自按钮文本
    fireEvent.click(screen.getByRole("button", { name: "activity:refresh" }));
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
  });

  it("手动刷新按钮：refreshing 期禁用；成功后恢复", async () => {
    renderFeed();
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("activity:title")).toBeInTheDocument());
    cleanup();

    mocks.api.mockResolvedValueOnce({ items: [activity()], nextCursor: null });
    renderFeed();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    let resolveSecond!: (v: unknown) => void;
    mocks.api.mockImplementationOnce(() => new Promise((r) => (resolveSecond = r)));
    const btn = screen.getByLabelText("activity:refresh");
    fireEvent.click(btn);
    await waitFor(() => expect(btn).toBeDisabled());
    resolveSecond({ items: [activity()], nextCursor: null });
    await waitFor(() => expect(btn).not.toBeDisabled());
  });

  it("limit 截断显示条数", async () => {
    mocks.api.mockResolvedValueOnce({
      items: [1, 2, 3, 4, 5].map((i) => activity({ id: `a-${i}` })),
      nextCursor: null,
    });
    renderFeed({ limit: 3 });
    await waitFor(() => expect(screen.getByRole("feed")).toBeInTheDocument());
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("autoRefresh=false → 30s 后不重拉", async () => {
    vi.useFakeTimers();
    renderFeed({ autoRefresh: false });
    await act(async () => {});
    expect(mocks.api).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(mocks.api).toHaveBeenCalledTimes(1);
  });

  it("autoRefresh=true（默认）→ 每 30s 重拉", async () => {
    vi.useFakeTimers();
    renderFeed();
    await act(async () => {});
    expect(mocks.api).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(mocks.api).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(mocks.api).toHaveBeenCalledTimes(3);
  });

  it("卸载后定时器清理（advance 不再触发请求）", async () => {
    vi.useFakeTimers();
    const { unmount } = renderFeed();
    await act(async () => {});
    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    });
    expect(mocks.api).toHaveBeenCalledTimes(1);
  });
});
