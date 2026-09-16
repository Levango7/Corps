// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * AnimatedList / AnimatedItem 单元测试
 *
 * 覆盖 web/components/AnimatedList.tsx：
 *  - AnimatedList 渲染空列表不崩溃
 *  - 渲染子元素正确
 *  - AnimatedItem 包裹子元素
 *  - className 透传
 *  - AnimatedList + AnimatedItem 组合渲染
 *  - prefers-reduced-motion 降级模式仍正常渲染
 *
 * Mock 策略：framer-motion 的 motion.div / AnimatePresence 在 jsdom 中无动画引擎，
 * 故 mock 为透传 DOM 节点；useReducedMotion mock 为可控函数以测试正常/降级两条路径。
 * motion-tokens.ts 仍加载真实模块（仅依赖 MOTION 常量，不依赖动画引擎）。
 */

const { useReducedMotionMock } = vi.hoisted(() => ({
  useReducedMotionMock: vi.fn(),
}));

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, className }: any) => <div className={className}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
  useReducedMotion: useReducedMotionMock,
}));

import { AnimatedList, AnimatedItem } from "@/components/AnimatedList";

beforeEach(() => {
  useReducedMotionMock.mockReset();
  // 默认：不降级（正常动画路径）
  useReducedMotionMock.mockReturnValue(false);
});

describe("AnimatedList 基础渲染", () => {
  it("渲染空列表不崩溃", () => {
    const { container } = render(<AnimatedList>{[]}</AnimatedList>);
    expect(container.firstChild).toBeInTheDocument();
    expect(container.firstChild).toBeInstanceOf(HTMLDivElement);
  });

  it("渲染子元素", () => {
    render(<AnimatedList>列表内容</AnimatedList>);
    expect(screen.getByText("列表内容")).toBeInTheDocument();
  });

  it("className 透传到容器", () => {
    const { container } = render(<AnimatedList className="list-class">x</AnimatedList>);
    expect(container.firstChild).toHaveClass("list-class");
  });

  it("多个子元素均渲染", () => {
    render(
      <AnimatedList>
        <div>第一项</div>
        <div>第二项</div>
        <div>第三项</div>
      </AnimatedList>,
    );

    expect(screen.getByText("第一项")).toBeInTheDocument();
    expect(screen.getByText("第二项")).toBeInTheDocument();
    expect(screen.getByText("第三项")).toBeInTheDocument();
  });
});

describe("AnimatedItem 基础渲染", () => {
  it("包裹子元素", () => {
    const { container } = render(<AnimatedItem>子项内容</AnimatedItem>);
    expect(screen.getByText("子项内容")).toBeInTheDocument();
    // AnimatedItem 渲染为一个 div 包裹子元素
    expect(container.querySelector("div")).toBeInTheDocument();
  });

  it("className 透传到 item", () => {
    const { container } = render(<AnimatedItem className="item-class">x</AnimatedItem>);
    expect(container.firstChild).toHaveClass("item-class");
  });

  it("渲染复杂子元素", () => {
    render(
      <AnimatedItem>
        <span data-testid="child">复杂内容</span>
      </AnimatedItem>,
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
    expect(screen.getByText("复杂内容")).toBeInTheDocument();
  });
});

describe("AnimatedList + AnimatedItem 组合", () => {
  it("列表包裹多个 AnimatedItem 均渲染", () => {
    render(
      <AnimatedList>
        <AnimatedItem>A</AnimatedItem>
        <AnimatedItem>B</AnimatedItem>
        <AnimatedItem>C</AnimatedItem>
      </AnimatedList>,
    );

    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
    expect(screen.getByText("C")).toBeInTheDocument();
  });

  it("组合时 className 各自透传", () => {
    const { container } = render(
      <AnimatedList className="outer">
        <AnimatedItem className="inner">项</AnimatedItem>
      </AnimatedList>,
    );

    expect(container.firstChild).toHaveClass("outer");
    expect(screen.getByText("项").closest(".inner")).not.toBeNull();
  });
});

describe("AnimatedList 降级模式（prefers-reduced-motion）", () => {
  it("降级时 AnimatedList 仍正常渲染子元素", () => {
    useReducedMotionMock.mockReturnValue(true);
    render(
      <AnimatedList>
        <div>降级列表内容</div>
      </AnimatedList>,
    );
    expect(screen.getByText("降级列表内容")).toBeInTheDocument();
  });

  it("降级时 AnimatedItem 仍正常包裹子元素", () => {
    useReducedMotionMock.mockReturnValue(true);
    render(<AnimatedItem>降级项</AnimatedItem>);
    expect(screen.getByText("降级项")).toBeInTheDocument();
  });

  it("降级时组合仍正常渲染", () => {
    useReducedMotionMock.mockReturnValue(true);
    render(
      <AnimatedList>
        <AnimatedItem>降级组合项</AnimatedItem>
      </AnimatedList>,
    );
    expect(screen.getByText("降级组合项")).toBeInTheDocument();
  });
});