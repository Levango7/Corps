// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act, within } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * ClientLayout 契约（components/ClientLayout.tsx，default 导出）：
 *  - children 包裹在 div.page-enter 内
 *  - 内部包 ToastProvider：子组件可 useToast() 触发 toast（真实集成，不 mock Provider）
 *  - toast 显示为 role=alert，容器 role=region（aria-live polite，aria-label toast:regionLabel）
 *  - 类型着色 success/error；多条并存；关闭按钮 / 点击本体移除单条
 *  - 3500ms 自动关闭；悬停暂停、移出恢复倒计时；初始相对时间显示 "刚刚"
 *  - ToastProvider 之外使用 useToast 抛错
 *
 * Mock 策略：framer-motion 的 motion.div / AnimatePresence 在 jsdom 无动画引擎，
 * 按仓内惯例（animated-list.test.tsx）mock 为透传节点并剥离动画 props。
 */

vi.mock("framer-motion", () => ({
  motion: {
    // 剥离 framer-motion 专有 props，其余（role/style/className/onClick…）透传
    div: ({
      layout: _layout,
      variants: _variants,
      initial: _initial,
      animate: _animate,
      exit: _exit,
      ...rest
    }: Record<string, unknown>) => <div {...rest}>{rest.children as ReactNode}</div>,
  },
  AnimatePresence: ({ children }: Record<string, unknown>) => <>{children as ReactNode}</>,
  useReducedMotion: () => false,
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

import ClientLayout from "@/components/ClientLayout";
import { useToast } from "@/components/Toast";

/** 触发 success toast 的测试子组件 */
function ToastTrigger() {
  const { toast } = useToast();
  return <button onClick={() => toast("success", "已保存")}>fire</button>;
}

/** 触发 info toast 的测试子组件（不同按钮名与消息，供多条场景区分） */
function SecondTrigger() {
  const { toast } = useToast();
  return <button onClick={() => toast("info", "第二条")}>fire-second</button>;
}

function fireBoth() {
  render(
    <ClientLayout>
      <ToastTrigger />
      <SecondTrigger />
    </ClientLayout>,
  );
  fireEvent.click(screen.getByRole("button", { name: "fire" }));
  fireEvent.click(screen.getByRole("button", { name: "fire-second" }));
}

beforeEach(() => {
  // 本仓 jsdom 无 requestAnimationFrame（framer-motion 内部需要）：同步桩
  vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => {
    cb(0);
    return 0;
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe("ClientLayout", () => {
  it("children 渲染在 div.page-enter 内", () => {
    const { container } = render(
      <ClientLayout>
        <p>页面内容</p>
      </ClientLayout>,
    );
    const wrapper = container.querySelector("div.page-enter");
    expect(wrapper).toBeInTheDocument();
    expect(wrapper).toHaveTextContent("页面内容");
  });

  it("ToastProvider 提供 context：子组件 useToast 拿到 toast 函数且可调用", async () => {
    render(
      <ClientLayout>
        <ToastTrigger />
      </ClientLayout>,
    );
    fireEvent.click(screen.getByRole("button", { name: "fire" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("已保存");
  });

  it("ToastProvider 之外使用 useToast → 抛错", () => {
    function Orphan() {
      useToast();
      return null;
    }
    expect(() => render(<Orphan />)).toThrow(/useToast must be used within a ToastProvider/);
  });

  it("toast 显示为 role=alert，region 容器 aria-live=polite + toast:regionLabel", async () => {
    fireBoth();
    const region = screen.getByRole("region", { name: "toast:regionLabel" });
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText("已保存")).toBeInTheDocument();
  });

  it("类型着色：success → var(--success-soft) 背景，error → var(--danger-soft)", async () => {
    render(
      <ClientLayout>
        <ToastTrigger />
        <ErrorTrigger />
      </ClientLayout>,
    );
    fireEvent.click(screen.getByRole("button", { name: "fire" }));
    fireEvent.click(screen.getByRole("button", { name: "fire-error" }));
    // 两条 toast 同时在 DOM：单数 findByRole 会多命中重试到超时
    const alerts = await screen.findAllByRole("alert");
    // 断言内联 style（CSS 变量在 jsdom 不做求值，直接比对原始声明）
    expect(alerts[0].style.background).toBe("var(--success-soft)");
    expect(alerts[1].style.background).toBe("var(--danger-soft)");
  });

  it("多条 toast 并存（role=alert 全部可见）", async () => {
    fireBoth();
    // 两条同屏：用复数查询（单数 findByRole 遇多命中会在 waitFor 里重试到超时）
    const alerts = await screen.findAllByRole("alert");
    expect(alerts).toHaveLength(2);
    expect(screen.getByText("已保存")).toBeInTheDocument();
    expect(screen.getByText("第二条")).toBeInTheDocument();
  });

  it("关闭按钮（toast:close）只移除对应那条", async () => {
    fireBoth();
    const alerts = await screen.findAllByRole("alert");
    expect(alerts).toHaveLength(2);
    fireEvent.click(within(alerts[0]).getByRole("button", { name: "toast:close" }));
    expect(screen.queryByText("已保存")).not.toBeInTheDocument();
    expect(screen.getByText("第二条")).toBeInTheDocument();
  });

  it("点击 toast 本体移除该条", async () => {
    render(
      <ClientLayout>
        <ToastTrigger />
      </ClientLayout>,
    );
    fireEvent.click(screen.getByRole("button", { name: "fire" }));
    const alert = await screen.findByRole("alert");
    fireEvent.click(alert);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("初始相对时间显示「刚刚」", async () => {
    render(
      <ClientLayout>
        <ToastTrigger />
      </ClientLayout>,
    );
    fireEvent.click(screen.getByRole("button", { name: "fire" }));
    await screen.findByRole("alert");
    expect(screen.getByText("刚刚")).toBeInTheDocument();
  });

  describe("自动关闭（fake timers）", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    async function fireWithFakeTimers() {
      render(
        <ClientLayout>
          <ToastTrigger />
        </ClientLayout>,
      );
      fireEvent.click(screen.getByRole("button", { name: "fire" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByRole("alert")).toHaveTextContent("已保存");
    }

    it("3500ms 后自动关闭", async () => {
      await fireWithFakeTimers();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3500);
      });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("悬停暂停倒计时，移出后按剩余时间恢复关闭", async () => {
      await fireWithFakeTimers();
      const alert = screen.getByRole("alert");
      fireEvent.mouseEnter(alert);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(screen.getByRole("alert")).toBeInTheDocument();
      fireEvent.mouseLeave(alert);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3500);
      });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });
});

/** 触发 error toast 的测试子组件 */
function ErrorTrigger() {
  const { toast } = useToast();
  return <button onClick={() => toast("error", "失败了")}>fire-error</button>;
}
