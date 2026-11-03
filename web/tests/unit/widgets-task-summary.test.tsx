// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

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

const mocks = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(
      message: string,
      public status = 0,
      public code = 0,
    ) {
      super(message);
      this.name = "ApiError";
    }
  }
  return { api: vi.fn(), ApiErrorClass: ApiError };
});
vi.mock("@/lib/api", () => ({ api: mocks.api, ApiError: mocks.ApiErrorClass }));

import TaskSummaryWidget from "@/components/widgets/TaskSummaryWidget";

const PATH = "/api/v1/workspaces/ws-1/analytics/overview";
const RADIUS = (72 - 6) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** 读取统计项的数值（StatItem 结构：标签 span 的兄弟节点就是数值 span） */
function statValue(label: string): string | null {
  return screen.getByText(label).nextElementSibling?.textContent ?? null;
}

function progressCircle(container: HTMLElement): SVGCircleElement {
  const circles = container.querySelectorAll("circle");
  return circles[1] as SVGCircleElement;
}

/**
 * React 把 camelCase 的 SVG prop 落成连字符属性名（strokeDashoffset → stroke-dashoffset），
 * 用 camelCase 名 getAttribute 会读到 null —— Number(null) = 0 会伪装成「偏移为零」，
 * 断言必须走真实属性名。
 */
function dashOffset(circle: SVGCircleElement): number {
  return Number(circle.getAttribute("stroke-dashoffset"));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TaskSummaryWidget", () => {
  it("加载中渲染骨架屏", () => {
    mocks.api.mockImplementation(async () => ({}));
    render(<TaskSummaryWidget wid="ws-1" />);
    expect(screen.getByLabelText("dashboard:taskStatsLoading")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("四字段归一化：total 由 todo+inProgress+review+done 推导", async () => {
    mocks.api.mockImplementation(async () => ({
      todo: 3,
      in_progress: 2,
      review: 1,
      done: 4,
    }));
    render(<TaskSummaryWidget wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("dashboard:totalTasks")).toBeInTheDocument());

    expect(mocks.api).toHaveBeenCalledWith(PATH);
    expect(statValue("dashboard:totalTasks")).toBe("10");
    expect(statValue("dashboard:statDone")).toBe("4");
    expect(statValue("dashboard:statInProgress")).toBe("2");
    expect(statValue("dashboard:statPending")).toBe("4");
    expect(statValue("dashboard:statOverdue")).toBe("0");
    expect(screen.getByText("40%")).toBeInTheDocument();
  });

  it("嵌套 taskStats 与 camelCase inProgress 都被识别", async () => {
    mocks.api.mockImplementation(async () => ({
      taskStats: { inProgress: 5, done: 3, total: 10, overdue: 1 },
    }));
    render(<TaskSummaryWidget wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("dashboard:totalTasks")).toBeInTheDocument());

    expect(statValue("dashboard:totalTasks")).toBe("10");
    expect(statValue("dashboard:statInProgress")).toBe("5");
    expect(statValue("dashboard:statDone")).toBe("3");
    expect(statValue("dashboard:statOverdue")).toBe("1");
    expect(statValue("dashboard:statPending")).toBe("2");
  });

  it("in_progress 优先于 inProgress", async () => {
    mocks.api.mockImplementation(async () => ({
      in_progress: 2,
      inProgress: 7,
      done: 1,
      total: 9,
    }));
    render(<TaskSummaryWidget wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("dashboard:totalTasks")).toBeInTheDocument());
    expect(statValue("dashboard:statInProgress")).toBe("2");
  });

  it("空 payload 全部回退为 0", async () => {
    mocks.api.mockImplementation(async () => ({}));
    render(<TaskSummaryWidget wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("dashboard:totalTasks")).toBeInTheDocument());

    expect(statValue("dashboard:totalTasks")).toBe("0");
    expect(statValue("dashboard:statDone")).toBe("0");
    expect(statValue("dashboard:statInProgress")).toBe("0");
    expect(statValue("dashboard:statPending")).toBe("0");
    expect(statValue("dashboard:statOverdue")).toBe("0");
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("待办数不为负：完成数大于总数时归零", async () => {
    mocks.api.mockImplementation(async () => ({ total: 1, done: 5, inProgress: 5 }));
    render(<TaskSummaryWidget wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("dashboard:totalTasks")).toBeInTheDocument());
    expect(statValue("dashboard:statPending")).toBe("0");
  });

  it("进度环按完成率绘制并在 0~100 之间钳制", async () => {
    mocks.api.mockImplementation(async () => ({ total: 4, done: 3, inProgress: 1 }));
    const { container, unmount } = render(<TaskSummaryWidget wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("dashboard:totalTasks")).toBeInTheDocument());

    // 3/4 = 75%
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: 'dashboard:completionRateAria:{"percent":75}' }),
    ).toBeInTheDocument();
    const arc = progressCircle(container);
    expect(dashOffset(arc)).toBeCloseTo(CIRCUMFERENCE * 0.25, 3);
    expect(arc.getAttribute("transform")).toBe("rotate(-90 36 36)");
    expect(arc.getAttribute("stroke-dasharray")).toBe(String(CIRCUMFERENCE));
    unmount();

    // 完成数超过总数 → 钳到 100%，偏移归零
    mocks.api.mockImplementation(async () => ({ total: 1, done: 2 }));
    const over = render(<TaskSummaryWidget wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("100%")).toBeInTheDocument());
    expect(dashOffset(progressCircle(over.container))).toBeCloseTo(0, 3);
    over.unmount();

    // 全部未完成 → 偏移等于整圈
    mocks.api.mockImplementation(async () => ({ total: 4, done: 0 }));
    const zero = render(<TaskSummaryWidget wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("0%")).toBeInTheDocument());
    expect(dashOffset(progressCircle(zero.container))).toBeCloseTo(CIRCUMFERENCE, 3);
  });

  it("加载失败显示 0 占位与失败文案而非崩溃", async () => {
    mocks.api.mockImplementation(async () => {
      throw new Error("overview down");
    });
    render(<TaskSummaryWidget wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("dashboard:loadFailed")).toBeInTheDocument());

    expect(statValue("dashboard:totalTasks")).toBe("0");
    expect(statValue("dashboard:statOverdue")).toBe("0");
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });

  it("切换工作区后按新 wid 重新拉取", async () => {
    mocks.api.mockImplementation(async () => ({ total: 2, done: 1 }));
    const { rerender } = render(<TaskSummaryWidget wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("dashboard:totalTasks")).toBeInTheDocument());

    rerender(<TaskSummaryWidget wid="ws-2" />);
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith("/api/v1/workspaces/ws-2/analytics/overview"),
    );
  });
});
