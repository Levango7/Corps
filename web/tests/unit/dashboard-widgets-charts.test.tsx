// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

/**
 * 图表型 Widget 契约（components/dashboard/widgets/{Burndown,PriorityDist,Gantt,MilestoneTimeline,CustomChart}Widget.tsx）：
 *  - 全部纯内联 SVG，不引第三方图表库；色值走 design token（不出现裸 hex）
 *  - Burndown：面积渐变 + 理想虚线 + 实际折线 + 每点一个 circle；单点时不除零
 *  - PriorityDist：四档图例 + 百分比取整；某档 = total 时画 circle 而非 path
 *  - Gantt：时间轴按最早/最晚归一化，长标题截断带省略号，done 降透明度
 *  - Milestone：三种状态节点形状不同（done 实心 / in_progress 小实心 / pending 空心），无日期显示占位
 *  - CustomChart：bar/line/pie 三分支 + 未知类型回退柱状
 */
const h = vi.hoisted(() => ({ useWidgetData: vi.fn() }));

vi.mock("@/components/dashboard/widgets/useWidgetData", () => ({
  useWidgetData: h.useWidgetData,
}));

vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}:${key}:${JSON.stringify(vars)}` : `${ns}:${key}`,
}));

import BurndownWidget from "@/components/dashboard/widgets/BurndownWidget";
import PriorityDistWidget from "@/components/dashboard/widgets/PriorityDistWidget";
import GanttWidget from "@/components/dashboard/widgets/GanttWidget";
import MilestoneTimelineWidget from "@/components/dashboard/widgets/MilestoneTimelineWidget";
import CustomChartWidget from "@/components/dashboard/widgets/CustomChartWidget";

const ready = (data: unknown) => ({ data, loading: false, error: null, retry: vi.fn() });

beforeEach(() => {
  h.useWidgetData.mockReset();
});

describe("BurndownWidget", () => {
  it("loading：6 行骨架；空 days：空态文案", () => {
    h.useWidgetData.mockReturnValue({ data: null, loading: true, error: null, retry: vi.fn() });
    const { container, rerender } = render(<BurndownWidget wid="w1" />);
    expect(container.querySelectorAll(".shimmer").length).toBe(6);
    expect(h.useWidgetData).toHaveBeenCalledWith("w1", "burndown");

    h.useWidgetData.mockReturnValue(ready({ days: [], totalTasks: 0 }));
    rerender(<BurndownWidget wid="w1" />);
    expect(container.textContent).toContain("dashboard:burndownEmpty");
  });

  it("多日数据：网格线 3 条、面积+折线两条 path、每点一个 circle、理想线虚线、X 轴只取首中末", () => {
    h.useWidgetData.mockReturnValue(
      ready({
        days: [
          { date: "2026-10-01", total: 10, done: 1, remaining: 9 },
          { date: "2026-10-08", total: 10, done: 6, remaining: 4 },
          { date: "2026-10-15", total: 10, done: 10, remaining: 0 },
        ],
        totalTasks: 10,
      }),
    );
    const { container } = render(<BurndownWidget wid="w1" />);

    const svg = container.querySelector('svg[role="img"]');
    expect(svg?.getAttribute("aria-label")).toBe("dashboard:burndown");
    // 3 条网格线 + 1 条理想线
    expect(container.querySelectorAll("line").length).toBe(4);
    expect(container.querySelectorAll("path").length).toBe(2);
    expect(container.querySelectorAll("circle").length).toBe(3);
    // 理想线用虚线（strokeDasharray="4 4"）
    expect(container.querySelector('line[stroke-dasharray="4 4"]')).toBeTruthy();
    // 面积填充引用本实例唯一渐变
    const gradId = container.querySelector("linearGradient")?.getAttribute("id");
    expect(gradId).toMatch(/^burndown-area-/);
    expect(container.querySelector("path[fill^='url(#burndown-area-']")).toBeTruthy();
    // X 轴标签：首/中/末三条，内容为 MM-DD
    const texts = Array.from(container.querySelectorAll("text")).map((t) => t.textContent);
    expect(texts.filter((t) => /^\d{2}-\d{2}$/.test(t ?? ""))).toEqual(["10-01", "10-08", "10-15"]);
    // Y 轴最大值
    expect(texts).toContain("9");
  });

  it("单点数据：不除零且只渲染一个标签", () => {
    h.useWidgetData.mockReturnValue(
      ready({ days: [{ date: "2026-10-01", total: 5, done: 0, remaining: 5 }], totalTasks: 5 }),
    );
    const { container } = render(<BurndownWidget wid="w1" />);
    expect(container.querySelectorAll("circle").length).toBe(1);
    const labels = Array.from(container.querySelectorAll("text")).filter((t) =>
      /^\d{2}-\d{2}$/.test(t.textContent ?? ""),
    );
    expect(labels.length).toBe(1);
  });
});

describe("PriorityDistWidget", () => {
  it("total=0：空态文案", () => {
    h.useWidgetData.mockReturnValue(ready({ low: 0, medium: 0, high: 0, urgent: 0, total: 0 }));
    const { getByText } = render(<PriorityDistWidget wid="w1" />);
    expect(getByText("dashboard:priorityDistEmpty")).toBeTruthy();
  });

  it("四档分布：百分比取整、零档不出扇形、中心显示总数", () => {
    h.useWidgetData.mockReturnValue(ready({ low: 1, medium: 1, high: 0, urgent: 1, total: 3 }));
    const { container, getAllByText } = render(<PriorityDistWidget wid="w1" />);
    expect(h.useWidgetData).toHaveBeenCalledWith("w1", "priority-dist");
    // 3 档有值 → 3 个 path；0 档跳过
    expect(container.querySelectorAll("path").length).toBe(3);
    expect(container.querySelectorAll("circle").length).toBe(1);
    // 图例：3 档各 33%，被跳过的 0 档仍显示 0%
    expect(getAllByText("33%").length).toBe(3);
    expect(getAllByText("0%").length).toBe(1);
    expect(container.textContent).toContain("priority:urgent");
    // 中心文本 = total
    const center = Array.from(container.querySelectorAll("text")).map((t) => t.textContent);
    expect(center).toContain("3");
    expect(center).toContain("dashboard:priorityDistTotal");
  });

  it("单档独占：画整圆而不是扇形 path", () => {
    h.useWidgetData.mockReturnValue(ready({ low: 0, medium: 0, high: 0, urgent: 7, total: 7 }));
    const { container } = render(<PriorityDistWidget wid="w1" />);
    expect(container.querySelectorAll("path").length).toBe(0);
    // 整圆 + 中心圆
    expect(container.querySelectorAll("circle").length).toBe(2);
    expect(container.textContent).toContain("100%");
  });
});

describe("GanttWidget", () => {
  it("空 items：空态文案", () => {
    h.useWidgetData.mockReturnValue(ready({ items: [] }));
    const { getByText } = render(<GanttWidget wid="w1" />);
    expect(getByText("dashboard:ganttEmpty")).toBeTruthy();
  });

  it("多任务：每行一个时间条、5 个刻度、长标题截断、done 降透明度、色走 token", () => {
    h.useWidgetData.mockReturnValue(
      ready({
        items: [
          {
            id: "g1",
            title: "一个非常非常长的任务标题啊",
            startDate: "2026-10-01",
            dueDate: "2026-10-20",
            status: "done",
            assignee: null,
          },
          {
            id: "g2",
            title: "短标题",
            startDate: "2026-10-05",
            dueDate: "2026-10-10",
            status: "in_progress",
            assignee: "u1",
          },
        ],
      }),
    );
    const { container } = render(<GanttWidget wid="w1" />);

    expect(container.querySelectorAll("rect").length).toBe(2);
    // 刻度 5 条虚线
    expect(container.querySelectorAll("line").length).toBe(5);
    // 长标题截断为 11 字符 + 省略号（只看 <text>，<title> 提示保留全文）
    const svgTexts = Array.from(container.querySelectorAll("svg text")).map((t) => t.textContent);
    expect(svgTexts).toContain("一个非常非常长的任务标…");
    expect(svgTexts).toContain("短标题");
    // done 透明度 0.6，其余 0.85
    const rects = Array.from(container.querySelectorAll("rect"));
    expect(rects[0].getAttribute("opacity")).toBe("0.6");
    expect(rects[1].getAttribute("opacity")).toBe("0.85");
    expect(rects[0].getAttribute("fill")).toBe("var(--status-done)");
    expect(rects[1].getAttribute("fill")).toBe("var(--status-doing)");
  });
});

describe("MilestoneTimelineWidget", () => {
  it("空 items：空态文案", () => {
    h.useWidgetData.mockReturnValue(ready({ items: [] }));
    const { getByText } = render(<MilestoneTimelineWidget wid="w1" />);
    expect(getByText("dashboard:milestoneEmpty")).toBeTruthy();
  });

  it("三状态：done 实心点 / in_progress 小点 / pending 空心；无日期显示占位", () => {
    h.useWidgetData.mockReturnValue(
      ready({
        items: [
          {
            id: "m1",
            name: "已完",
            dueDate: "2026-10-01T10:00:00.000Z",
            status: "done",
            taskCount: 3,
          },
          {
            id: "m2",
            name: "进行",
            dueDate: null,
            status: "in_progress",
            taskCount: 0,
          },
          { id: "m3", name: "待启", dueDate: "2026-12-31", status: "pending", taskCount: 7 },
        ],
      }),
    );
    const { container, getByText } = render(<MilestoneTimelineWidget wid="w1" />);

    expect(container.querySelectorAll("li").length).toBe(3);
    // 日期：取前 10 位；null → 占位符
    expect(getByText("2026-10-01")).toBeTruthy();
    expect(getByText("2026-12-31")).toBeTruthy();
    expect(getByText("—")).toBeTruthy();
    // 状态标签
    expect(getByText("dashboard:milestoneDone")).toBeTruthy();
    expect(getByText("dashboard:milestoneInProgress")).toBeTruthy();
    expect(getByText("dashboard:milestonePending")).toBeTruthy();
    // taskCount 走插值
    expect(container.textContent).toContain('dashboard:milestoneTaskCount:{"count":3}');
    // 节点形状：done 实心 2×2、in_progress 1.5×1.5、pending 无内点
    expect(container.querySelectorAll("span.w-2.h-2").length).toBe(1);
    expect(container.querySelectorAll("span.w-1\\.5.h-1\\.5").length).toBe(1);
  });
});

describe("CustomChartWidget", () => {
  it("total=0 或 values 为空：空态文案", () => {
    h.useWidgetData.mockReturnValue(
      ready({ chartType: "bar", dataSource: "taskStatus", labels: [], values: [], total: 0 }),
    );
    const { getByText } = render(<CustomChartWidget wid="w1" />);
    expect(getByText("dashboard:customChartEmpty")).toBeTruthy();
  });

  it("bar（默认）：每值一根柱，长标签截断", () => {
    h.useWidgetData.mockReturnValue(
      ready({
        chartType: "bar",
        dataSource: "taskStatus",
        labels: ["todo", "a-very-long-label"],
        values: [4, 6],
        total: 10,
      }),
    );
    const { container } = render(<CustomChartWidget wid="w1" />);
    expect(h.useWidgetData).toHaveBeenCalledWith("w1", "custom-chart");
    expect(container.querySelectorAll("rect").length).toBe(2);
    expect(container.textContent).toContain("a-ver…");
  });

  it("line：面积 + 折线 + 每点 circle", () => {
    h.useWidgetData.mockReturnValue(
      ready({
        chartType: "line",
        dataSource: "taskPriority",
        labels: ["a", "b", "c"],
        values: [1, 3, 2],
        total: 6,
      }),
    );
    const { container } = render(<CustomChartWidget wid="w1" />);
    expect(container.querySelectorAll("path").length).toBe(2);
    expect(container.querySelectorAll("circle").length).toBe(3);
    expect(container.querySelector("linearGradient")?.getAttribute("id")).toMatch(/^custom-line-/);
  });

  it("pie：扇形体 + 图例计数", () => {
    h.useWidgetData.mockReturnValue(
      ready({
        chartType: "pie",
        dataSource: "milestoneProgress",
        labels: ["甲", "乙"],
        values: [1, 1],
        total: 2,
      }),
    );
    const { container } = render(<CustomChartWidget wid="w1" />);
    expect(container.querySelectorAll("path").length).toBe(2);
    // 中心圆 + 无整圆分支
    expect(container.querySelectorAll("circle").length).toBe(1);
    expect(container.querySelectorAll("li").length).toBe(2);
  });

  it("未知 chartType：回退柱状图", () => {
    h.useWidgetData.mockReturnValue(
      ready({
        chartType: "donut",
        dataSource: "taskStatus",
        labels: ["x"],
        values: [1],
        total: 1,
      }),
    );
    const { container } = render(<CustomChartWidget wid="w1" />);
    expect(container.querySelectorAll("rect").length).toBe(1);
    expect(container.querySelectorAll("path").length).toBe(0);
  });
});
