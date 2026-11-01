// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";

/**
 * 任务统计 Widget 契约（components/dashboard/widgets/TaskStatsWidget.tsx）：
 *  - 数据源 useWidgetData(wid, "task-stats")：loading→WidgetSkeleton(4 行)、
 *    error/无数据→WidgetError(message, onRetry)、有数据→四状态卡片 + 总数
 *  - 四卡片：todo/in_progress/review/done 各自图标与计数；状态名走 status 命名空间
 *  - 重试按钮回调 hook 的 retry
 */
const h = vi.hoisted(() => ({
  useWidgetData: vi.fn(),
}));

vi.mock("@/components/dashboard/widgets/useWidgetData", () => ({
  useWidgetData: h.useWidgetData,
}));

vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}:${key}`,
}));

import TaskStatsWidget from "@/components/dashboard/widgets/TaskStatsWidget";

beforeEach(() => {
  h.useWidgetData.mockReset();
});

describe("TaskStatsWidget", () => {
  it("loading：渲染 4 行 WidgetSkeleton", () => {
    h.useWidgetData.mockReturnValue({ data: null, loading: true, error: null, retry: vi.fn() });
    const { container } = render(<TaskStatsWidget wid="w1" />);
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(container.querySelectorAll(".shimmer").length).toBe(4);
  });

  it("error：渲染 WidgetError（loadFailed + message + 重试触发 retry）", () => {
    const retry = vi.fn();
    h.useWidgetData.mockReturnValue({ data: null, loading: false, error: "boom", retry });
    const { getByText, container } = render(<TaskStatsWidget wid="w1" />);
    expect(getByText("dashboard:loadFailed")).toBeTruthy();
    expect(getByText("boom")).toBeTruthy();
    fireEvent.click(getByText("button:retry"));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(container.querySelector("svg.lucide-alert-triangle")).toBeTruthy();
  });

  it("有数据：四状态卡片（图标+计数）+ 总数行；请求参数为 task-stats", () => {
    h.useWidgetData.mockReturnValue({
      data: { todo: 3, in_progress: 2, review: 1, done: 5, total: 11 },
      loading: false,
      error: null,
      retry: vi.fn(),
    });
    const { container, getByText } = render(<TaskStatsWidget wid="w9" />);
    expect(h.useWidgetData).toHaveBeenCalledWith("w9", "task-stats");
    // 四状态名与计数
    for (const [key, value] of [
      ["todo", "3"],
      ["in_progress", "2"],
      ["review", "1"],
      ["done", "5"],
    ] as const) {
      expect(getByText(`status:${key}`)).toBeTruthy();
      expect(getByText(value)).toBeTruthy();
    }
    // 总数行
    expect(getByText("dashboard:totalTasks")).toBeTruthy();
    expect(getByText("11")).toBeTruthy();
    // 图标族完整
    for (const icon of ["circle", "circle-dot", "shield-check", "check-circle-2"]) {
      expect(container.querySelector(`svg.lucide-${icon}`)).toBeTruthy();
    }
  });
});
