// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

/**
 * 白板工具栏契约（components/whiteboard/WhiteboardToolbar.tsx）：
 *  - role=toolbar + aria-label=whiteboard:title
 *  - 7 个工具按钮（select/sticky/text/rectangle/ellipse/arrow/delete），aria-label/title 走 whiteboard 命名空间
 *  - 当前工具 aria-pressed=true 且带激活底色；其余 false
 *  - delete 前有分隔线（aria-hidden）
 *  - 点击任意工具回调 onToolChange(id)
 */
vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}:${key}`,
}));

import { WhiteboardToolbar, type WhiteboardTool } from "@/components/whiteboard/WhiteboardToolbar";

const TOOL_KEYS: Array<[WhiteboardTool, string]> = [
  ["select", "toolSelect"],
  ["sticky", "toolSticky"],
  ["text", "toolText"],
  ["rectangle", "toolRectangle"],
  ["ellipse", "toolEllipse"],
  ["arrow", "toolArrow"],
  ["delete", "toolDelete"],
];

describe("WhiteboardToolbar", () => {
  it("toolbar 语义 + 七个工具按钮（aria-label 走 whiteboard 命名空间）", () => {
    const { getByRole, getAllByRole } = render(
      <WhiteboardToolbar tool="select" onToolChange={vi.fn()} />,
    );
    expect(getByRole("toolbar").getAttribute("aria-label")).toBe("whiteboard:title");
    const buttons = getAllByRole("button");
    expect(buttons).toHaveLength(7);
    for (const [, key] of TOOL_KEYS) {
      expect(getByRole("button", { name: `whiteboard:${key}` })).toBeTruthy();
    }
  });

  it("aria-pressed 只标记当前工具，且带激活类", () => {
    const { getByRole } = render(<WhiteboardToolbar tool="sticky" onToolChange={vi.fn()} />);
    const active = getByRole("button", { name: "whiteboard:toolSticky" });
    expect(active.getAttribute("aria-pressed")).toBe("true");
    expect(active.className).toContain("bg-[var(--accent)]");
    const other = getByRole("button", { name: "whiteboard:toolSelect" });
    expect(other.getAttribute("aria-pressed")).toBe("false");
  });

  it("delete 工具前有分隔线（aria-hidden 竖线）", () => {
    const { container } = render(<WhiteboardToolbar tool="select" onToolChange={vi.fn()} />);
    const divider = container.querySelector('span[aria-hidden="true"].w-px')!;
    expect(divider).toBeTruthy();
    // 分隔线与 delete 按钮同组：它是该组内唯一按钮的前置兄弟
    expect(divider.parentElement!.querySelectorAll("button")).toHaveLength(1);
    expect(divider.parentElement!.querySelector("button")!.getAttribute("aria-label")).toBe(
      "whiteboard:toolDelete",
    );
  });

  it("点击任一工具：onToolChange(id)", () => {
    const onToolChange = vi.fn();
    const { getByRole } = render(<WhiteboardToolbar tool="select" onToolChange={onToolChange} />);
    for (const [id, key] of TOOL_KEYS) {
      fireEvent.click(getByRole("button", { name: `whiteboard:${key}` }));
      expect(onToolChange).toHaveBeenLastCalledWith(id);
    }
    expect(onToolChange).toHaveBeenCalledTimes(7);
  });
});
