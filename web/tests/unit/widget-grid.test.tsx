// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, within, cleanup } from "@testing-library/react";

/**
 * WidgetGrid 契约（components/WidgetGrid.tsx，default 导出）：
 *  - CSS Grid 容器：role=region、aria-label、12 列模板 / gap 12 / gridAutoRows 56
 *  - item：aria-label=title、grid 定位样式（x/y/w/h → gridColumn/Row + minHeight=h*56）
 *  - 布局：优先 initialLayout，否则 widgets.defaultPosition
 *  - 拖拽（HTML5 DnD）：dragStart 记录 id（dataTransfer）+ opacity 0.4；dragOver 目标虚线高亮；
 *    dragEnd 清除；drop 交换 source/target 的 x/y → onLayoutChange；无 sourceId / 自身 drop 不动
 *  - resize：右下角手柄（role=separator）mousedown 后 window mousemove 实时改 w/h
 *    （钳制 w∈[2,12]、h∈[1,8]，期间不通知外部），mouseup 一次性通知
 *  - readOnly：不可拖拽（draggable=false）、无 grip / resize 手柄 / editable class
 *
 * 实测边界说明：jsdom 30 无 DragEvent 构造器，但 fireEvent.dragStart/dragOver/drop 会回退为
 * 基础 Event 并把 dataTransfer 对象挂到事件上（RTL 已验证），因此 DnD 回调链路可真实驱动，
 * 断言基于真实回调参数与 DOM 样式，非恒真。
 */

import WidgetGrid, { type Widget } from "@/components/WidgetGrid";

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

const WIDGETS: Widget[] = [
  {
    id: "a",
    title: "卡片A",
    component: <div>组件A内容</div>,
    defaultPosition: { x: 0, y: 0, w: 4, h: 2 },
  },
  {
    id: "b",
    title: "卡片B",
    component: <div>组件B内容</div>,
    defaultPosition: { x: 4, y: 0, w: 4, h: 3 },
  },
];

/** jsdom 无 DataTransfer：最小桩（RTL 会把该对象挂到拖拽事件上） */
function makeDataTransfer(getValue = "") {
  return {
    dropEffect: "none",
    effectAllowed: "all",
    files: [],
    types: [],
    setData: vi.fn(),
    getData: vi.fn(() => getValue),
  } as unknown as DataTransfer;
}

function renderGrid(
  props: {
    onLayoutChange?: (l: unknown) => void;
    initialLayout?: Record<string, { x: number; y: number; w: number; h: number }>;
    readOnly?: boolean;
  } = {},
) {
  return render(
    <WidgetGrid
      widgets={WIDGETS}
      onLayoutChange={props.onLayoutChange}
      initialLayout={props.initialLayout}
      readOnly={props.readOnly}
    />,
  );
}

beforeEach(() => {});
afterEach(() => {
  cleanup();
});

describe("WidgetGrid 容器与布局", () => {
  it("网格容器：role=region + aria-label + 12 列/gap/gridAutoRows 样式", () => {
    renderGrid();
    const grid = screen.getByRole("region", { name: "widget:gridAriaLabel" });
    expect(grid).toHaveStyle({ display: "grid" });
    expect(grid.style.gridTemplateColumns).toBe("repeat(12, minmax(0, 1fr))");
    expect(grid.style.gap).toBe("12px");
    expect(grid.style.gridAutoRows).toBe("56px");
  });

  it("渲染所有 widget：标题、内容、aria-label=title", () => {
    renderGrid();
    expect(screen.getByText("卡片A")).toBeInTheDocument();
    expect(screen.getByText("组件A内容")).toBeInTheDocument();
    expect(screen.getByText("卡片B")).toBeInTheDocument();
    expect(screen.getByText("组件B内容")).toBeInTheDocument();
    expect(screen.getByLabelText("卡片A")).toBeInTheDocument();
    expect(screen.getByLabelText("卡片B")).toBeInTheDocument();
  });

  it("默认布局：defaultPosition → grid 定位样式（含 minHeight=h*56）", () => {
    const { container } = renderGrid();
    const itemA = container.querySelector('[aria-label="卡片A"]') as HTMLElement;
    expect(itemA.style.gridColumnStart).toBe("1");
    expect(itemA.style.gridColumnEnd).toBe("5");
    expect(itemA.style.gridRowStart).toBe("1");
    expect(itemA.style.gridRowEnd).toBe("3");
    expect(itemA.style.minHeight).toBe("112px");
  });

  it("initialLayout 覆盖 defaultPosition", () => {
    const { container } = renderGrid({
      initialLayout: { a: { x: 2, y: 1, w: 3, h: 2 }, b: { x: 5, y: 0, w: 4, h: 3 } },
    });
    const itemA = container.querySelector('[aria-label="卡片A"]') as HTMLElement;
    expect(itemA.style.gridColumnStart).toBe("3");
    expect(itemA.style.gridColumnEnd).toBe("6");
    expect(itemA.style.gridRowStart).toBe("2");
    expect(itemA.style.gridRowEnd).toBe("4");
  });
});

describe("WidgetGrid 拖拽交换", () => {
  it("dragStart：记录 widget id 到 dataTransfer、effectAllowed=move，item 进入拖拽态（opacity 0.4）", () => {
    const { container } = renderGrid();
    const itemA = container.querySelector('[aria-label="卡片A"]') as HTMLElement;
    const dt = makeDataTransfer();
    fireEvent.dragStart(itemA, { dataTransfer: dt });
    expect(dt.setData).toHaveBeenCalledWith("text/widget-id", "a");
    expect(dt.effectAllowed).toBe("move");
    expect(itemA.style.opacity).toBe("0.4");
    expect(itemA).toHaveClass("widget-grid__item--dragging");
  });

  it("dragOver：目标 item 虚线高亮 + dropEffect=move；dragEnd 清除拖拽态", () => {
    const { container } = renderGrid();
    const itemA = container.querySelector('[aria-label="卡片A"]') as HTMLElement;
    const itemB = container.querySelector('[aria-label="卡片B"]') as HTMLElement;
    fireEvent.dragStart(itemA, { dataTransfer: makeDataTransfer() });
    const dtOver = makeDataTransfer();
    fireEvent.dragOver(itemB, { dataTransfer: dtOver });
    expect(dtOver.dropEffect).toBe("move");
    expect(itemB.style.outline).toBe("2px dashed var(--accent)");
    expect(itemB).toHaveClass("widget-grid__item--drag-over");
    fireEvent.dragEnd(itemA);
    expect(itemA.style.opacity).toBe("1");
    expect(itemB.style.outline).toBe("");
    expect(itemB).not.toHaveClass("widget-grid__item--drag-over");
  });

  it("drop 交换 source 与 target 的 x/y → onLayoutChange 收到交换后布局，拖拽态清除", () => {
    const onLayoutChange = vi.fn();
    const { container } = renderGrid({ onLayoutChange });
    const itemA = container.querySelector('[aria-label="卡片A"]') as HTMLElement;
    const itemB = container.querySelector('[aria-label="卡片B"]') as HTMLElement;
    fireEvent.dragStart(itemA, { dataTransfer: makeDataTransfer("a") });
    fireEvent.drop(itemB, { dataTransfer: makeDataTransfer("a") });
    expect(onLayoutChange).toHaveBeenCalledTimes(1);
    expect(onLayoutChange).toHaveBeenCalledWith({
      a: { x: 4, y: 0, w: 4, h: 2 },
      b: { x: 0, y: 0, w: 4, h: 3 },
    });
    expect(itemA.style.opacity).toBe("1");
    // 布局真实更新到 DOM
    expect(itemA.style.gridColumnStart).toBe("5");
  });

  it("无 sourceId 或 source===target 的 drop 不改变布局", () => {
    const onLayoutChange = vi.fn();
    const { container } = renderGrid({ onLayoutChange });
    const itemA = container.querySelector('[aria-label="卡片A"]') as HTMLElement;
    const itemB = container.querySelector('[aria-label="卡片B"]') as HTMLElement;
    fireEvent.dragStart(itemA, { dataTransfer: makeDataTransfer("a") });
    fireEvent.drop(itemA, { dataTransfer: makeDataTransfer("a") });
    fireEvent.drop(itemB, { dataTransfer: makeDataTransfer("") });
    expect(onLayoutChange).not.toHaveBeenCalled();
    expect(itemA.style.opacity).toBe("1");
  });
});

describe("WidgetGrid resize", () => {
  it("mousedown 手柄 + mousemove 更新 w/h（DOM 样式），mouseup 一次性通知", () => {
    const onLayoutChange = vi.fn();
    const { container } = renderGrid({ onLayoutChange });
    const itemA = container.querySelector('[aria-label="卡片A"]') as HTMLElement;
    const handleA = itemA.querySelector('[role="separator"]') as HTMLElement;
    fireEvent.mouseDown(handleA, { clientX: 10, clientY: 10 });
    // dx=60 → +1w；dy=120 → +2h（每 56px 一格）
    fireEvent.mouseMove(window, { clientX: 70, clientY: 130 });
    expect(itemA.style.gridColumnEnd).toBe("6");
    expect(itemA.style.gridRowEnd).toBe("5");
    expect(itemA.style.minHeight).toBe("224px");
    expect(itemA).toHaveClass("widget-grid__item--resizing");
    expect(onLayoutChange).not.toHaveBeenCalled();
    fireEvent.mouseUp(window);
    expect(onLayoutChange).toHaveBeenCalledTimes(1);
    expect(onLayoutChange).toHaveBeenCalledWith({
      a: { x: 0, y: 0, w: 5, h: 4 },
      b: { x: 4, y: 0, w: 4, h: 3 },
    });
    expect(itemA).not.toHaveClass("widget-grid__item--resizing");
  });

  it("resize 钳制：负向不低于 MIN（w≥2,h≥1），正向不高于 MAX（w≤12,h≤8）", () => {
    const onLayoutChange = vi.fn();
    const { container } = renderGrid({ onLayoutChange });
    const itemA = container.querySelector('[aria-label="卡片A"]') as HTMLElement;
    const handleA = itemA.querySelector('[role="separator"]') as HTMLElement;
    fireEvent.mouseDown(handleA, { clientX: 0, clientY: 0 });
    fireEvent.mouseMove(window, { clientX: -1000, clientY: -500 });
    expect(itemA.style.gridColumnEnd).toBe("3");
    expect(itemA.style.gridRowEnd).toBe("2");
    fireEvent.mouseMove(window, { clientX: 10000, clientY: 10000 });
    expect(itemA.style.gridColumnEnd).toBe("13");
    expect(itemA.style.gridRowEnd).toBe("9");
    fireEvent.mouseUp(window);
    expect(onLayoutChange).toHaveBeenCalledWith({
      a: { x: 0, y: 0, w: 12, h: 8 },
      b: { x: 4, y: 0, w: 4, h: 3 },
    });
  });

  it("未开始 resize 时 window mousemove 无效果", () => {
    const onLayoutChange = vi.fn();
    const { container } = renderGrid({ onLayoutChange });
    const itemA = container.querySelector('[aria-label="卡片A"]') as HTMLElement;
    fireEvent.mouseMove(window, { clientX: 1000, clientY: 1000 });
    expect(itemA.style.gridColumnEnd).toBe("5");
    expect(itemA.style.minHeight).toBe("112px");
    expect(onLayoutChange).not.toHaveBeenCalled();
  });
});

describe("WidgetGrid 只读与手柄", () => {
  it("非只读：draggable、grip（title=widget:dragMove）与 resize 手柄存在、editable class", () => {
    const { container } = renderGrid();
    const itemA = container.querySelector('[aria-label="卡片A"]') as HTMLElement;
    const itemB = container.querySelector('[aria-label="卡片B"]') as HTMLElement;
    expect(itemA.draggable).toBe(true);
    expect(itemA).toHaveClass("widget-grid__item--editable");
    // 每个 widget 都有 grip 与 resize 手柄（scope 到单项避免多命中）
    expect(within(itemA).getByTitle("widget:dragMove")).toBeInTheDocument();
    expect(within(itemA).getByRole("separator", { name: "widget:resize" })).toBeInTheDocument();
    expect(within(itemB).getByRole("separator", { name: "widget:resize" })).toBeInTheDocument();
  });

  it("readOnly：draggable=false、无 grip、无 resize 手柄、无 editable class，dragStart 不进入拖拽态", () => {
    const { container } = renderGrid({ readOnly: true });
    const itemA = container.querySelector('[aria-label="卡片A"]') as HTMLElement;
    expect(itemA.draggable).toBe(false);
    expect(itemA).not.toHaveClass("widget-grid__item--editable");
    expect(container.querySelector('[title="widget:dragMove"]')).toBeNull();
    expect(container.querySelector('[role="separator"]')).toBeNull();
    fireEvent.dragStart(itemA, { dataTransfer: makeDataTransfer() });
    expect(itemA.style.opacity).toBe("1");
    expect(itemA).not.toHaveClass("widget-grid__item--dragging");
  });
});
