// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";

/**
 * Widget 配置面板契约（components/dashboard/WidgetConfigPanel.tsx）：
 *  - portal 到 document.body（不能被卡片的 overflow-hidden / transform 裁掉）
 *  - 按 widgetId 声明式渲染字段：已知 id 出对应控件，未知 id 出「无配置项」占位
 *  - select 变更回写 **原始类型**（数字仍是数字）并合并既有 config
 *  - toggle 以 aria-checked 反映布尔值，点击取反
 *  - Esc / 遮罩点击 / 底部完成按钮 / 右上 X 都走 onClose；面板内点击不关
 *  - 首帧不渲染（createPortal 需 document），挂载后把焦点移入面板
 */
const h = vi.hoisted(() => ({ useReducedMotion: vi.fn() }));

vi.mock("framer-motion", async () => {
  const React = await import("react");
  type DivProps = React.ComponentPropsWithoutRef<"div"> & {
    initial?: unknown;
    animate?: unknown;
    transition?: unknown;
    style?: Record<string, unknown>;
  };
  const MotionDiv = React.forwardRef<HTMLDivElement, DivProps>((props, ref) => {
    const { initial: _i, animate: _a, transition: _t, style, ...rest } = props;
    return React.createElement("div", { ...rest, style, ref });
  });
  MotionDiv.displayName = "MotionDiv";
  return { motion: { div: MotionDiv }, useReducedMotion: h.useReducedMotion };
});

vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}:${key}:${JSON.stringify(vars)}` : `${ns}:${key}`,
}));

import WidgetConfigPanel from "@/components/dashboard/WidgetConfigPanel";

const baseProps = () => ({
  widgetId: "task-stats",
  config: {} as Record<string, unknown>,
  onChange: vi.fn(),
  onClose: vi.fn(),
});

beforeEach(() => {
  document.body.innerHTML = "";
  h.useReducedMotion.mockReturnValue(false);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("portal 与骨架", () => {
  it("渲染到 document.body，容器本身为空；标题/关闭/完成按钮齐备", () => {
    const { container, getByRole, getByText } = render(<WidgetConfigPanel {...baseProps()} />);

    expect(container.firstChild).toBeNull();
    const dialog = getByRole("dialog");
    // 顶层是遮罩，遮罩挂在 body 上（dialog 是其子节点）
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("dashboard:widgetConfig");
    expect(getByText("dashboard:widgetConfig")).toBeTruthy();
    expect(getByText("dashboard:widgetConfigDone")).toBeTruthy();
    expect(dialog.querySelector('[aria-label="dashboard:close"]')).toBeTruthy();
  });

  it("挂载后焦点移入面板", async () => {
    const { getByRole } = render(<WidgetConfigPanel {...baseProps()} />);
    const dialog = getByRole("dialog");
    await waitFor(() => expect(document.activeElement).toBe(dialog));
  });

  it("prefers-reduced-motion：退化为瞬时（initial=false 不抛错）", () => {
    h.useReducedMotion.mockReturnValue(true);
    const { getByRole } = render(<WidgetConfigPanel {...baseProps()} />);
    expect(getByRole("dialog")).toBeTruthy();
  });
});

describe("字段矩阵", () => {
  it("task-stats：时间范围下拉 + 完成率开关", () => {
    const { getByText, getByRole } = render(<WidgetConfigPanel {...baseProps()} />);

    expect(getByText("dashboard:timeRange")).toBeTruthy();
    const select = document.querySelector("select") as HTMLSelectElement;
    expect(select.value).toBe("7d");
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "dashboard:range7d",
      "dashboard:range30d",
      "dashboard:range90d",
    ]);
    expect(getByText("dashboard:showCompletionRate")).toBeTruthy();
    expect(getByRole("switch").getAttribute("aria-checked")).toBe("false");
    expect(document.querySelectorAll("select").length).toBe(1);
  });

  it("各 widgetId 渲染各自的字段标签", () => {
    const cases: [string, string[]][] = [
      ["my-tasks", ["dashboard:displayCount", "dashboard:filterStatus"]],
      ["due-this-week", ["dashboard:displayCount"]],
      ["team-load", ["dashboard:displayMemberCount"]],
      ["burndown", ["dashboard:timeRange"]],
      ["priority-dist", ["dashboard:chartStyle"]],
      ["recent-activity", ["dashboard:displayCount"]],
      ["decision-actions", ["dashboard:displayCount"]],
      ["custom-chart", ["dashboard:chartType", "dashboard:dataSource"]],
    ];
    for (const [widgetId, labels] of cases) {
      const { unmount } = render(<WidgetConfigPanel {...baseProps()} widgetId={widgetId} />);
      for (const label of labels) {
        expect(document.body.textContent).toContain(label);
      }
      expect(document.querySelectorAll("select").length).toBe(labels.length);
      unmount();
    }
  });

  it("未知 widgetId：显示「无配置项」占位", () => {
    const { getByText } = render(<WidgetConfigPanel {...baseProps()} widgetId="no-such-widget" />);
    expect(getByText("dashboard:widgetConfigNoOptions")).toBeTruthy();
    expect(document.querySelectorAll("select").length).toBe(0);
  });
});

describe("变更回写", () => {
  it("select：合并既有 config，且数字选项保持 number 类型", () => {
    const props = { ...baseProps(), widgetId: "my-tasks", config: { statusFilter: "all" } };
    render(<WidgetConfigPanel {...props} />);

    const limitSelect = document.querySelectorAll("select")[0] as HTMLSelectElement;
    expect(limitSelect.value).toBe("5");
    fireEvent.change(limitSelect, { target: { value: "20" } });
    expect(props.onChange).toHaveBeenCalledWith({ statusFilter: "all", limit: 20 });
  });

  it("select：既有值会回显", () => {
    render(<WidgetConfigPanel {...baseProps()} config={{ timeRange: "90d" }} />);
    expect((document.querySelector("select") as HTMLSelectElement).value).toBe("90d");
  });

  it("toggle：点击取反，布尔值严格 true（不是字符串）", () => {
    const props = baseProps();
    const { getByRole, rerender } = render(<WidgetConfigPanel {...props} />);
    fireEvent.click(getByRole("switch"));
    expect(props.onChange).toHaveBeenCalledWith({ showCompletionRate: true });

    rerender(<WidgetConfigPanel {...props} config={{ showCompletionRate: true }} />);
    expect(getByRole("switch").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(getByRole("switch"));
    expect(props.onChange).toHaveBeenLastCalledWith({ showCompletionRate: false });
  });

  it("toggle：非布尔真值按 Boolean 判为开", () => {
    const { getByRole } = render(
      <WidgetConfigPanel {...baseProps()} config={{ showCompletionRate: 1 }} />,
    );
    expect(getByRole("switch").getAttribute("aria-checked")).toBe("true");
    expect(getByRole("switch").className).toContain("bg-[var(--accent)]");
  });
});

describe("关闭通道", () => {
  it("Escape / 遮罩点击 / 完成按钮 / X 都触发 onClose", () => {
    const props = baseProps();
    const { getByRole, getByText, unmount } = render(<WidgetConfigPanel {...props} />);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(getByRole("dialog"));
    expect(props.onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(getByText("dashboard:widgetConfigDone"));
    expect(props.onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(getByRole("dialog").querySelector('[aria-label="dashboard:close"]')!);
    expect(props.onClose).toHaveBeenCalledTimes(3);
    unmount();
  });

  it("点遮罩关闭、点面板不关", () => {
    const props = baseProps();
    const { getByRole, unmount } = render(<WidgetConfigPanel {...props} />);
    const dialog = getByRole("dialog");
    const overlay = dialog.parentElement as HTMLElement;

    fireEvent.click(dialog);
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.click(overlay);
    expect(props.onClose).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("卸载后移除 Escape 监听", () => {
    const props = baseProps();
    const { unmount } = render(<WidgetConfigPanel {...props} />);
    unmount();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onClose).not.toHaveBeenCalled();
  });
});
