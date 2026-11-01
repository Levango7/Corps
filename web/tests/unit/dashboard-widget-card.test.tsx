// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";

/**
 * Widget 卡片外壳契约（components/dashboard/WidgetCard.tsx）：
 *  - 非编辑：只有标题栏（图标 + 标题 + headerExtra），无拖拽手柄/齿轮/删除
 *  - 编辑：出现 GripVertical、header 挂 drag-handle；齿轮开配置面板、X 走 onRemove
 *  - 双击标题栏 → onCycleSize；返回字符串时以 aria-live 提示 1.5s 后自动消失
 *  - dragging：轻微放大 + 半透明视觉反馈
 *  - 长按内容区 → QuickActionMenu（动作按可用回调动态构建，删除标 danger）
 */
const h = vi.hoisted(() => ({
  longPressCb: null as null | ((pos: { x: number; y: number }) => void),
}));

vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}:${key}:${JSON.stringify(vars)}` : `${ns}:${key}`,
}));

vi.mock("@/components/PinchToZoom", async () => {
  const React = await import("react");
  return {
    PinchToZoom: ({ children }: { children: React.ReactNode }) =>
      React.createElement("div", { "data-testid": "pinch" }, children),
  };
});

vi.mock("@/lib/use-long-press", () => ({
  useLongPress: (cb: (pos: { x: number; y: number }) => void) => {
    h.longPressCb = cb;
    return {
      onPointerDown: () => {},
      onPointerUp: () => {},
      onPointerLeave: () => {},
      onPointerCancel: () => {},
      onContextMenu: () => {},
    };
  },
}));

vi.mock("@/components/QuickActionMenu", async () => {
  const React = await import("react");
  type Action = { label: string; onClick: () => void; danger?: boolean };
  return {
    QuickActionMenu: ({ open, actions }: { open: boolean; actions: Action[] }) =>
      open
        ? React.createElement(
            "div",
            { "data-testid": "quick-actions" },
            actions.map((a) =>
              React.createElement(
                "button",
                { key: a.label, onClick: a.onClick, "data-danger": a.danger ? "1" : "0" },
                a.label,
              ),
            ),
          )
        : null,
  };
});

vi.mock("@/components/dashboard/WidgetConfigPanel", async () => {
  const React = await import("react");
  return {
    default: ({
      widgetId,
      config,
      onChange,
      onClose,
    }: {
      widgetId: string;
      config: Record<string, unknown>;
      onChange: (next: Record<string, unknown>) => void;
      onClose: () => void;
    }) =>
      React.createElement(
        "div",
        { "data-testid": "config-panel", "data-widget": widgetId },
        React.createElement(
          "button",
          { onClick: () => onChange({ ...config, limit: 20 }) },
          "apply",
        ),
        React.createElement("button", { onClick: onClose }, "close-panel"),
      ),
  };
});

import WidgetCard from "@/components/dashboard/WidgetCard";

const Icon = ({ size, className }: { size?: number | string; className?: string }) => (
  <svg data-icon="yes" width={size} className={className} />
);

const renderCard = (props: Partial<React.ComponentProps<typeof WidgetCard>> = {}) =>
  render(
    <WidgetCard title="我的任务" editing={false} {...props}>
      <p>内容</p>
    </WidgetCard>,
  );

beforeEach(() => {
  h.longPressCb = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("基础渲染", () => {
  it("非编辑：只有标题 + 内容，无拖拽手柄/齿轮/删除，header 不带 drag-handle", () => {
    const { container, getByText } = renderCard({ onRemove: vi.fn(), widgetId: "my-tasks" });

    expect(getByText("我的任务")).toBeTruthy();
    expect(getByText("内容")).toBeTruthy();
    expect(container.querySelector("svg.lucide-grip-vertical")).toBeNull();
    expect(container.querySelector('[aria-label="configure widget"]')).toBeNull();
    expect(container.querySelector('[aria-label="remove widget"]')).toBeNull();
    expect(container.querySelector("header")?.className).not.toContain("drag-handle");
  });

  it("图标 / headerExtra / ariaLabel 生效", () => {
    const { container, getByText } = renderCard({
      icon: Icon,
      headerExtra: <span>额外</span>,
      ariaLabel: "自定义标签",
    });
    expect(container.querySelector("svg[data-icon='yes']")).toBeTruthy();
    expect(getByText("额外")).toBeTruthy();
    expect(container.firstElementChild?.getAttribute("aria-label")).toBe("自定义标签");
  });

  it("未传 ariaLabel：回退标题作为 aria-label", () => {
    const { container } = renderCard();
    expect(container.firstElementChild?.getAttribute("aria-label")).toBe("我的任务");
  });

  it("dragging：加放大 + 半透明反馈类", () => {
    const { container } = renderCard({ dragging: true });
    expect(container.firstElementChild?.className).toContain("scale-[1.02]");
    expect(container.firstElementChild?.className).toContain("opacity-90");
  });
});

describe("编辑模式", () => {
  it("显示拖拽手柄 + drag-handle + 齿轮与删除按钮", () => {
    const { container } = renderCard({
      editing: true,
      widgetId: "my-tasks",
      onConfigChange: vi.fn(),
      onRemove: vi.fn(),
    });
    expect(container.querySelector("svg.lucide-grip-vertical")).toBeTruthy();
    expect(container.querySelector("header")?.className).toContain("drag-handle");
    expect(container.querySelector('[aria-label="configure widget"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="remove widget"]')).toBeTruthy();
  });

  it("缺 widgetId/onConfigChange 时不出齿轮；缺 onRemove 时不出删除", () => {
    const { container } = renderCard({ editing: true });
    expect(container.querySelector('[aria-label="configure widget"]')).toBeNull();
    expect(container.querySelector('[aria-label="remove widget"]')).toBeNull();
  });

  it("齿轮打开配置面板，透传 widgetId/config，onChange 转给父级，关闭后卸载", () => {
    const onConfigChange = vi.fn();
    const { container, getByText } = renderCard({
      editing: true,
      widgetId: "burndown",
      config: { timeRange: "all" },
      onConfigChange,
    });

    fireEvent.click(container.querySelector('[aria-label="configure widget"]')!);
    const panel = container.querySelector('[data-testid="config-panel"]');
    expect(panel?.getAttribute("data-widget")).toBe("burndown");

    fireEvent.click(getByText("apply"));
    expect(onConfigChange).toHaveBeenCalledWith({ timeRange: "all", limit: 20 });

    fireEvent.click(getByText("close-panel"));
    expect(container.querySelector('[data-testid="config-panel"]')).toBeNull();
  });

  it("删除按钮触发 onRemove，且不冒泡成标题双击", () => {
    const onRemove = vi.fn();
    const onCycleSize = vi.fn(() => "M");
    const { container } = renderCard({ editing: true, onRemove, onCycleSize });

    fireEvent.click(container.querySelector('[aria-label="remove widget"]')!);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onCycleSize).not.toHaveBeenCalled();
  });
});

describe("双击标题栏切换尺寸", () => {
  it("onCycleSize 返回标签：aria-live 提示出现，1.5s 后消失", () => {
    vi.useFakeTimers();
    const onCycleSize = vi.fn(() => "M");
    const { container, getByText } = renderCard({ onCycleSize });

    fireEvent.doubleClick(container.querySelector("header")!);
    expect(onCycleSize).toHaveBeenCalledTimes(1);
    expect(getByText("M")).toBeTruthy();
    const hint = container.querySelector('[aria-live="polite"]');
    expect(hint?.textContent).toBe("M");

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(container.querySelector('[aria-live="polite"]')).toBeNull();
  });

  it("onCycleSize 无返回值：不出提示", () => {
    const onCycleSize = vi.fn(() => undefined);
    const { container } = renderCard({ onCycleSize });
    fireEvent.doubleClick(container.querySelector("header")!);
    expect(onCycleSize).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[aria-live="polite"]')).toBeNull();
  });

  it("没有 onCycleSize：双击不做事", () => {
    const { container } = renderCard();
    fireEvent.doubleClick(container.querySelector("header")!);
    expect(container.querySelector('[aria-live="polite"]')).toBeNull();
  });
});

describe("长按快捷操作", () => {
  it("无可用回调：即便触发长按回调也不渲染菜单（动作列表为空）", () => {
    const { container } = renderCard();
    act(() => {
      h.longPressCb?.({ x: 1, y: 2 });
    });
    expect(container.querySelector('[data-testid="quick-actions"]')).toBeNull();
  });

  it("有回调：长按后菜单列出全部动作，删除标 danger", () => {
    const props = {
      widgetId: "my-tasks",
      config: {},
      onConfigChange: vi.fn(),
      onFullscreen: vi.fn(),
      onRefresh: vi.fn(),
      onRemove: vi.fn(),
    };
    const { container, getByText } = renderCard(props);

    act(() => {
      h.longPressCb?.({ x: 12, y: 34 });
    });

    const menu = container.querySelector('[data-testid="quick-actions"]');
    expect(menu).toBeTruthy();
    const labels = Array.from(menu!.querySelectorAll("button")).map((b) => b.textContent);
    expect(labels).toEqual([
      "widget:config",
      "widget:fullscreen",
      "widget:refresh",
      "widget:remove",
    ]);
    expect(menu!.querySelector('button[data-danger="1"]')?.textContent).toBe("widget:remove");

    fireEvent.click(menu!.querySelectorAll("button")[1]);
    expect(props.onFullscreen).toHaveBeenCalledTimes(1);
    fireEvent.click(menu!.querySelectorAll("button")[2]);
    expect(props.onRefresh).toHaveBeenCalledTimes(1);
    fireEvent.click(menu!.querySelectorAll("button")[3]);
    expect(props.onRemove).toHaveBeenCalledTimes(1);
    fireEvent.click(getByText("widget:config"));
  });

  it("仅 onRemove：菜单只有一项", () => {
    const { container } = renderCard({ onRemove: vi.fn() });
    act(() => {
      h.longPressCb?.({ x: 0, y: 0 });
    });
    const buttons = container.querySelectorAll('[data-testid="quick-actions"] button');
    expect(buttons.length).toBe(1);
    expect(buttons[0].textContent).toBe("widget:remove");
  });
});
