// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * MailAssistantPanel 契约（components/ai/MailAssistantPanel.tsx）：
 *  1. 顶部 4 个 tab（draft/summarize/classify/reply），aria-pressed 标识激活态
 *  2. 内容/上下文 textarea（content 必填、context 可选）；内容为空时执行按钮 disabled
 *  3. draft：consumeAiStream("/api/v1/ai/mail-assistant", { wid, action, content,
 *     context: trim||undefined }, { signal, onDelta })；onDelta 增量拼 draftText 实时渲染
 *     Markdown，完成后渲染全文
 *  4. summarize/classify/reply：api POST 同一端点，body 区分 action；
 *     - summarize → data.summary 渲染 Markdown
 *     - classify → 类别标签 + role=progressbar aria-valuenow=Math.round(confidence*100) + reason
 *     - reply → 3 个建议卡片（tone 标签 + 文本 + 复制按钮）
 *  5. 复制：navigator.clipboard.writeText(text) → 按钮进入 copied 态
 *  6. 失败（非 AbortError）→ t("error") 错误条；切 tab 重置结果区与错误
 */

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  stream: vi.fn(),
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
vi.mock("@/components/Markdown", () => ({
  default: ({ source }: { source: string }) => <div data-testid="md">{source}</div>,
}));
vi.mock("@/components/editor/aiStream", () => ({
  consumeAiStream: mocks.stream,
}));

import { MailAssistantPanel } from "@/components/ai/MailAssistantPanel";

const WID = "ws-ma-1";
const CONTENT = "客户询问交付时间，请帮忙处理";
const NS = "ai.mailAssistant";

/** jsdom 无 clipboard，挂桩 */
function stubClipboard() {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: mocks.writeText },
    configurable: true,
  });
}

/** 一次可控的 draft 流 */
interface DraftHarness {
  url: string;
  body: Record<string, unknown>;
  signal?: AbortSignal;
  onDelta?: (d: string) => void;
  resolve: (text: string) => void;
  reject: (e: Error) => void;
}

function draftHarness(): DraftHarness {
  const h = {} as DraftHarness;
  mocks.stream.mockImplementationOnce(
    (
      url: string,
      body: Record<string, unknown>,
      opts?: { signal?: AbortSignal; onDelta?: (d: string) => void },
    ) => {
      h.url = url;
      h.body = body;
      h.signal = opts?.signal;
      h.onDelta = opts?.onDelta;
      return new Promise<string>((res, rej) => {
        h.resolve = res;
        h.reject = rej;
      });
    },
  );
  return h;
}

const contentBox = () => screen.getByLabelText(`${NS}:contentLabel`) as HTMLTextAreaElement;
const contextBox = () => screen.getByLabelText(`${NS}:contextLabel`) as HTMLTextAreaElement;
const executeBtn = () => screen.getByText(`${NS}:execute`).closest("button") as HTMLButtonElement;
const tab = (key: string) =>
  screen.getByText(`${NS}:${key}`).closest("button") as HTMLButtonElement;

/** 断言第 n 次 api 调用的 method=POST 与 body（signal 不参与深比较） */
function expectApiBody(callIndex: number, expected: Record<string, unknown>) {
  const opts = mocks.api.mock.calls[callIndex][1] as { method: string; body: string };
  expect(opts.method).toBe("POST");
  expect(JSON.parse(opts.body)).toEqual(expected);
}

beforeEach(() => {
  mocks.api.mockReset();
  mocks.stream.mockReset();
  mocks.writeText.mockReset();
  mocks.writeText.mockResolvedValue(undefined);
  stubClipboard();
});
afterEach(() => cleanup());

describe("MailAssistantPanel", () => {
  it("骨架：标题 + 4 个 tab（aria-pressed 唯 draft 为 true）；内容为空时执行按钮 disabled", () => {
    render(<MailAssistantPanel wid={WID} />);

    expect(screen.getByText(`${NS}:title`)).toBeTruthy();
    for (const key of ["actionDraft", "actionSummarize", "actionClassify", "actionReply"]) {
      expect(tab(key)).toBeTruthy();
    }
    expect(tab("actionDraft").getAttribute("aria-pressed")).toBe("true");
    expect(tab("actionSummarize").getAttribute("aria-pressed")).toBe("false");
    expect(tab("actionClassify").getAttribute("aria-pressed")).toBe("false");
    expect(tab("actionReply").getAttribute("aria-pressed")).toBe("false");
    expect(executeBtn()).toBeDisabled();
  });

  it("draft：点击执行发起流，url/body 携带 content 与 trim 后 context；流式中按钮变 generating 且输入区 disabled", async () => {
    const h = draftHarness();
    render(<MailAssistantPanel wid={WID} />);
    fireEvent.change(contentBox(), { target: { value: `  ${CONTENT}  ` } });
    fireEvent.change(contextBox(), { target: { value: "  项目背景补充  " } });
    expect(executeBtn()).not.toBeDisabled();

    fireEvent.click(executeBtn());
    await waitFor(() => expect(mocks.stream).toHaveBeenCalledTimes(1));
    expect(h.url).toBe("/api/v1/ai/mail-assistant");
    expect(h.body).toEqual({
      wid: WID,
      action: "draft",
      content: `  ${CONTENT}  `,
      context: "项目背景补充",
    });

    const btn = screen.getByText(`${NS}:generating`).closest("button") as HTMLButtonElement;
    expect(btn).toBeDisabled();
    expect(btn.querySelector("svg.lucide-loader-2")).toBeTruthy();
    expect(contentBox()).toBeDisabled();
    expect(contextBox()).toBeDisabled();
    h.resolve("完成");
  });

  it("draft：onDelta 增量拼 draftText 实时渲染 Markdown，resolve 后渲染全文", async () => {
    const h = draftHarness();
    render(<MailAssistantPanel wid={WID} />);
    fireEvent.change(contentBox(), { target: { value: CONTENT } });
    fireEvent.click(executeBtn());
    await waitFor(() => expect(mocks.stream).toHaveBeenCalled());

    h.onDelta?.("尊敬的");
    h.onDelta?.("客户您好");
    await waitFor(() => expect(screen.getByTestId("md").textContent).toBe("尊敬的客户您好"));
    h.resolve("尊敬的客户您好，交付时间为下周五。");
    await waitFor(() =>
      expect(screen.getByTestId("md").textContent).toBe("尊敬的客户您好，交付时间为下周五。"),
    );
    // 完成后按钮回到 execute 文案
    expect(screen.getByText(`${NS}:execute`)).toBeTruthy();
  });

  it("draft：context 为空（或纯空白）时 body 省略 context 键", async () => {
    const h = draftHarness();
    render(<MailAssistantPanel wid={WID} />);
    fireEvent.change(contentBox(), { target: { value: CONTENT } });
    fireEvent.change(contextBox(), { target: { value: "   " } });
    fireEvent.click(executeBtn());
    await waitFor(() => expect(mocks.stream).toHaveBeenCalledTimes(1));
    expect(h.body).toEqual({ wid: WID, action: "draft", content: CONTENT });
    h.resolve("x");
  });

  it("summarize：POST body action=summarize；返回 summary 渲染 Markdown", async () => {
    mocks.api.mockResolvedValueOnce({ summary: "要点一\n要点二" });
    render(<MailAssistantPanel wid={WID} />);
    fireEvent.change(contentBox(), { target: { value: CONTENT } });
    fireEvent.click(tab("actionSummarize"));
    expect(tab("actionSummarize").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(executeBtn());

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    expectApiBody(0, { wid: WID, action: "summarize", content: CONTENT });
    await waitFor(() => expect(screen.getByTestId("md").textContent).toBe("要点一\n要点二"));
    // tab 与结果区标头各一处
    expect(screen.getAllByText(`${NS}:actionSummarize`)).toHaveLength(2);
  });

  it("classify：类别标签 + progressbar（aria-valuenow=置信度百分比）+ reason", async () => {
    mocks.api.mockResolvedValueOnce({ category: "work", confidence: 0.87, reason: "涉及排期分派" });
    render(<MailAssistantPanel wid={WID} />);
    fireEvent.change(contentBox(), { target: { value: CONTENT } });
    fireEvent.click(tab("actionClassify"));
    fireEvent.click(executeBtn());

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    expectApiBody(0, { wid: WID, action: "classify", content: CONTENT });
    await waitFor(() => expect(screen.getByText(`${NS}:categoryWork`)).toBeTruthy());
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("87");
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
    expect(screen.getByText("87%")).toBeTruthy();
    expect(screen.getByText(`${NS}:confidence`)).toBeTruthy();
    expect(screen.getByText(`${NS}:reason`)).toBeTruthy();
    expect(screen.getByText("涉及排期分派")).toBeTruthy();
  });

  it("reply：渲染 3 个建议卡片，tone 标签 formal/casual/concise", async () => {
    mocks.api.mockResolvedValueOnce({
      suggestions: [
        { text: "正式回复文本", tone: "formal" },
        { text: "随意回复文本", tone: "casual" },
        { text: "简短回复文本", tone: "concise" },
      ],
    });
    render(<MailAssistantPanel wid={WID} />);
    fireEvent.change(contentBox(), { target: { value: CONTENT } });
    fireEvent.click(tab("actionReply"));
    fireEvent.click(executeBtn());

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    expectApiBody(0, { wid: WID, action: "reply", content: CONTENT });
    await waitFor(() => expect(screen.getByText("正式回复文本")).toBeTruthy());
    expect(screen.getByText(`${NS}:toneFormal`)).toBeTruthy();
    expect(screen.getByText(`${NS}:toneCasual`)).toBeTruthy();
    expect(screen.getByText(`${NS}:toneConcise`)).toBeTruthy();
    expect(screen.getByText("随意回复文本")).toBeTruthy();
    expect(screen.getByText("简短回复文本")).toBeTruthy();
  });

  it("复制：点建议卡复制按钮 → clipboard.writeText(文本)，按钮进入 copied 态", async () => {
    mocks.api.mockResolvedValueOnce({
      suggestions: [
        { text: "正式回复文本", tone: "formal" },
        { text: "随意回复文本", tone: "casual" },
        { text: "简短回复文本", tone: "concise" },
      ],
    });
    render(<MailAssistantPanel wid={WID} />);
    fireEvent.change(contentBox(), { target: { value: CONTENT } });
    fireEvent.click(tab("actionReply"));
    fireEvent.click(executeBtn());
    await waitFor(() => expect(screen.getByText("正式回复文本")).toBeTruthy());

    const copyBtns = screen.getAllByLabelText(`${NS}:copy`);
    expect(copyBtns).toHaveLength(3);
    fireEvent.click(copyBtns[0]);

    await waitFor(() => expect(mocks.writeText).toHaveBeenCalledWith("正式回复文本"));
    await waitFor(() => expect(screen.getAllByLabelText(`${NS}:copied`)).toHaveLength(1));
    // 未复制的卡片仍是 copy 态
    expect(screen.getAllByLabelText(`${NS}:copy`)).toHaveLength(2);
  });

  it("api 失败 → t('error') 错误条", async () => {
    mocks.api.mockRejectedValueOnce(new Error("boom"));
    render(<MailAssistantPanel wid={WID} />);
    fireEvent.change(contentBox(), { target: { value: CONTENT } });
    fireEvent.click(tab("actionSummarize"));
    fireEvent.click(executeBtn());

    await waitFor(() => expect(screen.getByText(`${NS}:error`)).toBeTruthy());
  });

  it("切 tab 重置结果区与错误：draft 出结果后切 classify，md 消失、error 清空", async () => {
    mocks.api.mockRejectedValueOnce(new Error("boom"));
    render(<MailAssistantPanel wid={WID} />);
    fireEvent.change(contentBox(), { target: { value: CONTENT } });

    // summarize 失败留下错误条
    fireEvent.click(tab("actionSummarize"));
    fireEvent.click(executeBtn());
    await waitFor(() => expect(screen.getByText(`${NS}:error`)).toBeTruthy());

    // draft 出结果
    const h = draftHarness();
    fireEvent.click(tab("actionDraft"));
    expect(screen.queryByText(`${NS}:error`)).toBeFalsy();
    fireEvent.click(executeBtn());
    await waitFor(() => expect(mocks.stream).toHaveBeenCalledTimes(1));
    h.onDelta?.("草稿正文");
    await waitFor(() => expect(screen.getByTestId("md").textContent).toBe("草稿正文"));

    // 切走 → 结果区清空
    fireEvent.click(tab("actionClassify"));
    expect(screen.queryByTestId("md")).toBeFalsy();
  });
});
