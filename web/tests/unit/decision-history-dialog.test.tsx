// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import React from "react";

import { DecisionHistoryDialog } from "@/components/task/DecisionHistoryDialog";
import type { Decision, DecisionVersion } from "@/components/task/types";

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

vi.mock("@/components/Markdown", () => ({
  default: ({ source }: { source: string }) => <div data-testid="md" data-source={source} />,
}));

const relTime = (iso: string) => `rel:${iso}`;

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: "d-1",
    markdown: "当前版本正文",
    version: 3,
    createdAt: "2026-10-03T09:00:00Z",
    author: { id: "u-1", name: "Alice", email: "alice@x.com" },
    ...overrides,
  };
}

function makeVersion(overrides: Partial<DecisionVersion> = {}): DecisionVersion {
  return {
    id: "v-1",
    decisionId: "d-1",
    markdown: "历史版本正文",
    version: 1,
    createdAt: "2026-10-01T08:00:00Z",
    author: { id: "u-1", name: "Alice", email: "alice@x.com" },
    ...overrides,
  };
}

interface RenderOptions {
  historyFor?: Decision | null;
  versions?: DecisionVersion[];
  historyLoading?: boolean;
  historyError?: boolean;
}

function renderDialog(options: RenderOptions = {}) {
  const onClose = vi.fn();
  const onRetry = vi.fn();
  const utils = render(
    <DecisionHistoryDialog
      historyFor={options.historyFor === undefined ? makeDecision() : options.historyFor}
      onClose={onClose}
      versions={options.versions ?? []}
      historyLoading={options.historyLoading ?? false}
      historyError={options.historyError ?? false}
      onRetry={onRetry}
      relTime={relTime}
    />,
  );
  return { ...utils, onClose, onRetry };
}

describe("DecisionHistoryDialog", () => {
  beforeEach(() => {
    // 每个用例前让 body 失焦，保证焦点断言起点干净
    document.body.focus();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("historyFor 为 null 时什么都不渲染", () => {
    renderDialog({ historyFor: null });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("渲染弹窗：role/aria-modal/aria-label 与标题（含版本号）", () => {
    renderDialog({ historyFor: makeDecision({ version: 3 }) });
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-label", "task:versionHistory");
    expect(screen.getByText('task:versionHistoryTitle:{"version":3}')).toBeInTheDocument();
  });

  it("加载中：渲染两块骨架屏，不渲染重试按钮与版本", () => {
    const { container } = renderDialog({ historyLoading: true });
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "button:retry" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("md")).not.toBeInTheDocument();
  });

  it("加载失败：显示失败文案与重试按钮，点击重试调用 onRetry", () => {
    const { onRetry } = renderDialog({ historyError: true, versions: [] });
    expect(screen.getByText("task:historyLoadFailed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "button:retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("无失败且有版本时正常渲染（error 不影响非空版本列表）", () => {
    renderDialog({ historyError: true, versions: [makeVersion()] });
    expect(screen.getByText("v1")).toBeInTheDocument();
    expect(screen.queryByText("task:historyLoadFailed")).not.toBeInTheDocument();
  });

  it("无版本且无失败：显示空态文案", () => {
    renderDialog({ versions: [] });
    expect(screen.getByText("task:noHistory")).toBeInTheDocument();
  });

  it("版本列表渲染：版本徽标、作者+相对时间、Markdown 源", () => {
    renderDialog({
      versions: [
        makeVersion({ markdown: "第一版", version: 2, createdAt: "2026-10-02T10:00:00Z" }),
        makeVersion({ markdown: "初版", version: 1, id: "v-0" }),
      ],
    });
    expect(screen.getByText("v2")).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();
    // 作者与相对时间渲染在同一 span（由 · 分隔）
    expect(screen.getByText(/Alice · rel:2026-10-02T10:00:00Z/)).toBeInTheDocument();
    expect(screen.getAllByTestId("md").map((el) => el.getAttribute("data-source"))).toEqual([
      "第一版",
      "初版",
    ]);
  });

  it("版本作者为 null 时显示已删除用户兜底", () => {
    renderDialog({ versions: [makeVersion({ author: null })] });
    expect(screen.getByText(/task:deletedUser · rel:/)).toBeInTheDocument();
  });

  it("点击遮罩关闭弹窗；点击弹窗内部不关闭", () => {
    const { onClose } = renderDialog({ versions: [makeVersion()] });
    const dialog = screen.getByRole("dialog");
    // 内部点击（标题区域）冒泡被 stopPropagation 拦截
    fireEvent.click(screen.getByText("v1"));
    expect(onClose).not.toHaveBeenCalled();
    // 遮罩点击触发关闭
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("右上角关闭按钮（aria-label）触发 onClose", () => {
    const { onClose } = renderDialog({ versions: [makeVersion()] });
    fireEvent.click(screen.getByRole("button", { name: "button:close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("打开时焦点移入弹窗内首个可聚焦元素，卸载后恢复原焦点", () => {
    // 先渲染一个外部输入框并聚焦，作为「之前焦点」
    const outer = render(<input type="text" data-testid="outer" />);
    const outerInput = screen.getByTestId("outer");
    outerInput.focus();
    expect(document.activeElement).toBe(outerInput);

    const { unmount } = renderDialog({ versions: [makeVersion()] });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "button:close" }));

    unmount();
    expect(document.activeElement).toBe(outerInput);
    outer.unmount();
  });

  it("Tab 焦点陷阱：在弹窗内可聚焦元素间循环（Shift+Tab 回绕）", () => {
    // 失败态有两个可聚焦元素：关闭按钮（首）与重试按钮（尾）
    renderDialog({ historyError: true, versions: [] });
    const close = screen.getByRole("button", { name: "button:close" });
    const retry = screen.getByRole("button", { name: "button:retry" });

    retry.focus();
    expect(document.activeElement).toBe(retry);
    // 在尾元素按 Tab → 回绕到首元素
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    // 在首元素按 Shift+Tab → 回绕到尾元素
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(retry);
  });
});
