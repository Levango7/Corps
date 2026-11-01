// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRef, type ReactNode } from "react";
import { render, fireEvent, act, waitFor } from "@testing-library/react";

/**
 * 仪表盘 RGL 容器契约（components/dashboard/DashboardGrid.tsx）：
 *  - 加载：GET /dashboard/layout；成功用返回值，失败回退角色默认布局并报错
 *  - 渲染：按 layout 项逐一挂 WidgetCard；空布局出空态
 *  - 编辑：isDraggable/isResizable = editing && 非移动端；断点 sm 关掉拖拽
 *  - 脏标记：RGL onLayoutChange 只在初次加载后生效，编辑退出时 PUT 一次
 *  - 命令式 API：addWidget（去重 / 未知 id 忽略）、getLayoutIds、exportLayout、importLayout
 *  - F7：双击循环尺寸走 SIZE_PRESETS；拖拽释放磁吸弹簧（移动端/自由模式/减动效直接 snap）
 */
const h = vi.hoisted(() => ({
  api: vi.fn(),
  rglProps: null as Record<string, unknown> | null,
}));

vi.mock("next/dynamic", async () => {
  const React = await import("react");
  type StubProps = { children?: ReactNode } & Record<string, unknown>;
  const Stub = (props: StubProps) => {
    h.rglProps = props;
    return React.createElement("div", { "data-testid": "rgl" }, props.children as ReactNode);
  };
  return { default: () => Stub };
});

vi.mock("framer-motion", async () => {
  const React = await import("react");
  type DivProps = React.ComponentPropsWithoutRef<"div"> & {
    initial?: unknown;
    animate?: unknown;
    transition?: unknown;
    onAnimationComplete?: () => void;
  };
  const MotionDiv = (props: DivProps) => {
    const { initial: _i, animate: _a, transition: _t, onAnimationComplete, ...rest } = props;
    const done = React.useRef(onAnimationComplete);
    React.useEffect(() => {
      done.current?.();
    }, []);
    return React.createElement("div", rest);
  };
  return { motion: { div: MotionDiv }, useReducedMotion: () => false };
});

// 注意：翻译函数必须按命名空间缓存成**稳定引用**。DashboardGrid 的 loadLayout 把 `t`
// 放进了 useCallback 依赖，若每次渲染都返回新函数 → 依赖抖动 → effect 重跑 → 死循环。
vi.mock("next-intl", () => {
  const cache = new Map<string, (key: string, vars?: Record<string, unknown>) => string>();
  return {
    useTranslations: (ns: string) => {
      let fn = cache.get(ns);
      if (!fn) {
        fn = (key: string, vars?: Record<string, unknown>) =>
          vars ? `${ns}:${key}:${JSON.stringify(vars)}` : `${ns}:${key}`;
        cache.set(ns, fn);
      }
      return fn;
    },
  };
});

vi.mock("@/lib/api", () => ({ api: h.api }));

vi.mock("@/components/dashboard/widgets", async () => {
  const React = await import("react");
  const StubWidget = ({ wid }: { wid: string }) =>
    React.createElement("span", { "data-widget-body": wid });
  return {
    getWidgetComponent: () => StubWidget,
    getWidgetIcon: () => () => React.createElement("svg", { "data-icon": "w" }),
    getWidgetTitleKey: (id: string) => `title-${id}`,
  };
});

vi.mock("@/components/dashboard/WidgetCard", async () => {
  const React = await import("react");
  type CardProps = {
    title: string;
    widgetId?: string;
    widgetIdOverride?: string;
    children?: ReactNode;
    onRemove?: () => void;
    onCycleSize?: () => string | void;
    dragging?: boolean;
    onConfigChange?: (next: Record<string, unknown>) => void;
  };
  return {
    default: (props: CardProps) =>
      React.createElement(
        "div",
        { "data-card": props.widgetId, "data-dragging": props.dragging ? "1" : "0" },
        React.createElement("span", null, props.title),
        React.createElement("button", { onClick: props.onRemove }, `rm-${props.widgetId}`),
        React.createElement(
          "button",
          { onClick: () => props.onCycleSize?.() },
          `cycle-${props.widgetId}`,
        ),
        React.createElement(
          "button",
          { onClick: () => props.onConfigChange?.({ timeRange: "all" }) },
          `cfg-${props.widgetId}`,
        ),
        props.children,
      ),
  };
});

import DashboardGrid, { type DashboardGridHandle } from "@/components/dashboard/DashboardGrid";

const layoutItem = (i: string, w = 2, h = 2) => ({ i, x: 0, y: 0, w, h });
const props = (extra: Record<string, unknown> = {}) => ({
  wid: "w1",
  role: "member",
  locale: "zh",
  editing: false,
  freeMode: false,
  density: "comfortable" as const,
  ...extra,
});

const flush = async () => {
  // api 的 then/catch/finally 链 + useMotionTokens 的挂载副作用都落在若干次
  // 微任务/宏任务之后；只等 microtask 会漏掉最后一跳，触发 act 警告。
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

beforeEach(() => {
  h.api.mockReset();
  h.rglProps = null;
});

describe("加载分支", () => {
  it("加载中：4 块骨架 + aria-busy", () => {
    h.api.mockReturnValue(new Promise(() => {}));
    const { container } = render(<DashboardGrid {...props()} />);
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(container.querySelectorAll(".animate-pulse").length).toBe(4);
    expect(h.api).toHaveBeenCalledWith("/api/v1/workspaces/w1/dashboard/layout");
  });

  it("成功：按 layout 渲染卡片与 Widget 内容", async () => {
    h.api.mockResolvedValue({ layout: [layoutItem("a"), layoutItem("b", 4, 3)] });
    const { container } = render(<DashboardGrid {...props()} />);
    await flush();

    expect(container.querySelectorAll("[data-card]").length).toBe(2);
    expect(container.textContent).toContain("dashboard:title-a");
    expect(container.textContent).toContain("dashboard:title-b");
    expect(container.querySelectorAll("[data-widget-body]").length).toBe(2);
  });

  it("失败：回退角色默认布局并提示 loadLayoutFailed", async () => {
    h.api.mockRejectedValue(new Error("nope"));
    const { container } = render(<DashboardGrid {...props({ role: "viewer" })} />);
    await flush();

    expect(container.textContent).toContain("dashboard:loadLayoutFailed");
    expect(container.querySelectorAll("[data-card]").length).toBeGreaterThan(0);
  });

  it("空布局：出空态文案", async () => {
    h.api.mockResolvedValue({ layout: [] });
    const { container } = render(<DashboardGrid {...props()} />);
    await flush();
    expect(container.textContent).toContain("dashboard:emptyLayout");
  });

  it("服务端带回 freeMode / density：回传父级；RGL 间距随密度", async () => {
    const onFreeModeChange = vi.fn();
    const onDensityChange = vi.fn();
    h.api.mockResolvedValue({
      layout: [layoutItem("a")],
      freeMode: true,
      density: "compact",
    });
    const { rerender } = render(
      <DashboardGrid {...props({ onFreeModeChange, onDensityChange, density: "compact" })} />,
    );
    await flush();
    expect(onFreeModeChange).toHaveBeenCalledWith(true);
    expect(onDensityChange).toHaveBeenCalledWith("compact");
    expect(h.rglProps?.margin).toEqual([8, 8]);

    rerender(<DashboardGrid {...props({ density: "spacious" })} />);
    expect(h.rglProps?.margin).toEqual([20, 20]);
  });
});

describe("RGL 参数", () => {
  it("非编辑：不可拖拽不可缩放；编辑：可拖拽可缩放且挂 drag-handle", async () => {
    h.api.mockResolvedValue({ layout: [layoutItem("a")] });
    const { rerender } = render(<DashboardGrid {...props()} />);
    await flush();
    expect(h.rglProps?.isDraggable).toBe(false);
    expect(h.rglProps?.isResizable).toBe(false);

    rerender(<DashboardGrid {...props({ editing: true })} />);
    expect(h.rglProps?.isDraggable).toBe(true);
    expect(h.rglProps?.isResizable).toBe(true);
    expect(h.rglProps?.draggableHandle).toBe(".drag-handle");
  });

  it("移动端断点 sm：即使编辑模式也禁用拖拽/缩放", async () => {
    h.api.mockResolvedValue({ layout: [layoutItem("a")] });
    render(<DashboardGrid {...props({ editing: true })} />);
    await flush();

    act(() => {
      (h.rglProps?.onBreakpointChange as (bp: string) => void)("sm");
    });
    expect(h.rglProps?.isDraggable).toBe(false);
    expect(h.rglProps?.isResizable).toBe(false);
  });

  it("自由模式：compactType=null + allowOverlap", async () => {
    h.api.mockResolvedValue({ layout: [layoutItem("a")] });
    render(<DashboardGrid {...props({ freeMode: true })} />);
    await flush();
    expect(h.rglProps?.compactType).toBeNull();
    expect(h.rglProps?.allowOverlap).toBe(true);
  });
});

describe("脏标记与保存", () => {
  it("初次加载后的 onLayoutChange 才计入脏；编辑退出时 PUT 一次（带配置/自由模式/密度）", async () => {
    h.api.mockResolvedValue({ layout: [layoutItem("a")] });
    const onLayoutChange = vi.fn();
    const { rerender } = render(<DashboardGrid {...props({ editing: true, onLayoutChange })} />);
    await flush();

    act(() => {
      (h.rglProps?.onLayoutChange as (l: unknown) => void)([layoutItem("a", 6, 4)]);
    });
    expect(onLayoutChange).toHaveBeenCalledWith([layoutItem("a", 6, 4)]);

    rerender(<DashboardGrid {...props({ editing: false })} />);
    await flush();

    const put = h.api.mock.calls.find((c) => c[1]?.method === "PUT");
    expect(put).toBeTruthy();
    expect(put?.[0]).toBe("/api/v1/workspaces/w1/dashboard/layout");
    const body = JSON.parse(String(put?.[1]?.body));
    expect(body.layout).toEqual([layoutItem("a", 6, 4)]);
    expect(body.widgetConfigs).toEqual({});
    expect(body.freeMode).toBe(false);
    expect(body.density).toBe("comfortable");
  });

  it("无脏数据：退出编辑不发 PUT", async () => {
    h.api.mockResolvedValue({ layout: [layoutItem("a")] });
    const { rerender } = render(<DashboardGrid {...props({ editing: true })} />);
    await flush();
    rerender(<DashboardGrid {...props({ editing: false })} />);
    await flush();
    expect(h.api.mock.calls.some((c) => c[1]?.method === "PUT")).toBe(false);
  });

  it("保存失败：提示 saveLayoutFailed", async () => {
    h.api.mockResolvedValueOnce({ layout: [layoutItem("a")] });
    h.api.mockRejectedValueOnce(new Error("put failed"));
    const { rerender, container } = render(<DashboardGrid {...props({ editing: true })} />);
    await flush();

    act(() => {
      (h.rglProps?.onLayoutChange as (l: unknown) => void)([layoutItem("a", 3, 3)]);
    });
    rerender(<DashboardGrid {...props({ editing: false })} />);
    await flush();
    expect(container.textContent).toContain("dashboard:saveLayoutFailed");
  });
});

describe("命令式 API", () => {
  const mountWithRef = async (extra: Record<string, unknown> = {}) => {
    h.api.mockResolvedValue({ layout: [layoutItem("a")] });
    const ref = createRef<DashboardGridHandle>();
    const utils = render(<DashboardGrid ref={ref} {...props(extra)} />);
    await flush();
    return { ref, ...utils };
  };

  it("getLayoutIds / addWidget：追加到最大 y 之下，重复与未知 id 幂等", async () => {
    const { ref } = await mountWithRef();

    expect(ref.current?.getLayoutIds()).toEqual(["a"]);

    act(() => ref.current?.addWidget("burndown"));
    expect(ref.current?.getLayoutIds()).toEqual(["a", "burndown"]);
    const added = (h.rglProps?.layouts as { lg: { i: string; y: number; w: number }[] }).lg[1];
    expect(added.y).toBe(2); // 既有 a: y0+h2
    expect(added.w).toBe(9); // WIDGET_REGISTRY.burndown.defaultW

    act(() => ref.current?.addWidget("burndown"));
    expect(ref.current?.getLayoutIds()).toEqual(["a", "burndown"]);

    act(() => ref.current?.addWidget("no-such-widget"));
    expect(ref.current?.getLayoutIds()).toEqual(["a", "burndown"]);
  });

  it("删除卡片：从布局移除", async () => {
    const { ref, getByText, container } = await mountWithRef();
    fireEvent.click(getByText("rm-a"));
    expect(ref.current?.getLayoutIds()).toEqual([]);
    expect(container.textContent).toContain("dashboard:emptyLayout");
  });

  it("双击循环尺寸：S → M，并返回标签", async () => {
    const { getByText } = await mountWithRef();
    fireEvent.click(getByText("cycle-a"));
    const lg = (h.rglProps?.layouts as { lg: { i: string; w: number; h: number }[] }).lg;
    expect(lg[0]).toMatchObject({ i: "a", w: 4, h: 3 });
  });

  it("配置变更：写入 widgetConfigs，下次保存带上", async () => {
    h.api.mockResolvedValue({ layout: [layoutItem("a")] });
    const ref = createRef<DashboardGridHandle>();
    const { rerender, getByText } = render(
      <DashboardGrid ref={ref} {...props({ editing: true })} />,
    );
    await flush();
    fireEvent.click(getByText("cfg-a"));

    rerender(<DashboardGrid ref={ref} {...props({ editing: false })} />);
    await flush();
    const put = h.api.mock.calls.find((c) => c[1]?.method === "PUT");
    expect(JSON.parse(String(put?.[1]?.body)).widgetConfigs).toEqual({
      a: { timeRange: "all" },
    });
  });

  it("exportLayout：GET /layout/export，缺配置补空对象", async () => {
    const { ref } = await mountWithRef();
    h.api.mockResolvedValueOnce({
      layout: [layoutItem("x")],
      name: "模板",
      exportedAt: "2026-01-01T00:00:00.000Z",
    });

    const out = await ref.current?.exportLayout();
    expect(h.api).toHaveBeenLastCalledWith("/api/v1/workspaces/w1/dashboard/layout/export");
    expect(out).toEqual({
      layout: [layoutItem("x")],
      widgetConfigs: {},
      name: "模板",
      exportedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("importLayout：POST 后重新加载；失败返回 false 并报错", async () => {
    const { ref, container } = await mountWithRef();
    h.api.mockResolvedValueOnce(undefined);
    h.api.mockResolvedValueOnce({ layout: [layoutItem("b")] });

    let ok: boolean | undefined;
    await act(async () => {
      ok = await ref.current?.importLayout({ layout: [layoutItem("b")] });
    });
    expect(ok).toBe(true);
    expect(h.api).toHaveBeenCalledWith("/api/v1/workspaces/w1/dashboard/layout/import", {
      method: "POST",
      body: JSON.stringify({ layout: [layoutItem("b")], widgetConfigs: {} }),
    });
    expect(ref.current?.getLayoutIds()).toEqual(["b"]);

    h.api.mockRejectedValueOnce(new Error("import failed"));
    let failed: boolean | undefined;
    await act(async () => {
      failed = await ref.current?.importLayout({ layout: [] });
    });
    expect(failed).toBe(false);
    expect(container.textContent).toContain("dashboard:saveLayoutFailed");
  });
});

describe("F7 拖拽反馈与磁吸", () => {
  it("拖拽中标记卡片；释放后播弹簧并清标记", async () => {
    h.api.mockResolvedValue({ layout: [layoutItem("a")] });
    render(<DashboardGrid {...props()} />);
    await flush();

    act(() => {
      (h.rglProps?.onDragStart as (c: unknown, o: unknown, n: { i: string }) => void)(
        [],
        {},
        { i: "a" },
      );
    });
    expect(document.querySelector('[data-card="a"]')?.getAttribute("data-dragging")).toBe("1");

    act(() => {
      (h.rglProps?.onDragStop as (c: unknown, o: unknown, n: { i: string }) => void)(
        [],
        {},
        { i: "a" },
      );
    });
    await waitFor(() =>
      expect(document.querySelector('[data-card="a"]')?.getAttribute("data-dragging")).toBe("0"),
    );
  });

  it("移动端断点释放：直接 snap，不播放弹簧", async () => {
    h.api.mockResolvedValue({ layout: [layoutItem("a")] });
    render(<DashboardGrid {...props()} />);
    await flush();
    act(() => {
      (h.rglProps?.onBreakpointChange as (bp: string) => void)("sm");
      (h.rglProps?.onDragStart as (c: unknown, o: unknown, n: { i: string }) => void)(
        [],
        {},
        { i: "a" },
      );
    });
    act(() => {
      (h.rglProps?.onDragStop as (c: unknown, o: unknown, n: { i: string }) => void)(
        [],
        {},
        { i: "a" },
      );
    });
    expect(document.querySelector('[data-card="a"]')?.getAttribute("data-dragging")).toBe("0");
  });
});
