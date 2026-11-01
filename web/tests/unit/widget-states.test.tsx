// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import { WidgetEmpty, WidgetSkeleton } from "@/components/dashboard/widgets/WidgetStates";
import { WidgetError as ReExportedWidgetError } from "@/components/dashboard/widgets/WidgetStates";
import { WidgetError } from "@/components/dashboard/widgets/WidgetError";

/**
 * Widget 共享状态组件契约（dashboard/widgets/WidgetStates.tsx）：
 *  - WidgetSkeleton：lines 行 shimmer 占位（默认 3）+ aria-busy；宽度错落（maxWidth 60%~95%）
 *  - WidgetEmpty：Inbox 图标（aria 无关，装饰）+ 文案
 *  - 从 WidgetStates 再导出的 WidgetError 与 WidgetError.tsx 是同一实现（导入路径兼容承诺）
 */
const skeletonRows = (container: HTMLElement) => container.querySelectorAll(".shimmer");

describe("WidgetSkeleton", () => {
  it("默认 3 行占位 + aria-busy", () => {
    const { container } = render(<WidgetSkeleton />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute("aria-busy")).toBe("true");
    expect(skeletonRows(container).length).toBe(3);
  });

  it("lines 指定行数（1 / 5）", () => {
    expect(skeletonRows(render(<WidgetSkeleton lines={1} />).container).length).toBe(1);
    expect(skeletonRows(render(<WidgetSkeleton lines={5} />).container).length).toBe(5);
  });

  it("行宽错落：maxWidth 在 60%~95% 间且非全同（避免机械感）", () => {
    const { container } = render(<WidgetSkeleton lines={4} />);
    const widths = Array.from(skeletonRows(container)).map(
      (el) => (el as HTMLElement).style.maxWidth,
    );
    expect(widths.every((w) => /%$/.test(w))).toBe(true);
    expect(new Set(widths).size).toBeGreaterThan(1);
    for (const w of widths) {
      const n = parseInt(w, 10);
      expect(n).toBeGreaterThanOrEqual(60);
      expect(n).toBeLessThanOrEqual(95);
    }
  });
});

describe("WidgetEmpty", () => {
  it("渲染文案 + Inbox 图标（lucide-inbox）", () => {
    const { getByText, container } = render(<WidgetEmpty text="暂无数据" />);
    expect(getByText("暂无数据")).toBeTruthy();
    expect(container.querySelector("svg.lucide-inbox")).toBeTruthy();
  });
});

describe("导入路径兼容", () => {
  it("WidgetStates 再导出的 WidgetError 与独立模块是同一函数", () => {
    expect(ReExportedWidgetError).toBe(WidgetError);
  });
});
