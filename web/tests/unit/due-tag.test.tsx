// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";

import { DueTag } from "@/components/DueTag";

/**
 * 截止日期标签契约（components/DueTag.tsx）：
 *  - 文案来自 lib/format 的 formatRelativeDueDate（真实实现，不 mock）
 *  - tone → 色 token 映射：overdue=--danger / today=--warn / 其余=--muted（无裸 hex）
 *  - inline 形态：带 "· " 前缀的 span；block 形态：独立 <p>
 *  - 两种形态都走 text-xs token
 */
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DueTag", () => {
  it("过期：danger 色 + 过期文案", () => {
    const { container } = render(<DueTag dueDate="2026-06-10T12:00:00Z" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("text-[var(--danger)]");
    expect(el.textContent).toMatch(/过期|逾期|天前/);
  });

  it("今天：warn 色 + 今天文案", () => {
    const { container } = render(<DueTag dueDate="2026-06-15T02:00:00Z" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("text-[var(--warn)]");
    expect(el.textContent).toContain("今天");
  });

  it("未来：muted 色", () => {
    const { container } = render(<DueTag dueDate="2026-06-18T12:00:00Z" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("text-[var(--muted)]");
    expect(el.textContent).toMatch(/后/);
  });

  it("inline 形态：<span> 且带 '· ' 前缀（单行内嵌）；block 形态：独立 <p>", () => {
    const inline = render(<DueTag dueDate="2026-06-18T12:00:00Z" inline />);
    const inlineEl = inline.container.firstElementChild as HTMLElement;
    expect(inlineEl.tagName).toBe("SPAN");
    expect(inlineEl.textContent?.startsWith("· ")).toBe(true);
    inline.unmount();

    const block = render(<DueTag dueDate="2026-06-18T12:00:00Z" />);
    const blockEl = block.container.firstElementChild as HTMLElement;
    expect(blockEl.tagName).toBe("P");
    expect(blockEl.textContent?.startsWith("· ")).toBe(false);
  });

  it("字号走 text-xs token；不含裸 hex 色值", () => {
    const { container } = render(<DueTag dueDate="2026-06-18T12:00:00Z" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("text-[length:var(--text-xs)]");
    expect(el.getAttribute("style")).toBeNull();
  });
});
