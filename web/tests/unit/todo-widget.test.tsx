// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * TodoWidget 契约（components/todo/TodoWidget.tsx，default 导出）：
 *  1. 挂载并行 GET /todos?...limit=5 与 /todos/count（workspaceId 做 encodeURIComponent）
 *  2. 头部 today + 总数；loading / error / 空态
 *  3. 列表项：类型图标、标题、截止日期相对时间（dueSoon/hoursLater/overdue/daysLater/daysAgo/具体日期）
 *  4. 点行 → window.open(sourceUrl)；底部 viewAll 仅 count>0 且非 loading/error 时显示
 *  5. viewAll：有 onViewAll 回调时调回调，否则 window.open("/dashboard/todos")
 */

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  open: vi.fn(),
  onViewAll: vi.fn(),
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

import TodoWidget from "@/components/todo/TodoWidget";

const WID = "ws-tw-1";
const LIST_URL = (wid = WID) =>
  `/api/v1/todos?workspaceId=${encodeURIComponent(wid)}&type=all&status=pending&limit=5`;
const COUNT_URL = (wid = WID) => `/api/v1/todos/count?workspaceId=${encodeURIComponent(wid)}`;

function todo(overrides: Record<string, unknown> = {}) {
  return {
    id: "t-1",
    type: "task",
    title: "写季度报告",
    description: "描述",
    dueDate: undefined,
    priority: "high",
    sourceUrl: "/w/ws-tw-1/tasks/t-1",
    status: "pending",
    createdAt: "2026-11-01T00:00:00Z",
    ...overrides,
  };
}

const OK = (items: unknown[] = [todo()], total = 4) => {
  mocks.api.mockResolvedValueOnce(items).mockResolvedValueOnce({
    total,
    byType: { task: total, approval: 0, meeting: 0, document: 0 },
  });
};

beforeEach(() => {
  mocks.api.mockReset();
  mocks.open.mockReset();
  mocks.onViewAll.mockReset();
  vi.stubGlobal("open", mocks.open);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("TodoWidget", () => {
  it("挂载并行拉 limit=5 列表与计数（URL 精确）", async () => {
    OK();
    render(<TodoWidget workspaceId={WID} />);

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    expect(mocks.api).toHaveBeenCalledWith(LIST_URL(), { signal: expect.any(AbortSignal) });
    expect(mocks.api).toHaveBeenCalledWith(COUNT_URL(), { signal: expect.any(AbortSignal) });
  });

  it("头部 today 文案与总数", async () => {
    OK([todo()], 7);
    render(<TodoWidget workspaceId={WID} />);
    await waitFor(() => expect(screen.getByText("todo:today")).toBeInTheDocument());
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("loading 态 → loading 文案", () => {
    mocks.api.mockImplementation(() => new Promise(() => {}));
    render(<TodoWidget workspaceId={WID} />);
    expect(screen.getByText("todo:loading")).toBeInTheDocument();
  });

  it("加载失败 → error 文案（包裹在容器 aria-label=todo:title）", async () => {
    mocks.api.mockRejectedValueOnce(new Error("boom"));
    mocks.api.mockResolvedValueOnce({
      total: 0,
      byType: { task: 0, approval: 0, meeting: 0, document: 0 },
    });
    render(<TodoWidget workspaceId={WID} />);

    await waitFor(() => expect(screen.getByText("todo:error")).toBeInTheDocument());
    expect(screen.getByLabelText("todo:title")).toBeInTheDocument();
  });

  it("空列表 → 空态且不显示 viewAll", async () => {
    OK([], 0);
    render(<TodoWidget workspaceId={WID} />);
    await waitFor(() => expect(screen.getByText("todo:noTodos")).toBeInTheDocument());
    expect(screen.queryByText("todo:viewAll")).toBeFalsy();
  });

  it("类型图标按 type 切换（task/approval/meeting/document）", async () => {
    OK(
      [
        todo({ id: "1", type: "task", title: "任务行" }),
        todo({ id: "2", type: "approval", title: "审批行" }),
        todo({ id: "3", type: "meeting", title: "会议行" }),
        todo({ id: "4", type: "document", title: "文档行" }),
      ],
      4,
    );
    render(<TodoWidget workspaceId={WID} />);
    await waitFor(() => expect(screen.getByText("任务行")).toBeInTheDocument());

    // 每行是一个带图标的 button；lucide 不同版本类名不同，按行内 svg 存在断言
    for (const title of ["任务行", "审批行", "会议行", "文档行"]) {
      const row = screen.getByText(title).closest("button")!;
      expect(row.querySelector("svg")).toBeTruthy();
    }
  });

  it("截止日期：30 分钟内 dueSoon；3 小时 hoursLater", async () => {
    const NOW = new Date("2026-11-05T12:00:00Z").getTime();
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    OK([
      todo({ id: "a", dueDate: new Date(NOW + 20 * 60_000).toISOString() }),
      todo({ id: "b", dueDate: new Date(NOW + 3 * 3_600_000).toISOString() }),
    ]);
    render(<TodoWidget workspaceId={WID} />);

    await waitFor(() => expect(screen.getByText("todo:dueSoon")).toBeInTheDocument());
    expect(screen.getByText('todo:hoursLater:{"count":3}')).toBeInTheDocument();
  });

  it("截止日期：已过期 → overdue；未来 3 天 daysLater；过去 3 天 daysAgo", async () => {
    const NOW = new Date("2026-11-05T12:00:00Z").getTime();
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    OK([
      todo({ id: "a", dueDate: new Date(NOW - 30 * 60_000).toISOString() }),
      todo({ id: "b", dueDate: new Date(NOW + 3 * 86_400_000).toISOString() }),
      todo({ id: "c", dueDate: new Date(NOW - 3 * 86_400_000).toISOString() }),
    ]);
    render(<TodoWidget workspaceId={WID} />);

    await waitFor(() => expect(screen.getByText("todo:overdue")).toBeInTheDocument());
    expect(screen.getByText('todo:daysLater:{"count":3}')).toBeInTheDocument();
    expect(screen.getByText('todo:daysAgo:{"count":3}')).toBeInTheDocument();
  });

  it("超过 7 天 → 具体日期（toLocaleDateString）", async () => {
    const NOW = new Date("2026-11-05T12:00:00Z").getTime();
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const far = new Date(NOW + 15 * 86_400_000);
    OK([todo({ dueDate: far.toISOString() })]);
    render(<TodoWidget workspaceId={WID} />);

    await waitFor(() => expect(screen.getByText(far.toLocaleDateString())).toBeInTheDocument());
  });

  it("点行 → window.open(sourceUrl, _blank, noopener,noreferrer)", async () => {
    OK([todo({ sourceUrl: "/w/ws-tw-1/documents/d-1" })]);
    render(<TodoWidget workspaceId={WID} />);
    await waitFor(() => expect(screen.getByText("写季度报告")).toBeInTheDocument());

    fireEvent.click(screen.getByText("写季度报告"));
    expect(mocks.open).toHaveBeenCalledWith(
      "/w/ws-tw-1/documents/d-1",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("viewAll 有回调 → 调 onViewAll 不 open", async () => {
    OK([todo()], 3);
    render(<TodoWidget workspaceId={WID} onViewAll={mocks.onViewAll} />);
    await waitFor(() => expect(screen.getByText("todo:viewAll")).toBeInTheDocument());

    fireEvent.click(screen.getByText("todo:viewAll"));
    expect(mocks.onViewAll).toHaveBeenCalledTimes(1);
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it("viewAll 无回调 → window.open(/dashboard/todos)", async () => {
    OK([todo()], 3);
    render(<TodoWidget workspaceId={WID} />);
    await waitFor(() => expect(screen.getByText("todo:viewAll")).toBeInTheDocument());

    fireEvent.click(screen.getByText("todo:viewAll"));
    expect(mocks.open).toHaveBeenCalledWith("/dashboard/todos", "_blank", "noopener,noreferrer");
  });

  it("count=0 时即使有列表也不显示 viewAll", async () => {
    OK([todo()], 0);
    render(<TodoWidget workspaceId={WID} />);
    await waitFor(() => expect(screen.getByText("写季度报告")).toBeInTheDocument());
    expect(screen.queryByText("todo:viewAll")).toBeFalsy();
  });

  it("workspaceId 含特殊字符 → URL 编码；wid 变化重拉", async () => {
    OK();
    const { rerender } = render(<TodoWidget workspaceId="ws a/1" />);
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    expect(mocks.api).toHaveBeenCalledWith(LIST_URL("ws a/1"), { signal: expect.any(AbortSignal) });

    mocks.api.mockResolvedValueOnce([]).mockResolvedValueOnce({
      total: 0,
      byType: { task: 0, approval: 0, meeting: 0, document: 0 },
    });
    rerender(<TodoWidget workspaceId="ws-b" />);
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith(LIST_URL("ws-b"), { signal: expect.any(AbortSignal) }),
    );
    expect(mocks.api).toHaveBeenCalledWith(COUNT_URL("ws-b"), { signal: expect.any(AbortSignal) });
  });
});
