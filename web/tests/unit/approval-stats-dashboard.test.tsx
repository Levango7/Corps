// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { ApprovalStatsDashboard } from "@/components/approval/ApprovalStatsDashboard";

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

afterEach(() => {
  cleanup();
  apiMock.mockReset();
});

// pendingMine=7 与其余渲染数字（3/4/2/1、2/3/5、30/40/20/10、8/5）无碰撞，便于精确断言
const STATS = {
  total: 10,
  byStatus: { pending: 3, approved: 4, rejected: 2, withdrawn: 1 },
  byPriority: { normal: 5, urgent: 3, critical: 2 },
  byTemplate: [
    { templateId: "t-leave", templateName: "Leave", count: 5 },
    { templateId: "t-budget", templateName: "Budget", count: 8 },
  ],
  avgProcessingHours: 12.345,
  pendingMine: 7,
};

function renderDashboard() {
  return render(<ApprovalStatsDashboard workspaceId="ws-1" />);
}

/** 加载完一笔数据并刷完微任务（注意：显式传 undefined 会命中默认值，不要用本函数测空响应） */
async function renderLoaded(payload: unknown = STATS) {
  apiMock.mockResolvedValue(payload);
  const view = renderDashboard();
  await act(async () => {});
  return view;
}

describe("ApprovalStatsDashboard", () => {
  it("shows the loading state before the first response arrives", () => {
    apiMock.mockImplementation(() => new Promise(() => {}));
    renderDashboard();
    expect(screen.getByText("approval:loading")).toBeInTheDocument();
    // 默认 30d 时间窗：URL 携带 startDate（ISO，自动回退 30 天）
    expect(apiMock).toHaveBeenCalledWith(expect.stringContaining("/approvals/stats?startDate="));
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it("renders the four stat cards with the backend values", async () => {
    await renderLoaded();
    // 四张卡片按序：待我审批 / 已通过 / 已拒绝 / 平均处理时长（保留一位小数并内联单位）
    const cardGrid = document.querySelector('div[class*="lg:grid-cols-4"]')!;
    const values = [...cardGrid.querySelectorAll("p")].map((p) => p.textContent);
    expect(values).toEqual(["7", "4", "2", "12.3approval:hours"]);
  });

  it("renders the passed-through error message when the stats request fails", async () => {
    apiMock.mockRejectedValue(new Error("boom-stats"));
    renderDashboard();
    await act(async () => {});
    expect(screen.getByText("boom-stats")).toBeInTheDocument();
    // 出错后不再停留在加载态
    expect(screen.queryByText("approval:loading")).not.toBeInTheDocument();
  });

  it("falls back to the i18n load-failed copy for non-Error rejections", async () => {
    apiMock.mockRejectedValue("not-an-error");
    renderDashboard();
    await act(async () => {});
    // 错误横幅（span）与无数据空态（p）同时出现
    expect(screen.getByText("approval:statsLoadFailed", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("approval:statsLoadFailed", { selector: "p" })).toBeInTheDocument();
  });

  it("shows the empty state when the response carries no data", async () => {
    // 注意：mockResolvedValue(undefined) 而非走 renderLoaded 默认值
    apiMock.mockResolvedValue(undefined);
    renderDashboard();
    await act(async () => {});
    expect(screen.getByText("approval:statsLoadFailed")).toBeInTheDocument();
    // 空响应不应渲染任何统计卡片
    expect(screen.queryByText("approval:pendingMine")).not.toBeInTheDocument();
  });

  it("re-fetches with a 7-day window and then without a date param for all time", async () => {
    apiMock.mockResolvedValue(STATS);
    renderDashboard();
    await act(async () => {});
    expect(apiMock).toHaveBeenLastCalledWith(expect.stringContaining("startDate="));

    fireEvent.click(screen.getByRole("tab", { name: "approval:last7Days" }));
    await act(async () => {});
    expect(apiMock).toHaveBeenLastCalledWith(expect.stringContaining("startDate="));
    expect(apiMock).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("tab", { name: "approval:allTime" }));
    await act(async () => {});
    // 全部时间不携带 startDate（空查询串保留为 ?）
    expect(apiMock).toHaveBeenLastCalledWith(expect.stringMatching(/\/approvals\/stats\?$/));
    expect(apiMock).toHaveBeenCalledTimes(3);
  });

  it("renders the status distribution bars with counts and percentages", async () => {
    await renderLoaded();
    // 每个非零状态一个条（title 含 i18n 标签 + 计数 + 百分比）
    expect(screen.getByTitle("approval:statusPending: 3 (30%)")).toBeInTheDocument();
    expect(screen.getByTitle("approval:statusApproved: 4 (40%)")).toBeInTheDocument();
    expect(screen.getByTitle("approval:statusRejected: 2 (20%)")).toBeInTheDocument();
    expect(screen.getByTitle("approval:statusWithdrawn: 1 (10%)")).toBeInTheDocument();
    // 图例里同样给出计数与百分比
    expect(screen.getByText("30%")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
  });

  it("skips zero-count statuses in the stacked bar but keeps them in the legend", async () => {
    await renderLoaded({
      ...STATS,
      byStatus: { pending: 0, approved: 4, rejected: 0, withdrawn: 0 },
      total: 4,
    });
    expect(screen.queryByTitle(/statusPending/)).not.toBeInTheDocument();
    expect(screen.getByTitle("approval:statusApproved: 4 (100%)")).toBeInTheDocument();
    // 图例四行都在（含 pending 0；卡片标签同 namespace，须限定在状态分布小节内）
    const section = screen.getByText("approval:statusDistribution").closest("section")!;
    expect([...section.querySelectorAll("span.flex-1.truncate")].map((s) => s.textContent)).toEqual(
      [
        "approval:statusPending",
        "approval:statusApproved",
        "approval:statusRejected",
        "approval:statusWithdrawn",
      ],
    );
  });

  it("shows the empty hint when there are no approvals at all", async () => {
    await renderLoaded({
      ...STATS,
      total: 0,
      byStatus: { pending: 0, approved: 0, rejected: 0, withdrawn: 0 },
    });
    expect(screen.getAllByText("approval:noApprovals").length).toBeGreaterThanOrEqual(1);
  });

  it("renders the priority distribution ordered critical → urgent → normal with relative widths", async () => {
    await renderLoaded();
    const section = screen.getByText("approval:priorityDistribution").closest("section")!;
    const rows = section.querySelectorAll("div.flex.items-center.gap-2");
    expect([...rows].map((r) => r.querySelector("span")?.textContent)).toEqual([
      "approval:priorityCritical",
      "approval:priorityUrgent",
      "approval:priorityNormal",
    ]);
    // 条宽相对最大计数（normal=5 为基准 100%）：critical 2→40% / urgent 3→60% / normal 5→100%
    const widths = [...rows].map(
      (r) => (r.querySelector("div.flex-1")?.firstElementChild as HTMLElement)?.style.width,
    );
    expect(widths).toEqual(["40%", "60%", "100%"]);
  });

  it("shows the empty hint when every priority bucket is zero", async () => {
    await renderLoaded({
      ...STATS,
      byPriority: { normal: 0, urgent: 0, critical: 0 },
    });
    expect(screen.getByText("approval:noApprovals")).toBeInTheDocument();
  });

  it("sorts template usage by count descending and renders rank, name and count", async () => {
    await renderLoaded();
    const section = screen.getByText("approval:templateUsage").closest("section")!;
    const rows = [...section.querySelectorAll("li")].map((li) =>
      [...li.querySelectorAll("span")].map((s) => s.textContent).join(" "),
    );
    // 后端返回 Leave(5) 在前，组件按 count 降序重排为 Budget(8)、Leave(5)
    expect(rows).toEqual(["1 Budget 8", "2 Leave 5"]);
  });

  it("shows the empty template-usage hint when no template was ever used", async () => {
    await renderLoaded({ ...STATS, byTemplate: [] });
    expect(screen.getByText("approval:noTemplateUsage")).toBeInTheDocument();
    expect(screen.queryByText("Budget")).not.toBeInTheDocument();
  });

  it("does not update state after unmount when the response lands later", async () => {
    let resolveStats: (value: unknown) => void = () => {};
    apiMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStats = resolve;
        }),
    );
    const { unmount } = renderDashboard();
    unmount();
    // 卸载后响应到达：cancelled 守卫阻止任何状态更新（无 act 警告/崩溃）
    await act(async () => {
      resolveStats(STATS);
    });
  });
});
