// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

/**
 * Onboarding 契约（components/Onboarding.tsx，default 导出）：
 *  - localStorage 未完成且 taskCount===0 才显示；否则渲染 null
 *  - 显示即埋点 onboarding_start {totalSteps:4}（ref 保证只记一次）
 *  - 折叠态：右下角气泡（aria-label openGuide + step1.title + 1/4）；点击展开模态
 *  - 模态：badge {current,total:4}；X（skipAria）折叠回气泡并返还焦点；
 *    展开后首个可聚焦元素获得焦点
 *  - 步进：CTA href 存在则 router.push；rAF 后 next()；最后一步 → complete()
 *  - taskCount>0 时 step 1 跳到 step 2（effectiveStep）
 *  - skip：localStorage 标记 + onboarding_skip + onDismiss；
 *    complete：localStorage 标记 + onboarding_complete + onDismiss
 */

const h = vi.hoisted(() => ({
  push: vi.fn(),
  track: vi.fn(),
}));

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
vi.mock("@/lib/i18n-navigation", () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock("@/lib/analytics", () => ({ track: h.track }));

import Onboarding from "@/components/Onboarding";

const WID = "ws-ob-1";
const STORAGE_KEY = "corps_onboarding_completed";

let store: Map<string, string>;

function renderOnboarding(props: { taskCount?: number; onDismiss?: () => void } = {}) {
  return render(
    <Onboarding
      wid={WID}
      taskCount={props.taskCount ?? 0}
      memberCount={3}
      onDismiss={props.onDismiss ?? vi.fn()}
    />,
  );
}

/** 展开模态并推进到指定步（0 基；每步点一次 CTA） */
function openAt(step: number) {
  const utils = renderOnboarding();
  fireEvent.click(screen.getByRole("button", { name: "onboarding:openGuide" }));
  for (let i = 0; i < step; i++) {
    fireEvent.click(screen.getByRole("button", { name: new RegExp("onboarding:step\\d+.cta") }));
  }
  return utils;
}

beforeEach(() => {
  h.push.mockReset();
  h.track.mockReset();
  store = new Map();
  // 本仓 vitest jsdom 不提供 localStorage：装最小内存实现（参考 user-menu.test.tsx）
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
  // 本仓 jsdom 无 requestAnimationFrame（handleAction 用它切步）：同步执行保断言确定性
  vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => {
    cb(0);
    return 0;
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe("Onboarding", () => {
  it("taskCount=0 且未完成：显示气泡（openGuide/step1.title/1/4）并埋点 onboarding_start", () => {
    renderOnboarding();
    const bubble = screen.getByRole("button", { name: "onboarding:openGuide" });
    expect(bubble).toHaveTextContent("onboarding:step1.title");
    expect(bubble).toHaveTextContent("1/4");
    expect(h.track).toHaveBeenCalledWith("onboarding_start", { totalSteps: 4 });
    // 模态尚未展开
    expect(screen.queryByText(`onboarding:badge:{"current":1,"total":4}`)).not.toBeInTheDocument();
  });

  it("taskCount>0：不渲染引导", () => {
    const { container } = renderOnboarding({ taskCount: 5 });
    expect(container).toBeEmptyDOMElement();
    expect(h.track).not.toHaveBeenCalled();
  });

  it("localStorage 已标记完成：不渲染引导", () => {
    store.set(STORAGE_KEY, "true");
    const { container } = renderOnboarding();
    expect(container).toBeEmptyDOMElement();
    expect(h.track).not.toHaveBeenCalled();
  });

  it("点击气泡展开模态：badge current=1、step1 内容、skip 可见 back 隐藏", () => {
    renderOnboarding();
    fireEvent.click(screen.getByRole("button", { name: "onboarding:openGuide" }));
    expect(screen.getByText(`onboarding:badge:{"current":1,"total":4}`)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "onboarding:step1.title" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "onboarding:skip" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "onboarding:back" })).not.toBeInTheDocument();
  });

  it("展开后首个可聚焦元素（skipAria 关闭按钮）自动获得焦点", () => {
    renderOnboarding();
    fireEvent.click(screen.getByRole("button", { name: "onboarding:openGuide" }));
    const closeBtn = screen.getByRole("button", { name: "onboarding:skipAria" });
    expect(document.activeElement).toBe(closeBtn);
  });

  it("step1 CTA（href=null）：不触发 push，前进到 step2", () => {
    openAt(0);
    fireEvent.click(screen.getByRole("button", { name: "onboarding:step1.cta" }));
    expect(h.push).not.toHaveBeenCalled();
    expect(screen.getByText(`onboarding:badge:{"current":2,"total":4}`)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "onboarding:step2.title" })).toBeInTheDocument();
  });

  it("step2 CTA：router.push(/w/{wid}/board) 并前进到 step3", () => {
    openAt(1);
    h.push.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "onboarding:step2.cta" }));
    expect(h.push).toHaveBeenCalledWith(`/w/${WID}/board`);
    expect(screen.getByText(`onboarding:badge:{"current":3,"total":4}`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "onboarding:back" })).toBeInTheDocument();
  });

  it("back 按钮：从 step3 返回 step2", () => {
    openAt(2);
    fireEvent.click(screen.getByRole("button", { name: "onboarding:back" }));
    expect(screen.getByText(`onboarding:badge:{"current":2,"total":4}`)).toBeInTheDocument();
  });

  it("X（skipAria）：折叠回气泡；不标记完成、不回调 onDismiss", () => {
    const { container } = renderOnboarding();
    fireEvent.click(screen.getByRole("button", { name: "onboarding:openGuide" }));
    fireEvent.click(screen.getByRole("button", { name: "onboarding:skipAria" }));
    expect(
      screen.queryByRole("heading", { name: "onboarding:step1.title" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "onboarding:openGuide" })).toBeInTheDocument();
    expect(store.has(STORAGE_KEY)).toBe(false);
    expect(container).not.toBeEmptyDOMElement();
  });

  it("skip：写 localStorage + onboarding_skip {step:0} + onDismiss + 卸载", () => {
    const onDismiss = vi.fn();
    const { container } = renderOnboarding({ onDismiss });
    fireEvent.click(screen.getByRole("button", { name: "onboarding:openGuide" }));
    fireEvent.click(screen.getByRole("button", { name: "onboarding:skip" }));
    expect(store.get(STORAGE_KEY)).toBe("true");
    expect(h.track).toHaveBeenCalledWith("onboarding_skip", { step: 0 });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(container).toBeEmptyDOMElement();
  });

  it("走完 4 步：complete 写 localStorage + onboarding_complete {step:3} + onDismiss", () => {
    const onDismiss = vi.fn();
    renderOnboarding({ onDismiss });
    fireEvent.click(screen.getByRole("button", { name: "onboarding:openGuide" }));
    for (let i = 1; i <= 4; i++) {
      fireEvent.click(screen.getByRole("button", { name: `onboarding:step${i}.cta` }));
    }
    expect(store.get(STORAGE_KEY)).toBe("true");
    expect(h.track).toHaveBeenCalledWith("onboarding_complete", { step: 3 });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "onboarding:openGuide" })).not.toBeInTheDocument();
  });

  it("引导进行中 taskCount 变 >0：step1 跳过到 step2（badge current=3）", () => {
    const { rerender } = renderOnboarding();
    fireEvent.click(screen.getByRole("button", { name: "onboarding:openGuide" }));
    fireEvent.click(screen.getByRole("button", { name: "onboarding:step1.cta" }));
    expect(screen.getByText(`onboarding:badge:{"current":2,"total":4}`)).toBeInTheDocument();
    rerender(<Onboarding wid={WID} taskCount={1} memberCount={3} onDismiss={vi.fn()} />);
    expect(screen.getByText(`onboarding:badge:{"current":3,"total":4}`)).toBeInTheDocument();
    // 跳过后 CTA 是 step3 的（前往成员页）
    fireEvent.click(screen.getByRole("button", { name: "onboarding:step3.cta" }));
    expect(h.push).toHaveBeenCalledWith(`/w/${WID}/members`);
  });

  it("onboarding_start 只埋点一次（taskCount 0→1→0 重渲染）", () => {
    const { rerender } = renderOnboarding();
    rerender(<Onboarding wid={WID} taskCount={1} memberCount={3} onDismiss={vi.fn()} />);
    rerender(<Onboarding wid={WID} taskCount={0} memberCount={3} onDismiss={vi.fn()} />);
    const starts = h.track.mock.calls.filter(([name]) => name === "onboarding_start");
    expect(starts).toHaveLength(1);
  });
});
