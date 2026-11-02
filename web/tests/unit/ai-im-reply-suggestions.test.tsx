// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";

/**
 * ImReplySuggestions 契约（components/ai/ImReplySuggestions.tsx）：
 *  1. 挂载即 POST /api/v1/ai/im-reply，body { wid, conversationId, taskId, messageId }
 *  2. 仅 Array 响应生效；非 Array → 空态 t("noSuggestions")
 *  3. 非 AbortError 报错 → t("error") + 重试按钮（RefreshCw）；AbortError 无 error
 *  4. 三 tone 标签（formal/casual/concise）+ 内联 token 颜色
 *  5. 卡片 role=button：点击/Enter/Space → onSelect(text)；复制按钮 stopPropagation
 *  6. 复制：clipboard.writeText → onSelect + copied 图标态，2 秒复位；写剪贴板失败静默降级
 *  7. FeedbackButtons capability="im-reply"
 */

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  writeText: vi.fn(),
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
vi.mock("@/lib/api", () => ({
  api: mocks.api,
  ApiError: class ApiError extends Error {},
}));
vi.mock("@/components/ai/FeedbackButtons", () => ({
  FeedbackButtons: (props: { capability?: string; workspaceId?: string }) => (
    <div
      data-testid="fb"
      data-capability={props.capability ?? ""}
      data-wid={props.workspaceId ?? ""}
    />
  ),
}));

import { ImReplySuggestions } from "@/components/ai/ImReplySuggestions";

const WID = "ws-ir-1";
const SUGGESTIONS = [
  { text: "正式地确认会议时间", tone: "formal" as const },
  { text: "行啊，到时候见", tone: "casual" as const },
  { text: "确认。", tone: "concise" as const },
];

/** jsdom 无 clipboard，挂桩 */
function stubClipboard() {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: mocks.writeText },
    configurable: true,
  });
}

/** 渲染至结果态 */
async function renderLoaded(extraProps: Record<string, unknown> = {}) {
  mocks.api.mockResolvedValueOnce(SUGGESTIONS);
  const onSelect = vi.fn();
  const utils = render(<ImReplySuggestions wid={WID} onSelect={onSelect} {...extraProps} />);
  await waitFor(() => expect(screen.getByText("正式地确认会议时间")).toBeTruthy());
  return { ...utils, onSelect };
}

/** 第 i 张卡片（role=button 的 div；复制按钮是真实 <button>，需排除） */
function card(i: number) {
  const cards = document.querySelectorAll('div[role="button"]');
  return cards[i] as HTMLElement;
}

describe("ImReplySuggestions", () => {
  beforeEach(() => {
    mocks.api.mockReset();
    mocks.writeText.mockReset();
    mocks.writeText.mockResolvedValue(undefined);
    stubClipboard();
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("加载态：Sparkles + Loader2 + t('loading')（api pending）", () => {
    mocks.api.mockImplementationOnce(() => new Promise<never>(() => {}));
    const { container } = render(<ImReplySuggestions wid={WID} onSelect={vi.fn()} />);
    expect(screen.getByText("ai.imReply:loading")).toBeTruthy();
    expect(container.querySelector("svg.lucide-loader-circle")).toBeTruthy();
    expect(container.querySelector("svg.lucide-sparkles")).toBeTruthy();
  });

  it("挂载即 POST，body 含 wid 与可选上下文（undefined 键被 JSON.stringify 丢弃）", async () => {
    mocks.api.mockResolvedValueOnce(SUGGESTIONS);
    render(<ImReplySuggestions wid={WID} conversationId="c-1" taskId="t-9" onSelect={vi.fn()} />);
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    // 第二个入参还带 signal（AbortSignal 无法深比较），只断言 method + body
    const opts = mocks.api.mock.calls[0][1] as { method: string; body: string };
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({ wid: WID, conversationId: "c-1", taskId: "t-9" });
  });

  it("结果渲染 3 张卡片：tone 标签 + 回复文本 + FeedbackButtons(im-reply)", async () => {
    const { container } = await renderLoaded();
    expect(screen.getByText("正式地确认会议时间")).toBeTruthy();
    expect(screen.getByText("行啊，到时候见")).toBeTruthy();
    expect(screen.getByText("确认。")).toBeTruthy();
    expect(screen.getByText("ai.imReply:formal")).toBeTruthy();
    expect(screen.getByText("ai.imReply:casual")).toBeTruthy();
    expect(screen.getByText("ai.imReply:concise")).toBeTruthy();
    const fb = screen.getByTestId("fb");
    expect(fb.getAttribute("data-capability")).toBe("im-reply");
    expect(fb.getAttribute("data-wid")).toBe(WID);
    // 3 张卡片（复制按钮是真实 <button>，不计入 role=button 的卡片）
    expect(container.querySelectorAll('[role="button"]')).toHaveLength(3);
  });

  it("tone 内联样式映射 design token（formal=casual=concise）", async () => {
    const { container } = await renderLoaded();
    const tones = Array.from(container.querySelectorAll("span.inline-flex"));
    const pick = (token: string) =>
      tones.find((s) => (s.getAttribute("style") ?? "").includes(token));
    expect(pick("var(--accent)")).toBeTruthy();
    expect(pick("var(--success)")).toBeTruthy();
    expect(pick("var(--muted)")).toBeTruthy();
  });

  it("点击卡片 → onSelect(text)", async () => {
    const { onSelect } = await renderLoaded();
    fireEvent.click(card(0));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("正式地确认会议时间");
  });

  it("键盘 Enter / Space 均触发 onSelect", async () => {
    const { onSelect } = await renderLoaded();
    fireEvent.keyDown(card(1), { key: "Enter" });
    fireEvent.keyDown(card(1), { key: " " });
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenCalledWith("行啊，到时候见");
  });

  it("复制按钮：writeText + onSelect + aria-label 切 copied + Check 图标", async () => {
    const { container } = await renderLoaded();
    const copyBtn = screen.getAllByLabelText("ai.imReply:copy")[0];
    await act(async () => {
      fireEvent.click(copyBtn);
    });
    expect(mocks.writeText).toHaveBeenCalledWith("正式地确认会议时间");
    expect(screen.getByLabelText("ai.imReply:copied")).toBeTruthy();
    expect(container.querySelector("svg.lucide-check")).toBeTruthy();
  });

  it("复制按钮 stopPropagation：点复制只触发一次 onSelect", async () => {
    const { onSelect } = await renderLoaded();
    const copyBtn = screen.getAllByLabelText("ai.imReply:copy")[0];
    await act(async () => {
      fireEvent.click(copyBtn);
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("复制 2 秒后 copied 复位", async () => {
    await renderLoaded();
    vi.useFakeTimers();
    const copyBtn = screen.getAllByLabelText("ai.imReply:copy")[0];
    await act(async () => {
      fireEvent.click(copyBtn);
    });
    expect(screen.getByLabelText("ai.imReply:copied")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getAllByLabelText("ai.imReply:copy")[0]).toBeTruthy();
  });

  it("clipboard.writeText 失败 → 静默降级：仍 onSelect 且 copied", async () => {
    mocks.writeText.mockRejectedValueOnce(new Error("no clipboard"));
    const { onSelect } = await renderLoaded();
    const copyBtn = screen.getAllByLabelText("ai.imReply:copy")[0];
    await act(async () => {
      fireEvent.click(copyBtn);
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("ai.imReply:copied")).toBeTruthy();
  });

  it("非 AbortError 报错 → t('error') + 重试按钮；重试再调 api", async () => {
    mocks.api.mockRejectedValueOnce(new Error("boom"));
    const onSelect = vi.fn();
    const { container } = render(<ImReplySuggestions wid={WID} onSelect={onSelect} />);
    await waitFor(() => expect(screen.getByText("ai.imReply:error")).toBeTruthy());
    expect(container.querySelector("svg.lucide-refresh-cw")).toBeTruthy();
    // 重试成功
    mocks.api.mockResolvedValueOnce(SUGGESTIONS);
    fireEvent.click(screen.getByText("ai.imReply:retry"));
    await waitFor(() => expect(screen.getByText("确认。")).toBeTruthy());
    expect(mocks.api).toHaveBeenCalledTimes(2);
  });

  it("AbortError → 无 error 文案，落入空态（loading 被 finally 置 false）", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    mocks.api.mockRejectedValueOnce(abortError);
    render(<ImReplySuggestions wid={WID} onSelect={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("ai.imReply:noSuggestions")).toBeTruthy());
    expect(screen.queryByText("ai.imReply:error")).toBeFalsy();
  });

  it("非 Array 响应 → 空态 t('noSuggestions')", async () => {
    mocks.api.mockResolvedValueOnce({ unexpected: true } as never);
    render(<ImReplySuggestions wid={WID} onSelect={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("ai.imReply:noSuggestions")).toBeTruthy());
  });

  it("头部：Sparkles + h2 t('title')，aside aria-label=t('title')", async () => {
    const { container } = await renderLoaded();
    expect(screen.getByText("ai.imReply:title")).toBeTruthy();
    expect(container.querySelector("svg.lucide-sparkles")).toBeTruthy();
    expect(container.querySelector("aside")?.getAttribute("aria-label")).toBe("ai.imReply:title");
  });
});
