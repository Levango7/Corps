// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";

/**
 * 列表型 Widget 契约（components/dashboard/widgets/{MyTasks,DecisionActions,DueThisWeek,RecentActivity}Widget.tsx）：
 *  - 四者共用同一骨架：useWidgetData(wid, <widgetId>) → loading 骨架 / error 重试 / 空态 / 列表
 *  - 列表上限：MyTasks 全量、其余 slice(0, 8)
 *  - 行内元信息：状态图标 + 截止色（dueMeta）、high/urgent 出 Flag、未读出圆点
 *  - 跳转：任务类 → /w/:wid/task/:id；行动项无 taskId 时退到 /w/:wid/decisions
 */
const h = vi.hoisted(() => ({
  useWidgetData: vi.fn(),
}));

vi.mock("@/components/dashboard/widgets/useWidgetData", () => ({
  useWidgetData: h.useWidgetData,
}));

vi.mock("@/lib/i18n-navigation", async () => {
  const React = await import("react");
  type LinkProps = { href: string; className?: string; children?: React.ReactNode };
  const Link = React.forwardRef<HTMLAnchorElement, LinkProps>((props, ref) =>
    React.createElement("a", { href: props.href, className: props.className, ref }, props.children),
  );
  Link.displayName = "MockLink";
  return { Link };
});

vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}:${key}:${JSON.stringify(vars)}` : `${ns}:${key}`,
}));

import MyTasksWidget from "@/components/dashboard/widgets/MyTasksWidget";
import DecisionActionsWidget from "@/components/dashboard/widgets/DecisionActionsWidget";
import DueThisWeekWidget from "@/components/dashboard/widgets/DueThisWeekWidget";
import RecentActivityWidget from "@/components/dashboard/widgets/RecentActivityWidget";

beforeEach(() => {
  h.useWidgetData.mockReset();
});

describe("MyTasksWidget", () => {
  it("loading：5 行骨架，且按 (wid, my-tasks) 取数", () => {
    h.useWidgetData.mockReturnValue({ data: null, loading: true, error: null, retry: vi.fn() });
    const { container } = render(<MyTasksWidget wid="w1" />);
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(container.querySelectorAll(".shimmer").length).toBe(5);
    expect(h.useWidgetData).toHaveBeenCalledWith("w1", "my-tasks");
  });

  it("error：显示错误文案并转发 retry", () => {
    const retry = vi.fn();
    h.useWidgetData.mockReturnValue({ data: null, loading: false, error: "boom", retry });
    const { getByText } = render(<MyTasksWidget wid="w1" />);
    expect(getByText("dashboard:loadFailed")).toBeTruthy();
    expect(getByText("boom")).toBeTruthy();
    fireEvent.click(getByText("button:retry"));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("空列表：走空态文案", () => {
    h.useWidgetData.mockReturnValue({
      data: { items: [] },
      loading: false,
      error: null,
      retry: vi.fn(),
    });
    const { getByText } = render(<MyTasksWidget wid="w1" />);
    expect(getByText("dashboard:myTasksEmpty")).toBeTruthy();
  });

  it("有数据：done 划线、high/urgent 出 Flag、逾期走 danger 色、链接指向任务详情", () => {
    h.useWidgetData.mockReturnValue({
      data: {
        items: [
          {
            id: "t1",
            title: "已完成任务",
            status: "done",
            priority: "low",
            dueDate: "2000-01-01T00:00:00.000Z",
          },
          { id: "t2", title: "紧急任务", status: "todo", priority: "urgent", dueDate: null },
        ],
      },
      loading: false,
      error: null,
      retry: vi.fn(),
    });
    const { container, getByText } = render(<MyTasksWidget wid="w1" />);

    const first = getByText("已完成任务");
    expect(first.className).toContain("line-through");
    expect(first.className).toContain("text-[var(--muted)]");
    // 逾期：danger 色 + 只有 high/urgent 才出 Flag
    const overdue = container.querySelector("span[style*='--danger']");
    expect(overdue).toBeTruthy();
    expect(overdue?.textContent).toMatch(/^time:overdueDays/);
    expect(container.querySelectorAll("svg.lucide-flag").length).toBe(1);

    const links = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(links).toEqual(["/w/w1/task/t1", "/w/w1/task/t2"]);
  });
});

describe("DecisionActionsWidget", () => {
  it("loading：4 行骨架", () => {
    h.useWidgetData.mockReturnValue({ data: null, loading: true, error: null, retry: vi.fn() });
    const { container } = render(<DecisionActionsWidget wid="w2" />);
    expect(container.querySelectorAll(".shimmer").length).toBe(4);
    expect(h.useWidgetData).toHaveBeenCalledWith("w2", "decision-actions");
  });

  it("空列表：走空态文案", () => {
    h.useWidgetData.mockReturnValue({
      data: { items: [] },
      loading: false,
      error: null,
      retry: vi.fn(),
    });
    const { getByText } = render(<DecisionActionsWidget wid="w2" />);
    expect(getByText("dashboard:decisionActionsEmpty")).toBeTruthy();
  });

  it("有数据：有 taskId 跳任务、无 taskId 退决策页；超过 8 条只渲染 8 条", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      id: `a${i}`,
      title: `行动项 ${i}`,
      checked: false,
      priority: i === 0 ? ("urgent" as const) : ("low" as const),
      dueDate: null,
      decisionId: "d1",
      taskId: i === 1 ? "t9" : null,
    }));
    h.useWidgetData.mockReturnValue({
      data: { items },
      loading: false,
      error: null,
      retry: vi.fn(),
    });
    const { container, getByText } = render(<DecisionActionsWidget wid="w2" />);

    expect(container.querySelectorAll("li").length).toBe(8);
    expect(getByText("行动项 0")).toBeTruthy();
    const links = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(links[0]).toBe("/w/w2/decisions");
    expect(links[1]).toBe("/w/w2/task/t9");
    expect(container.querySelectorAll("svg.lucide-flag").length).toBe(1);
  });
});

describe("DueThisWeekWidget", () => {
  it("loading：4 行骨架 + 空态", () => {
    h.useWidgetData.mockReturnValue({ data: null, loading: true, error: null, retry: vi.fn() });
    const { container, rerender } = render(<DueThisWeekWidget wid="w3" />);
    expect(container.querySelectorAll(".shimmer").length).toBe(4);
    expect(h.useWidgetData).toHaveBeenCalledWith("w3", "due-this-week");

    h.useWidgetData.mockReturnValue({
      data: { items: [] },
      loading: false,
      error: null,
      retry: vi.fn(),
    });
    rerender(<DueThisWeekWidget wid="w3" />);
    expect(container.textContent).toContain("dashboard:dueThisWeekEmpty");
  });

  it("有数据：截止时间带日历图标，urgent 出 Flag，最多 8 条", () => {
    const items = Array.from({ length: 9 }, (_, i) => ({
      id: `t${i}`,
      title: `本周任务 ${i}`,
      status: "todo" as const,
      priority: i === 0 ? ("high" as const) : ("medium" as const),
      dueDate: "2000-01-03T00:00:00.000Z",
    }));
    h.useWidgetData.mockReturnValue({
      data: { items, weekStart: "2000-01-01", weekEnd: "2000-01-07" },
      loading: false,
      error: null,
      retry: vi.fn(),
    });
    const { container } = render(<DueThisWeekWidget wid="w3" />);

    expect(container.querySelectorAll("li").length).toBe(8);
    expect(container.querySelector("svg.lucide-calendar-clock")).toBeTruthy();
    expect(container.querySelectorAll("svg.lucide-flag").length).toBe(1);
  });
});

describe("RecentActivityWidget", () => {
  it("loading：5 行骨架", () => {
    h.useWidgetData.mockReturnValue({ data: null, loading: true, error: null, retry: vi.fn() });
    const { container } = render(<RecentActivityWidget wid="w4" />);
    expect(container.querySelectorAll(".shimmer").length).toBe(5);
    expect(h.useWidgetData).toHaveBeenCalledWith("w4", "recent-activity");
  });

  it("空列表：走空态文案", () => {
    h.useWidgetData.mockReturnValue({
      data: { items: [] },
      loading: false,
      error: null,
      retry: vi.fn(),
    });
    const { getByText } = render(<RecentActivityWidget wid="w4" />);
    expect(getByText("dashboard:recentActivityEmpty")).toBeTruthy();
  });

  it("有数据：未读加粗 + 圆点、已读灰化、按类型出图标、最多 8 条", () => {
    // 前两条分别用 mention / task_assigned 校验图标映射，其余统一 comment_added
    const TYPES = ["mention", "task_assigned", "comment_added"] as const;
    const items = Array.from({ length: 9 }, (_, i) => ({
      id: `n${i}`,
      type: TYPES[i < 2 ? i : 2],
      entityId: `t${i}`,
      entityTitle: `通知 ${i}`,
      read: i > 1,
      createdAt: new Date(Date.now() - 60_000).toISOString(),
    }));
    h.useWidgetData.mockReturnValue({
      data: { items },
      loading: false,
      error: null,
      retry: vi.fn(),
    });
    const { container, getByText } = render(<RecentActivityWidget wid="w4" />);

    expect(container.querySelectorAll("li").length).toBe(8);
    expect(getByText("通知 0").className).toContain("text-[var(--fg)]");
    expect(getByText("通知 2").className).toContain("text-[var(--muted)]");
    // 未读圆点只在两条未读上出现
    expect(container.querySelectorAll("span.rounded-full.bg-\\[var\\(--accent\\)\\]").length).toBe(
      2,
    );
    expect(container.querySelector("svg.lucide-at-sign")).toBeTruthy();
    expect(container.querySelector("svg.lucide-user-plus")).toBeTruthy();
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/w/w4/task/t0");
  });

  it("error 分支：无 data 时也走 WidgetError", () => {
    const retry = vi.fn();
    h.useWidgetData.mockReturnValue({ data: null, loading: false, error: null, retry });
    const { getByText } = render(<RecentActivityWidget wid="w4" />);
    expect(getByText("dashboard:loadFailed")).toBeTruthy();
    fireEvent.click(getByText("button:retry"));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
