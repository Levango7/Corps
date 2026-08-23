// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

/**
 * Skeleton 组件单元测试
 *
 * 覆盖 web/components/Skeleton.tsx：
 *  - 基础 Skeleton 块正确渲染（div + animate-pulse 类）
 *  - className 与 style 透传
 *  - TaskListSkeleton：默认 5 行、自定义 count、aria-busy="true"
 *  - StatCardSkeleton：3 张卡片、aria-busy="true"
 *  - 不同变体渲染正确（结构 / 数量 / 可访问性属性）
 */

import { Skeleton, TaskListSkeleton, StatCardSkeleton } from "@/components/Skeleton";

describe("Skeleton 基础块", () => {
  it("渲染一个 div 元素", () => {
    // Arrange & Act
    const { container } = render(<Skeleton />);

    // Assert
    expect(container.querySelector("div")).toBeInTheDocument();
  });

  it("包含 animate-pulse 动画类", () => {
    // Arrange & Act
    const { container } = render(<Skeleton />);

    // Assert
    const div = container.querySelector("div");
    expect(div?.className).toContain("animate-pulse");
  });

  it("包含 surface-2 背景与 radius-sm 圆角类", () => {
    // Arrange & Act
    const { container } = render(<Skeleton />);

    // Assert
    const div = container.querySelector("div");
    expect(div?.className).toContain("bg-[var(--surface-2)]");
    expect(div?.className).toContain("rounded-[var(--radius-sm)]");
  });

  it("自定义 className 被合并到 class 列表", () => {
    // Arrange & Act
    const { container } = render(<Skeleton className="w-10 h-4 custom-class" />);

    // Assert
    const div = container.querySelector("div");
    expect(div?.className).toContain("w-10");
    expect(div?.className).toContain("h-4");
    expect(div?.className).toContain("custom-class");
  });

  it("自定义 style 被应用到元素", () => {
    // Arrange & Act
    const { container } = render(<Skeleton style={{ width: "100px", maxWidth: "80%" }} />);

    // Assert
    const div = container.querySelector("div");
    expect(div?.style.width).toBe("100px");
    expect(div?.style.maxWidth).toBe("80%");
  });

  it("不传 className 时仍渲染基础类", () => {
    // Arrange & Act
    const { container } = render(<Skeleton />);

    // Assert：基础类存在且无 undefined 残留
    const div = container.querySelector("div");
    expect(div?.className).toContain("animate-pulse");
    expect(div?.className).not.toContain("undefined");
  });
});

describe("TaskListSkeleton 任务列表骨架", () => {
  it("默认渲染 5 行骨架", () => {
    // Arrange & Act
    const { container } = render(<TaskListSkeleton />);

    // Assert：每行是一个直接子 div（含 items-center 类）
    const rows = container.querySelectorAll("div.divide-y > div");
    expect(rows).toHaveLength(5);
  });

  it("自定义 count 渲染对应行数", () => {
    // Arrange & Act
    const { container } = render(<TaskListSkeleton count={3} />);

    // Assert
    const rows = container.querySelectorAll("div.divide-y > div");
    expect(rows).toHaveLength(3);
  });

  it("count=0 时不渲染行", () => {
    // Arrange & Act
    const { container } = render(<TaskListSkeleton count={0} />);

    // Assert
    const rows = container.querySelectorAll("div.divide-y > div");
    expect(rows).toHaveLength(0);
  });

  it("count=10 渲染 10 行", () => {
    // Arrange & Act
    const { container } = render(<TaskListSkeleton count={10} />);

    // Assert
    const rows = container.querySelectorAll("div.divide-y > div");
    expect(rows).toHaveLength(10);
  });

  it("容器具有 aria-busy='true' 属性（屏幕阅读器加载提示）", () => {
    // Arrange & Act
    const { container } = render(<TaskListSkeleton />);

    // Assert
    const wrapper = container.querySelector(".divide-y");
    expect(wrapper).toHaveAttribute("aria-busy", "true");
  });

  it("每行包含 5 个 Skeleton 占位块（状态图标 + 标题 + 优先级 + 日期 + 头像）", () => {
    // Arrange & Act
    const { container } = render(<TaskListSkeleton count={1} />);

    // Assert：每行内含 5 个 animate-pulse div
    const row = container.querySelector("div.divide-y > div");
    const skeletons = row?.querySelectorAll(".animate-pulse");
    expect(skeletons).toHaveLength(5);
  });

  it("自定义 className 被合并到容器", () => {
    // Arrange & Act
    const { container } = render(<TaskListSkeleton className="custom-list-class" />);

    // Assert
    const wrapper = container.querySelector(".divide-y");
    expect(wrapper?.className).toContain("custom-list-class");
  });
});

describe("StatCardSkeleton 统计卡片骨架", () => {
  it("渲染 3 张统计卡片", () => {
    // Arrange & Act
    const { container } = render(<StatCardSkeleton />);

    // Assert：每张卡片是 grid 容器的直接子 div
    const cards = container.querySelectorAll(".grid > div");
    expect(cards).toHaveLength(3);
  });

  it("容器具有 aria-busy='true' 属性", () => {
    // Arrange & Act
    const { container } = render(<StatCardSkeleton />);

    // Assert
    const grid = container.querySelector(".grid");
    expect(grid).toHaveAttribute("aria-busy", "true");
  });

  it("每张卡片包含 3 个 Skeleton 占位块（图标 + 标签 + 大数字）", () => {
    // Arrange & Act
    const { container } = render(<StatCardSkeleton />);

    // Assert
    const cards = container.querySelectorAll(".grid > div");
    for (const card of cards) {
      const skeletons = card.querySelectorAll(".animate-pulse");
      expect(skeletons).toHaveLength(3);
    }
  });

  it("容器包含响应式 grid 类（grid-cols-1 sm:grid-cols-3）", () => {
    // Arrange & Act
    const { container } = render(<StatCardSkeleton />);

    // Assert
    const grid = container.querySelector(".grid");
    expect(grid?.className).toContain("grid-cols-1");
    expect(grid?.className).toContain("sm:grid-cols-3");
  });

  it("自定义 className 被合并到容器", () => {
    // Arrange & Act
    const { container } = render(<StatCardSkeleton className="custom-stat-class" />);

    // Assert
    const grid = container.querySelector(".grid");
    expect(grid?.className).toContain("custom-stat-class");
  });
});

describe("Skeleton 变体 - 渲染快照对比", () => {
  it("TaskListSkeleton 与 StatCardSkeleton 结构不同（行数 vs 卡片数）", () => {
    // Arrange & Act
    const { container: listContainer } = render(<TaskListSkeleton count={5} />);
    const { container: statContainer } = render(<StatCardSkeleton />);

    // Assert：列表 5 行，统计 3 卡片
    const listRows = listContainer.querySelectorAll("div.divide-y > div");
    const statCards = statContainer.querySelectorAll(".grid > div");
    expect(listRows).toHaveLength(5);
    expect(statCards).toHaveLength(3);
  });

  it("TaskListSkeleton 行内含 rounded-full（头像/图标圆形占位）", () => {
    // Arrange & Act
    const { container } = render(<TaskListSkeleton count={1} />);

    // Assert
    const roundElements = container.querySelectorAll(".rounded-full");
    expect(roundElements.length).toBeGreaterThan(0);
  });

  it("StatCardSkeleton 卡片含 border 类（卡片边框）", () => {
    // Arrange & Act
    const { container } = render(<StatCardSkeleton />);

    // Assert
    const cards = container.querySelectorAll(".grid > div");
    for (const card of cards) {
      expect(card.className).toContain("border");
    }
  });
});