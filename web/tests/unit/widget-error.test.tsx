// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

import { WidgetError } from "@/components/dashboard/widgets/WidgetError";

/**
 * Widget 错误态组件契约（dashboard/widgets/WidgetError.tsx）：
 *  - 固定展示 dashboard:loadFailed 文案 + AlertTriangle 图标
 *  - message 有值才展示（truncate 单行）；null 时不渲染附带信息行
 *  - 重试按钮文案 button:retry，点击回调 onRetry
 */
vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}:${key}`,
}));

describe("WidgetError", () => {
  it("基础形态：图标 + 失败文案 + 重试按钮（无 message 时不渲染附加行）", () => {
    const { getByText, container, queryByText } = render(
      <WidgetError message={null} onRetry={vi.fn()} />,
    );
    expect(container.querySelector("svg.lucide-alert-triangle")).toBeTruthy();
    expect(getByText("dashboard:loadFailed")).toBeTruthy();
    expect(getByText("button:retry")).toBeTruthy();
    // 只有 loadFailed 与 retry 两段文案
    expect(container.querySelectorAll("p").length).toBe(1);
    expect(queryByText(/boom/)).toBeNull();
  });

  it("message 有值：额外渲染一行（truncate 单行显示）", () => {
    const { getByText } = render(<WidgetError message="boom: network 500" onRetry={vi.fn()} />);
    const msg = getByText("boom: network 500");
    expect(msg.className).toContain("truncate");
  });

  it("点击重试：onRetry 被调用", () => {
    const onRetry = vi.fn();
    const { getByText } = render(<WidgetError message={null} onRetry={onRetry} />);
    fireEvent.click(getByText("button:retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
