// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

/**
 * PageTransition 契约（components/PageTransition.tsx）：
 *  - AnimatePresence mode="wait" initial={false} 包裹 key=pathname 的 motion.div
 *  - motion.div initial="hidden" / animate="visible" / exit="exit"
 *  - mode → variants：默认 "slide"→slideVariants；"fade"→fadeVariants；"scale"→scaleVariants；
 *    未知值回退 slideVariants
 *  - reduced → variants 强制 fadeVariants 且 transition {duration:0}；
 *    否则 transition {duration: 0.22, ease: [0.2,0,0,1]}
 *
 * Mock 边界说明（实测边界）：jsdom 无 framer-motion 动画引擎，AnimatePresence 的 exit/enter
 * 播放与 variants 数值动画不可观测。故 mock 为透传节点（参考 tests/unit/animated-list.test.tsx），
 * 把 AnimatePresence / motion.div 收到的 props 捕获后断言 —— pathname key、模式到 variants 的
 * 映射（与真实 motion-tokens 导出按引用比较）与 transition 形状均可从 props 观察，非恒真。
 * motion-tokens 加载真实模块（useReducedMotion 由 framer-motion mock 提供，可控行为）。
 */

const h = vi.hoisted(() => ({
  pathname: "/w/ws-1/board",
  reduced: false,
  presenceProps: null as Record<string, unknown> | null,
  motionProps: null as Record<string, unknown> | null,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => h.pathname,
}));

vi.mock("framer-motion", async () => {
  const React = await import("react");
  const MotionDiv = (props: Record<string, unknown>) => {
    h.motionProps = props;
    const {
      initial: _initial,
      animate: _animate,
      exit: _exit,
      variants: _variants,
      transition: _transition,
      ...rest
    } = props;
    return React.createElement("div", { ...rest });
  };
  const AnimatePresence = (props: Record<string, unknown>) => {
    h.presenceProps = props;
    return React.createElement(React.Fragment, null, props.children as ReactNode);
  };
  return { motion: { div: MotionDiv }, AnimatePresence, useReducedMotion: () => h.reduced };
});

import { PageTransition, type PageTransitionMode } from "@/components/PageTransition";
import { fadeVariants, slideVariants, scaleVariants } from "@/lib/motion-tokens";

function renderTransition(mode?: PageTransitionMode) {
  return render(
    <PageTransition mode={mode}>
      <div>页面内容</div>
    </PageTransition>,
  );
}

function presenceChild(): ReactElement {
  expect(h.presenceProps).not.toBeNull();
  return h.presenceProps?.children as ReactElement;
}

beforeEach(() => {
  h.pathname = "/w/ws-1/board";
  h.reduced = false;
  h.presenceProps = null;
  h.motionProps = null;
});
afterEach(() => {
  cleanup();
});

describe("PageTransition 结构", () => {
  it("渲染 children 内容", () => {
    renderTransition();
    expect(screen.getByText("页面内容")).toBeInTheDocument();
  });

  it('AnimatePresence 收到 mode="wait" 且 initial=false', () => {
    renderTransition();
    expect(h.presenceProps?.mode).toBe("wait");
    expect(h.presenceProps?.initial).toBe(false);
  });

  it("motion.div 的 key 为当前 pathname", () => {
    h.pathname = "/w/ws-1/docs";
    renderTransition();
    expect(presenceChild().key).toBe("/w/ws-1/docs");
  });

  it("路由变化后 key 跟随新 pathname", () => {
    const { rerender } = renderTransition();
    expect(presenceChild().key).toBe("/w/ws-1/board");
    h.pathname = "/w/ws-1/settings";
    rerender(
      <PageTransition>
        <div>页面内容</div>
      </PageTransition>,
    );
    expect(presenceChild().key).toBe("/w/ws-1/settings");
  });

  it('motion.div 收到 initial="hidden" / animate="visible" / exit="exit"', () => {
    renderTransition();
    expect(h.motionProps?.initial).toBe("hidden");
    expect(h.motionProps?.animate).toBe("visible");
    expect(h.motionProps?.exit).toBe("exit");
  });
});

describe("PageTransition 模式映射", () => {
  it("默认（不传 mode）使用 slideVariants", () => {
    renderTransition();
    expect(h.motionProps?.variants).toBe(slideVariants);
  });

  it('mode="fade" 使用 fadeVariants', () => {
    renderTransition("fade");
    expect(h.motionProps?.variants).toBe(fadeVariants);
  });

  it('mode="scale" 使用 scaleVariants', () => {
    renderTransition("scale");
    expect(h.motionProps?.variants).toBe(scaleVariants);
  });

  it("未知 mode 值回退 slideVariants", () => {
    renderTransition("weird" as PageTransitionMode);
    expect(h.motionProps?.variants).toBe(slideVariants);
  });
});

describe("PageTransition transition 与降级", () => {
  it("非 reduced：transition 为 {duration: 0.22, ease: [0.2,0,0,1]}", () => {
    renderTransition();
    expect(h.motionProps?.transition).toEqual({ duration: 0.22, ease: [0.2, 0, 0, 1] });
  });

  it("reduced=true：variants 强制 fadeVariants", () => {
    h.reduced = true;
    renderTransition("slide");
    expect(h.motionProps?.variants).toBe(fadeVariants);
  });

  it("reduced=true：transition 为 {duration: 0}", () => {
    h.reduced = true;
    renderTransition();
    expect(h.motionProps?.transition).toEqual({ duration: 0 });
  });

  it("reduced=true 时仍渲染 children", () => {
    h.reduced = true;
    renderTransition();
    expect(screen.getByText("页面内容")).toBeInTheDocument();
  });
});
