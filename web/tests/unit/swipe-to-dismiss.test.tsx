// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * SwipeToDismiss 契约（components/SwipeToDismiss.tsx）：
 *  - 正常模式：framer-motion drag="x"（dragConstraints left/right 0、dragElastic 0.7、whileDrag scale 0.98），
 *    背景渐显 dismissLabel 删除提示（aria-hidden）
 *  - onDragEnd：offset.x > threshold（默认 100）或 velocity.x > velocityThreshold（默认 500）→ onDismiss；
 *    恰好等于阈值不触发（严格大于）；负向位移不触发
 *  - prefers-reduced-motion 降级：不渲染拖拽层，渲染 aria-label=dismissLabel 的删除按钮，点击即 onDismiss
 *
 * Mock 边界说明（实测边界）：jsdom 无 framer-motion 动画引擎，motion.div 内部的 drag 手势
 * （pointer 序列驱动、PanInfo 计算、松手回弹）无法在 jsdom 中真实发生。故将 framer-motion
 * mock 为透传 DOM 节点（参考 tests/unit/animated-list.test.tsx），并把携带 onDragEnd 的
 * 拖拽层 props 捕获到 hoisted 状态，用合成 PanInfo 直接调用回调 —— 这是唯一可从
 * props/回调观察的拖拽分支；滑动过程的透明度/缩放动画属 motion value 内部行为，不可观测，不测。
 */

const h = vi.hoisted(() => ({
  reduced: false,
  /** 捕获携带 onDragEnd 的拖拽层 motion.div props */
  dragProps: null as Record<string, unknown> | null,
}));

vi.mock("framer-motion", async () => {
  const React = await import("react");
  const MotionDiv = (props: Record<string, unknown>) => {
    if (typeof props.onDragEnd === "function") h.dragProps = props;
    // 丢弃 motion 专属 props，其余（children/className/aria-hidden 等）透传
    const {
      drag: _drag,
      dragConstraints: _dragConstraints,
      dragElastic: _dragElastic,
      whileDrag: _whileDrag,
      transition: _transition,
      style: _style,
      onDragEnd: _onDragEnd,
      ...rest
    } = props;
    return React.createElement("div", { ...rest, children: props.children as ReactNode });
  };
  return {
    motion: { div: MotionDiv },
    useMotionValue: (initial: number) => ({ get: () => initial, set: () => {} }),
    useTransform: (_value: unknown, _input: unknown, output: unknown[]) => output[0],
    useReducedMotion: () => h.reduced,
  };
});

import { SwipeToDismiss } from "@/components/SwipeToDismiss";

type PanLike = { offset: { x: number; y: number }; velocity: { x: number; y: number } };

/** 用合成 PanInfo 触发捕获到的 onDragEnd 回调 */
function fireDragEnd(offsetX: number, velocityX = 0) {
  const handler = h.dragProps?.onDragEnd as ((e: unknown, info: PanLike) => void) | undefined;
  expect(handler).toBeTypeOf("function");
  handler?.(null, { offset: { x: offsetX, y: 0 }, velocity: { x: velocityX, y: 0 } });
}

function renderSwipe(
  onDismiss = vi.fn(),
  props: { threshold?: number; velocityThreshold?: number; dismissLabel?: string } = {},
) {
  return render(
    <SwipeToDismiss onDismiss={onDismiss} {...props}>
      <div>任务卡片内容</div>
    </SwipeToDismiss>,
  );
}

beforeEach(() => {
  h.reduced = false;
  h.dragProps = null;
});
afterEach(() => {
  cleanup();
});

describe("SwipeToDismiss 正常模式渲染", () => {
  it("渲染 children 内容", () => {
    renderSwipe();
    expect(screen.getByText("任务卡片内容")).toBeInTheDocument();
  });

  it("渲染默认删除提示文案“删除”，提示层带 aria-hidden", () => {
    const { container } = renderSwipe();
    expect(screen.getByText("删除")).toBeInTheDocument();
    expect(container.querySelector('div[aria-hidden="true"]')).not.toBeNull();
  });

  it("渲染自定义 dismissLabel 文案", () => {
    renderSwipe(vi.fn(), { dismissLabel: "滑滑删" });
    expect(screen.getByText("滑滑删")).toBeInTheDocument();
    expect(screen.queryByText("删除")).not.toBeInTheDocument();
  });

  it("拖拽层携带 drag/x 与 dragConstraints/dragElastic/whileDrag 配置（可从 props 观察）", () => {
    renderSwipe();
    expect(h.dragProps).not.toBeNull();
    expect(h.dragProps?.drag).toBe("x");
    expect(h.dragProps?.dragConstraints).toEqual({ left: 0, right: 0 });
    expect(h.dragProps?.dragElastic).toBe(0.7);
    expect(h.dragProps?.whileDrag).toEqual({ scale: 0.98 });
  });
});

describe("SwipeToDismiss dragEnd 判定", () => {
  it("位移超过默认 threshold（150 > 100）→ 触发 onDismiss 一次", () => {
    const onDismiss = vi.fn();
    renderSwipe(onDismiss);
    fireDragEnd(150, 0);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("位移恰好等于 threshold（100）不触发（严格大于）", () => {
    const onDismiss = vi.fn();
    renderSwipe(onDismiss);
    fireDragEnd(100, 0);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("位移低于阈值且速度低 → 不触发", () => {
    const onDismiss = vi.fn();
    renderSwipe(onDismiss);
    fireDragEnd(99, 100);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("速度超过默认 velocityThreshold（600 > 500）即使位移小也触发", () => {
    const onDismiss = vi.fn();
    renderSwipe(onDismiss);
    fireDragEnd(50, 600);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("自定义 threshold=50：位移 60 触发", () => {
    const onDismiss = vi.fn();
    renderSwipe(onDismiss, { threshold: 50 });
    fireDragEnd(60, 0);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("自定义 velocityThreshold=1000：速度 600 不触发", () => {
    const onDismiss = vi.fn();
    renderSwipe(onDismiss, { velocityThreshold: 1000 });
    fireDragEnd(30, 600);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("负向位移（向右滑回）即使幅度大也不触发", () => {
    const onDismiss = vi.fn();
    renderSwipe(onDismiss);
    fireDragEnd(-150, -800);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe("SwipeToDismiss 降级模式（prefers-reduced-motion）", () => {
  it("降级时不渲染拖拽层，渲染 aria-label=dismissLabel 的删除按钮", () => {
    h.reduced = true;
    renderSwipe();
    expect(h.dragProps).toBeNull();
    const btn = screen.getByRole("button", { name: "删除" });
    expect(btn).toBeInTheDocument();
  });

  it("降级时 children 仍渲染", () => {
    h.reduced = true;
    renderSwipe();
    expect(screen.getByText("任务卡片内容")).toBeInTheDocument();
  });

  it("降级时点击删除按钮触发 onDismiss", () => {
    h.reduced = true;
    const onDismiss = vi.fn();
    renderSwipe(onDismiss, { dismissLabel: "移除" });
    fireEvent.click(screen.getByRole("button", { name: "移除" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
