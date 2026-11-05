// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, createEvent, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * PinchToZoom 契约（components/PinchToZoom.tsx）：
 *  - 正常模式：原生 touch 手势挂在容器 div 上（onTouchStart/onTouchMove/onTouchEnd）
 *  - onTouchStart 双指记录初始距离 d0 与起始 scale；onTouchMove 计算
 *    scale = clamp(startScale * d/d0, minScale, maxScale)（默认 [0.5, 2]）
 *  - 双指 touchmove 调 preventDefault；单指/未记录初始距离时不干预；scale 保留不回弹
 *  - prefers-reduced-motion 降级：直接渲染 children，无手势
 *
 * 实测边界说明：源码用原生 TouchEvent（非 framer-motion drag/pinch），jsdom 30 提供
 * TouchEvent 构造器、fireEvent 可派发 touches 含 {clientX, clientY} 普通对象的事件，
 * 因此 touch 序列可真实驱动。framer-motion 仍需 mock（jsdom 无动画引擎）：motion.div
 * mock 为透传 div 并转发 touch handlers；useMotionValue mock 为可变数值盒，scale.set
 * 的结果可从盒中读出 —— 断言基于源码真实写入的数值，非恒真。
 */

const h = vi.hoisted(() => ({
  reduced: false,
  /** 最近一次 useMotionValue 创建的数值盒（单挂载下即组件持有的那个） */
  box: null as { get: () => number; set: (v: number) => void } | null,
}));

vi.mock("framer-motion", async () => {
  const React = await import("react");
  const MotionDiv = (props: Record<string, unknown>) => {
    const { style: _style, children, ...rest } = props;
    return React.createElement("div", { ...rest, children: children as ReactNode });
  };
  return {
    motion: { div: MotionDiv },
    useMotionValue: (initial: number) => {
      let v = initial;
      const box = {
        get: () => v,
        set: (n: number) => {
          v = n;
        },
      };
      h.box = box;
      return box;
    },
    useReducedMotion: () => h.reduced,
  };
});

import { PinchToZoom } from "@/components/PinchToZoom";

/** 双指 touches init（fireEvent 会把 touches 透传给 jsdom TouchEvent） */
function pinchInit(d: number): TouchEventInit {
  return {
    touches: [
      { clientX: 100 - d / 2, clientY: 0 },
      { clientX: 100 + d / 2, clientY: 0 },
    ],
  } as unknown as TouchEventInit;
}

/** 单指 touches init */
function fingerInit(x: number, y: number): TouchEventInit {
  return { touches: [{ clientX: x, clientY: y }] } as unknown as TouchEventInit;
}

function renderZoom(props: { minScale?: number; maxScale?: number } = {}) {
  return render(
    <PinchToZoom {...props}>
      <div>可缩放图片</div>
    </PinchToZoom>,
  );
}

beforeEach(() => {
  h.reduced = false;
  h.box = null;
});
afterEach(() => {
  cleanup();
});

describe("PinchToZoom 基础渲染", () => {
  it("正常模式渲染 children 且容器带 touch 手势 class", () => {
    const { container } = renderZoom();
    expect(screen.getByText("可缩放图片")).toBeInTheDocument();
    expect(container.firstElementChild?.className).toContain("touch-pan-x");
  });

  it("初始 scale 为 1", () => {
    renderZoom();
    expect(h.box?.get()).toBe(1);
  });
});

describe("PinchToZoom 缩放计算", () => {
  it("双指张开（d 100→150）→ scale = 1.5", () => {
    const { container } = renderZoom();
    const el = container.firstElementChild as HTMLElement;
    fireEvent.touchStart(el, pinchInit(100));
    fireEvent.touchMove(el, pinchInit(150));
    expect(h.box?.get()).toBe(1.5);
  });

  it("双指捏合（d 100→60）→ scale = 0.6", () => {
    const { container } = renderZoom();
    const el = container.firstElementChild as HTMLElement;
    fireEvent.touchStart(el, pinchInit(100));
    fireEvent.touchMove(el, pinchInit(60));
    expect(h.box?.get()).toBe(0.6);
  });

  it("超过 maxScale 时钳制（自定义 maxScale=1.2，ratio 2）", () => {
    const { container } = renderZoom({ maxScale: 1.2 });
    const el = container.firstElementChild as HTMLElement;
    fireEvent.touchStart(el, pinchInit(100));
    fireEvent.touchMove(el, pinchInit(200));
    expect(h.box?.get()).toBe(1.2);
  });

  it("低于 minScale 时钳制（自定义 minScale=0.8，ratio 0.5）", () => {
    const { container } = renderZoom({ minScale: 0.8 });
    const el = container.firstElementChild as HTMLElement;
    fireEvent.touchStart(el, pinchInit(100));
    fireEvent.touchMove(el, pinchInit(50));
    expect(h.box?.get()).toBe(0.8);
  });

  it("增量缩放：第二次 pinch 以当前 scale 为基准（1.4 × 2 = 2.8）", () => {
    const { container } = renderZoom({ minScale: 0.1, maxScale: 10 });
    const el = container.firstElementChild as HTMLElement;
    fireEvent.touchStart(el, pinchInit(100));
    fireEvent.touchMove(el, pinchInit(140));
    expect(h.box?.get()).toBe(1.4);
    // 第二次双指落下：startScale 记录为 1.4，随后张开 2 倍
    fireEvent.touchStart(el, pinchInit(200));
    fireEvent.touchMove(el, pinchInit(400));
    expect(h.box?.get()).toBe(2.8);
  });

  it("同一 pinch 会话内连续 move 按最新距离计算（120 → 1.2，180 → 1.8）", () => {
    const { container } = renderZoom({ minScale: 0.1, maxScale: 10 });
    const el = container.firstElementChild as HTMLElement;
    fireEvent.touchStart(el, pinchInit(100));
    fireEvent.touchMove(el, pinchInit(120));
    expect(h.box?.get()).toBe(1.2);
    fireEvent.touchMove(el, pinchInit(180));
    expect(h.box?.get()).toBe(1.8);
  });
});

describe("PinchToZoom 不干预分支", () => {
  it("单指触摸（start+move）不改变 scale", () => {
    const { container } = renderZoom();
    const el = container.firstElementChild as HTMLElement;
    fireEvent.touchStart(el, fingerInit(100, 100));
    fireEvent.touchMove(el, fingerInit(300, 300));
    expect(h.box?.get()).toBe(1);
  });

  it("未记录初始距离（无 touchStart 直接双指 move）不改变 scale", () => {
    const { container } = renderZoom();
    const el = container.firstElementChild as HTMLElement;
    fireEvent.touchMove(el, pinchInit(200));
    expect(h.box?.get()).toBe(1);
  });

  it("touchend 抬起后（初始距离重置）再 move 不改变 scale；重新 touchstart 后恢复缩放", () => {
    const { container } = renderZoom({ minScale: 0.1, maxScale: 10 });
    const el = container.firstElementChild as HTMLElement;
    fireEvent.touchStart(el, pinchInit(100));
    fireEvent.touchMove(el, pinchInit(150));
    expect(h.box?.get()).toBe(1.5);
    fireEvent.touchEnd(el, { touches: [] } as unknown as TouchEventInit);
    fireEvent.touchMove(el, pinchInit(300));
    expect(h.box?.get()).toBe(1.5);
    fireEvent.touchStart(el, pinchInit(100));
    fireEvent.touchMove(el, pinchInit(300));
    expect(h.box?.get()).toBe(4.5);
  });

  it("双指 move 时调用 preventDefault（阻止页面滚动）", () => {
    const { container } = renderZoom();
    const el = container.firstElementChild as HTMLElement;
    fireEvent.touchStart(el, pinchInit(100));
    const move = createEvent.touchMove(el, pinchInit(150));
    // 注：本仓 jsdom 30.1.3 在 dispatch 过程中不回写 defaultPrevented，故用 spy 观察调用
    const spy = vi.spyOn(move, "preventDefault");
    fireEvent(el, move);
    expect(spy).toHaveBeenCalled();
  });

  it("已有非默认 scale 时单指操作不回弹（保留 1.5）", () => {
    const { container } = renderZoom({ minScale: 0.1, maxScale: 10 });
    const el = container.firstElementChild as HTMLElement;
    fireEvent.touchStart(el, pinchInit(100));
    fireEvent.touchMove(el, pinchInit(150));
    fireEvent.touchEnd(el, { touches: [] } as unknown as TouchEventInit);
    fireEvent.touchStart(el, fingerInit(50, 50));
    fireEvent.touchMove(el, fingerInit(20, 20));
    expect(h.box?.get()).toBe(1.5);
  });
});

describe("PinchToZoom 降级模式（prefers-reduced-motion）", () => {
  it("降级时直接渲染 children、容器无 touch 手势 class，touch 事件不崩且 scale 不变", () => {
    h.reduced = true;
    const { container } = renderZoom();
    expect(screen.getByText("可缩放图片")).toBeInTheDocument();
    expect(container.firstElementChild?.className).not.toContain("touch-pan-x");
    fireEvent.touchStart(container.firstElementChild as HTMLElement, pinchInit(100));
    fireEvent.touchMove(container.firstElementChild as HTMLElement, pinchInit(300));
    expect(h.box?.get()).toBe(1);
  });
});
