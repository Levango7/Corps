// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * TodoCenter 契约（components/todo/TodoCenter.tsx，default 导出）：
 *  1. 挂载并行 GET /todos?...type=all&status=pending&limit=50 与 /todos/count
 *  2. 头部 title + 总数；统计区四类分布
 *  3. 过滤标签 5 个，点 tab 重拉对应 type；点当前 tab 不重拉
 *  4. loading / error（可关闭）/ 空态三分支
 *  5. 列表项：标题、描述、截止日期（相对时间/overdue）、优先级标签、状态标签
 *  6. 点标题按钮 → window.open(sourceUrl, _blank, noopener,noreferrer)
 *  7. workspaceId 变化重拉
 */

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  open: vi.fn(),
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

import TodoCenter from "@/components/todo/TodoCenter";

const WID = "ws-tc-1";
const LIST_URL = (type: string, wid = WID) =>
  `/api/v1/todos?workspaceId=${wid}&type=${type}&status=pending&limit=50`;
const COUNT_URL = (wid = WID) => `/api/v1/todos/count?workspaceId=${wid}`;

function todo(overrides: Record<string, unknown> = {}) {
  return {
    id: "t-1",
    type: "task",
    title: "写季度报告",
    description: "汇总 Q4 数据",
    dueDate: undefined,
    priority: undefined,
    sourceUrl: "/w/ws-tc-1/tasks/t-1",
    status: "pending",
    createdAt: "2026-11-01T00:00:00Z",
    ...overrides,
  };
}

const COUNT = {
  total: 6,
  byType: { task: 3, approval: 1, meeting: 1, document: 1 },
};

const API_OK = (items: unknown[] = [todo()]) => {
  mocks.api.mockResolvedValueOnce(items).mockResolvedValueOnce(COUNT);
};

beforeEach(() => {
  mocks.api.mockReset();
  mocks.open.mockReset();
  vi.stubGlobal("open", mocks.open);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("TodoCenter", () => {
  it("挂载并行拉列表（type=all）与计数，URL 精确", async () => {
    API_OK();
    render(<TodoCenter workspaceId={WID} />);

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    expect(mocks.api).toHaveBeenCalledWith(LIST_URL("all"), { signal: expect.any(AbortSignal) });
    expect(mocks.api).toHaveBeenCalledWith(COUNT_URL(), { signal: expect.any(AbortSignal) });
  });

  it("头部 title + 总数；统计区四类分布", async () => {
    API_OK();
    render(<TodoCenter workspaceId={WID} />);

    await waitFor(() => expect(screen.getByText(/todo:count/)).toBeInTheDocument());
    expect(screen.getByText("todo:title")).toBeInTheDocument();
    // 类型标签在统计区与过滤标签各出现一次
    expect(screen.getAllByText("todo:typeTask").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("todo:typeApproval").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("todo:typeMeeting").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("todo:typeDocument").length).toBeGreaterThanOrEqual(2);
    // 过滤标签「全部」计数 = 总数 6（唯一出现）
    expect(screen.getByText("6")).toBeInTheDocument();
  });

  it("过滤标签：全部/任务/审批/会议/文档，切换重拉对应 type", async () => {
    // 重拉会同时打列表与计数两个端点，按 URL 分流保证响应形状合法
    // （兜底 mock 返回 {items,total} 会污染计数端点 → count.byType undefined 渲染崩）
    mocks.api.mockImplementation((url: string) =>
      Promise.resolve(url.includes("/count") ? COUNT : [todo()]),
    );
    render(<TodoCenter workspaceId={WID} />);
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));

    const taskTab = screen.getByRole("button", { name: /todo:typeTask/ });
    fireEvent.click(taskTab);
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith(LIST_URL("task"), { signal: expect.any(AbortSignal) }),
    );
    // 计数同时重拉
    expect(mocks.api).toHaveBeenCalledWith(COUNT_URL(), { signal: expect.any(AbortSignal) });
  });

  it("点当前过滤标签不重拉", async () => {
    API_OK();
    render(<TodoCenter workspaceId={WID} />);
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole("button", { name: /todo:filterAll/ }));
    expect(mocks.api).toHaveBeenCalledTimes(2);
  });

  it("loading 态显示 loading 文案", () => {
    mocks.api.mockImplementation(() => new Promise(() => {}));
    render(<TodoCenter workspaceId={WID} />);
    expect(screen.getByText("todo:loading")).toBeInTheDocument();
  });

  it("加载失败 → error 文案；点关闭按钮清除错误", async () => {
    mocks.api.mockRejectedValueOnce(new Error("boom"));
    mocks.api.mockResolvedValueOnce(COUNT);
    render(<TodoCenter workspaceId={WID} />);

    await waitFor(() => expect(screen.getByText("todo:error")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("todo:close"));
    expect(screen.queryByText("todo:error")).toBeFalsy();
  });

  it("空列表 → 空态文案", async () => {
    API_OK([]);
    render(<TodoCenter workspaceId={WID} />);
    await waitFor(() => expect(screen.getByText("todo:noTodos")).toBeInTheDocument());
  });

  it("列表项：标题/描述/状态标签/优先级标签全部渲染", async () => {
    API_OK([
      todo({ id: "t-1", priority: "urgent", title: "紧急审批" }),
      todo({
        id: "t-2",
        type: "approval",
        priority: "low",
        title: "低优先",
        description: "另一条描述",
      }),
    ]);
    render(<TodoCenter workspaceId={WID} />);

    await waitFor(() => expect(screen.getByText("紧急审批")).toBeInTheDocument());
    expect(screen.getByText("todo:high")).toBeInTheDocument(); // urgent → high
    expect(screen.getByText("todo:low")).toBeInTheDocument();
    // pending 状态标签（两行都是 pending）
    expect(screen.getAllByText("todo:pending")).toHaveLength(2);
    expect(screen.getByText("汇总 Q4 数据")).toBeInTheDocument();
  });

  it("completed 状态显示 completed 标签", async () => {
    API_OK([todo({ status: "completed" })]);
    render(<TodoCenter workspaceId={WID} />);
    await waitFor(() => expect(screen.getByText("todo:completed")).toBeInTheDocument());
    expect(screen.queryByText("todo:pending")).toBeFalsy();
  });

  it("截止日期：dueDate 存在渲染 dueDate 标签与相对时间", async () => {
    // 固定 Date.now 而非 fake timers：waitFor 依赖真时钟，fake timers 会死等
    const NOW = new Date("2026-11-05T12:00:00Z").getTime();
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    API_OK([todo({ dueDate: new Date(NOW + 3 * 3_600_000).toISOString() })]);
    render(<TodoCenter workspaceId={WID} />);

    await waitFor(() => expect(screen.getByText(/todo:dueDate/)).toBeInTheDocument());
    // 截止日期 span 内是「dueDate 标签: 相对时间」拼接文本，用正则匹配
    expect(screen.getByText(/todo:hoursLater/)).toBeInTheDocument();
  });

  it("过期日标红（overdue 类）", async () => {
    const NOW = new Date("2026-11-05T12:00:00Z").getTime();
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    API_OK([todo({ dueDate: new Date(NOW - 30 * 60_000).toISOString() })]);
    const { container } = render(<TodoCenter workspaceId={WID} />);

    await waitFor(() => expect(screen.getByText(/todo:overdue/)).toBeInTheDocument());
    expect(container.innerHTML).toContain("text-[var(--danger)]");
  });

  it("点标题跳转 → window.open(sourceUrl, _blank, noopener,noreferrer)", async () => {
    API_OK([todo({ sourceUrl: "/w/ws-tc-1/tasks/t-9" })]);
    render(<TodoCenter workspaceId={WID} />);
    await waitFor(() => expect(screen.getByText("写季度报告")).toBeInTheDocument());

    fireEvent.click(screen.getByText("写季度报告"));
    expect(mocks.open).toHaveBeenCalledWith(
      "/w/ws-tc-1/tasks/t-9",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("workspaceId 变化 → 按新 wid 重拉（URL 编码）", async () => {
    API_OK();
    const { rerender } = render(<TodoCenter workspaceId={WID} />);
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));

    mocks.api.mockResolvedValueOnce([]).mockResolvedValueOnce({
      total: 0,
      byType: { task: 0, approval: 0, meeting: 0, document: 0 },
    });
    rerender(<TodoCenter workspaceId="ws x/2" />);
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith(LIST_URL("all", "ws%20x%2F2"), {
        signal: expect.any(AbortSignal),
      }),
    );
    expect(mocks.api).toHaveBeenCalledWith(COUNT_URL("ws%20x%2F2"), {
      signal: expect.any(AbortSignal),
    });
  });
});
