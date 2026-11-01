// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * AI 反馈按钮契约（components/ai/FeedbackButtons.tsx）：
 *  1. 点赞 → POST /api/v1/ai/feedback，body {workspaceId, capability,
 *     rating:"positive", comment:undefined（JSON 丢弃键）, originalOutput}
 *  2. 成功后两按钮 disabled、点赞 aria-pressed=true、显示 t("submitted")、
 *     onFeedbackSubmitted 回调以 rating 触发
 *  3. 点踩 → 打开修正对话框（role=dialog aria-modal、遮罩、X 关闭、
 *     textarea id=feedback-comment maxLength=5000 rows=4、Esc 关闭）
 *  4. 对话框提交 → body 带 comment；成功后关闭对话框 + submitted=negative
 *  5. 提交中：两个按钮 disabled、textarea disabled、提交按钮显示 "…"
 *  6. 提交中/已提交再点击 → 不再发请求
 *  7. 非 AbortError 失败 → t("error") 提示（对话框外/内两处皆渲染分支）；
 *     AbortError 静默
 *  8. 每次提交带 AbortSignal；组件卸载中止进行中请求（不崩）
 */

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  onSubmitted: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}:${key}:${JSON.stringify(vars)}` : `${ns}:${key}`,
}));
vi.mock("@/lib/api", () => ({ api: mocks.api }));

import FeedbackButtons from "@/components/ai/FeedbackButtons";

const PROPS = {
  capability: "task-breakdown",
  workspaceId: "ws-1",
} as const;

beforeEach(() => {
  mocks.api.mockReset();
  mocks.onSubmitted.mockClear();
});

afterEach(() => {
  cleanup();
});

/** 读取上一次 api 调用的 opts */
function lastOpts(): { method?: string; body?: string; signal?: AbortSignal } {
  const call = mocks.api.mock.calls[mocks.api.mock.calls.length - 1];
  return (call?.[1] ?? {}) as { method?: string; body?: string; signal?: AbortSignal };
}

describe("FeedbackButtons", () => {
  it("点赞 → POST 反馈，body 含 workspaceId/capability/rating，comment 与 originalOutput 缺省时被 JSON 丢弃", async () => {
    mocks.api.mockResolvedValueOnce(undefined);
    render(<FeedbackButtons {...PROPS} />);
    fireEvent.click(screen.getByLabelText("ai.feedback:like"));
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    expect(mocks.api).toHaveBeenNthCalledWith(1, "/api/v1/ai/feedback", expect.anything());
    expect(lastOpts().method).toBe("POST");
    expect(lastOpts().body).toBe(
      JSON.stringify({ workspaceId: "ws-1", capability: "task-breakdown", rating: "positive" }),
    );
    expect(lastOpts().signal).toBeInstanceOf(AbortSignal);
  });

  it("originalOutput 透传到 body", async () => {
    mocks.api.mockResolvedValueOnce(undefined);
    render(<FeedbackButtons {...PROPS} originalOutput={{ plan: "x" }} />);
    fireEvent.click(screen.getByLabelText("ai.feedback:like"));
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    expect(JSON.parse(lastOpts().body ?? "{}")).toEqual({
      workspaceId: "ws-1",
      capability: "task-breakdown",
      rating: "positive",
      originalOutput: { plan: "x" },
    });
  });

  it('点赞成功：两按钮 disabled、aria-pressed 单向翻转、t("submitted")、回调被调', async () => {
    mocks.api.mockResolvedValueOnce(undefined);
    const { container } = render(
      <FeedbackButtons {...PROPS} onFeedbackSubmitted={mocks.onSubmitted} />,
    );
    const like = screen.getByLabelText("ai.feedback:like");
    fireEvent.click(like);
    await waitFor(() => expect(screen.getByText("ai.feedback:submitted")).toBeTruthy());
    expect(like.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("ai.feedback:dislike").getAttribute("aria-pressed")).toBe("false");
    expect((like as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("ai.feedback:dislike") as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.onSubmitted).toHaveBeenCalledWith("positive");
    // like/dislike 按钮高亮类
    expect(like.className).toContain("bg-[var(--success-soft)]");
    expect(container.querySelector(".lucide-thumbs-up")).toBeTruthy();
  });

  it("点踩打开对话框（role=dialog/aria-modal、遮罩、textarea 规格），不再发请求", () => {
    const { container } = render(<FeedbackButtons {...PROPS} />);
    fireEvent.click(screen.getByLabelText("ai.feedback:dislike"));
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("ai.feedback:dislike");
    expect(screen.getByLabelText("ai.feedback:commentPlaceholder")).toBeTruthy();
    const ta = document.getElementById("feedback-comment") as HTMLTextAreaElement;
    expect(ta.maxLength).toBe(5000);
    expect(ta.rows).toBe(4);
    // 遮罩层
    expect(container.querySelector(".fixed.inset-0")).toBeTruthy();
    // X 关闭按钮
    expect(container.querySelector(".lucide-x")).toBeTruthy();
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it("对话框三种关闭方式：X、取消按钮、遮罩点击", () => {
    const { container } = render(<FeedbackButtons {...PROPS} />);
    fireEvent.click(screen.getByLabelText("ai.feedback:dislike"));
    // X
    fireEvent.click(container.querySelector(".lucide-x")!.closest("button")!);
    expect(screen.queryByRole("dialog")).toBeNull();
    // 重新打开 → 取消按钮
    fireEvent.click(screen.getByLabelText("ai.feedback:dislike"));
    fireEvent.click(screen.getByText("ai.feedback:cancel"));
    expect(screen.queryByRole("dialog")).toBeNull();
    // 重新打开 → 遮罩
    fireEvent.click(screen.getByLabelText("ai.feedback:dislike"));
    fireEvent.click(container.querySelector(".fixed.inset-0")!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Esc 键关闭对话框并清空已输入的修正建议", () => {
    render(<FeedbackButtons {...PROPS} />);
    fireEvent.click(screen.getByLabelText("ai.feedback:dislike"));
    const ta = document.getElementById("feedback-comment") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "应该改成 X" } });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    // 重新打开后内容已清空
    fireEvent.click(screen.getByLabelText("ai.feedback:dislike"));
    const ta2 = document.getElementById("feedback-comment") as HTMLTextAreaElement;
    expect(ta2.value).toBe("");
  });

  it("提交点踩反馈 → body 带 comment；成功后关对话框、submitted=negative、按钮高亮 danger", async () => {
    mocks.api.mockResolvedValueOnce(undefined);
    const { container } = render(<FeedbackButtons {...PROPS} />);
    fireEvent.click(screen.getByLabelText("ai.feedback:dislike"));
    const ta = document.getElementById("feedback-comment") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "修正建议" } });
    fireEvent.click(screen.getByText("ai.feedback:submit"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.api).toHaveBeenCalledTimes(1);
    expect(JSON.parse(lastOpts().body ?? "{}")).toEqual({
      workspaceId: "ws-1",
      capability: "task-breakdown",
      rating: "negative",
      comment: "修正建议",
      originalOutput: undefined,
    });
    const dislike = screen.getByLabelText("ai.feedback:dislike");
    expect(dislike.getAttribute("aria-pressed")).toBe("true");
    expect(dislike.className).toContain("bg-[var(--danger-soft)]");
    expect(screen.getByText("ai.feedback:submitted")).toBeTruthy();
    // 对话框已关闭 → submitted 文本可见
    expect(container.querySelector(".lucide-thumbs-down")).toBeTruthy();
  });

  it('提交中：两按钮 disabled、textarea disabled、提交按钮显示 "…"', async () => {
    mocks.api.mockResolvedValueOnce([]);
    render(<FeedbackButtons {...PROPS} />);
    fireEvent.click(screen.getByLabelText("ai.feedback:dislike"));
    fireEvent.click(screen.getByText("ai.feedback:submit"));
    expect(screen.getByText("…")).toBeTruthy();
    expect((document.getElementById("feedback-comment") as HTMLTextAreaElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByText("ai.feedback:cancel").closest("button") as HTMLButtonElement).disabled,
    ).toBe(true);
    // 提交中点赞不会再发请求
    fireEvent.click(screen.getByLabelText("ai.feedback:like"));
    expect(mocks.api).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText("…")).toBeNull());
  });

  it('非 AbortError 失败 → 显示 t("error")，不泄露 e.message', async () => {
    mocks.api.mockRejectedValueOnce(new Error("db exploded"));
    render(<FeedbackButtons {...PROPS} />);
    fireEvent.click(screen.getByLabelText("ai.feedback:like"));
    await waitFor(() => expect(screen.getByText("ai.feedback:error")).toBeTruthy());
    expect(screen.queryByText("db exploded")).toBeNull();
    // 失败后按钮恢复可点（非 submitted）
    expect((screen.getByLabelText("ai.feedback:like") as HTMLButtonElement).disabled).toBe(false);
  });

  it("AbortError 静默：不显示错误、不标记 submitted", async () => {
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    mocks.api.mockRejectedValueOnce(abortErr);
    render(<FeedbackButtons {...PROPS} />);
    fireEvent.click(screen.getByLabelText("ai.feedback:like"));
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("ai.feedback:error")).toBeNull();
    expect(screen.queryByText("ai.feedback:submitted")).toBeNull();
  });

  it('对话框内的错误提示分支：点赞失败后打开对话框 → t("error") 移入对话框、外部提示被抑制', async () => {
    mocks.api.mockRejectedValueOnce(new Error("boom"));
    const { container } = render(<FeedbackButtons {...PROPS} />);
    fireEvent.click(screen.getByLabelText("ai.feedback:like"));
    await waitFor(() => expect(screen.getByText("ai.feedback:error")).toBeTruthy());
    // 此时 error=true、对话框外提示可见（<span>，非 <p>）
    expect(container.querySelectorAll("p").length).toBe(0);
    // 打开对话框 → 内部 <p> 分支渲染，外部 span 分支被 !showDialog 抑制
    fireEvent.click(screen.getByLabelText("ai.feedback:dislike"));
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector("p")?.textContent).toBe("ai.feedback:error");
    expect(container.querySelectorAll(".lucide-thumbs-down").length).toBeGreaterThanOrEqual(1);
  });

  it("点踩提交失败 → .then() 无条件关闭对话框，错误提示转而显示在对话框外", async () => {
    mocks.api.mockRejectedValueOnce(new Error("boom"));
    render(<FeedbackButtons {...PROPS} />);
    fireEvent.click(screen.getByLabelText("ai.feedback:dislike"));
    fireEvent.click(screen.getByText("ai.feedback:submit"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(screen.getByText("ai.feedback:error")).toBeTruthy());
    // 未标记 submitted，按钮恢复可用
    expect((screen.getByLabelText("ai.feedback:dislike") as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("已提交后再点击不重复发请求", async () => {
    mocks.api.mockResolvedValueOnce(undefined);
    render(<FeedbackButtons {...PROPS} />);
    fireEvent.click(screen.getByLabelText("ai.feedback:like"));
    await waitFor(() => expect(screen.getByText("ai.feedback:submitted")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("ai.feedback:like"));
    fireEvent.click(screen.getByLabelText("ai.feedback:dislike"));
    expect(mocks.api).toHaveBeenCalledTimes(1);
  });

  it("组件卸载时中止进行中的请求（不抛错）", () => {
    mocks.api.mockImplementationOnce(() => new Promise(() => {}));
    const { unmount } = render(<FeedbackButtons {...PROPS} />);
    fireEvent.click(screen.getByLabelText("ai.feedback:like"));
    expect(() => unmount()).not.toThrow();
  });
});
