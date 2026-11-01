// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * DailyReportView 契约（components/ai/DailyReportView.tsx）：
 *  1. 初始空态：h1 t("title") + Sparkles(size32) + t("empty")；无保存栏
 *  2. 日期选择器：默认今天、max=今天、流式中 disabled
 *  3. 生成按钮：isStreaming||!date 时 disabled；生成调
 *     consumeAiProgressStream("/api/v1/ai/daily-report", { wid, date: `${date}T00:00:00.000Z` })
 *  4. onProgress → ProgressSteps（stageNames=tp("context"/"analyzing"/"generating")）
 *  5. onDelta 增量实时渲染 Markdown；完成后全文 + FeedbackButtons(daily-report)
 *  6. 生成失败（非 AbortError）→ t("generateFailed") 回 idle；AbortError 不视为错误
 *  7. 保存 → POST /api/v1/workspaces/{wid}/documents
 *     body { title: `${t("docTitle")} - ${date}`, markdown: content }
 *     成功 t("saved") 且按钮 disabled；失败 t("saveFailed")
 *  8. 预览/编辑切换；编辑 textarea 修改清除 saved
 */

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  stream: vi.fn(),
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
vi.mock("@/lib/api", () => ({ api: mocks.api }));
vi.mock("@/components/Markdown", () => ({
  default: ({ source }: { source: string }) => <div data-testid="md">{source}</div>,
}));
vi.mock("@/components/ai/ProgressSteps", () => ({
  ProgressSteps: (props: { currentStage?: string; currentMessage?: string }) => (
    <div
      data-testid="steps"
      data-stage={props.currentStage ?? ""}
      data-message={props.currentMessage ?? ""}
    />
  ),
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
vi.mock("@/components/editor/aiStream", () => ({
  consumeAiProgressStream: mocks.stream,
}));

import { DailyReportView } from "@/components/ai/DailyReportView";

const WID = "ws-dr-1";
const TODAY = new Date().toISOString().split("T")[0]!;

/** 一次可控的流 */
interface StreamHarness {
  url: string;
  body: Record<string, unknown>;
  signal?: AbortSignal;
  onDelta?: (d: string) => void;
  onProgress?: (p: { stage: string; message?: string }) => void;
  resolve: (text: string) => void;
  reject: (e: Error) => void;
}

function streamHarness(): StreamHarness {
  const h = {} as StreamHarness;
  mocks.stream.mockImplementationOnce(
    (
      url: string,
      body: Record<string, unknown>,
      opts?: {
        signal?: AbortSignal;
        onDelta?: (d: string) => void;
        onProgress?: (p: { stage: string; message?: string }) => void;
      },
    ) => {
      h.url = url;
      h.body = body;
      h.signal = opts?.signal;
      h.onDelta = opts?.onDelta;
      h.onProgress = opts?.onProgress;
      return new Promise<{ text: string }>((res, rej) => {
        h.resolve = (text: string) => res({ text });
        h.reject = rej;
      });
    },
  );
  return h;
}

/** 生成按钮（header 内；流式中文案变为 generating） */
function generateButton() {
  return screen.getByText("ai.dailyReport:generate").closest("button") as HTMLButtonElement;
}

/** 日期输入框 */
function dateInput() {
  return screen.getByLabelText("ai.dailyReport:dateLabel") as HTMLInputElement;
}

/** 完成一次"生成"直至保存按钮出现 */
async function generateDone(h: StreamHarness, text: string) {
  fireEvent.click(generateButton());
  await waitFor(() => expect(mocks.stream).toHaveBeenCalledTimes(1));
  h.resolve(text);
  await waitFor(() => expect(screen.getByText("ai.dailyReport:save")).toBeTruthy());
}

describe("DailyReportView", () => {
  beforeEach(() => {
    mocks.api.mockReset();
    mocks.stream.mockReset();
    mocks.api.mockResolvedValue({});
  });
  afterEach(() => cleanup());

  it("初始空态：h1 标题 + Sparkles(size32) + t('empty')，无保存栏", () => {
    const { container } = render(<DailyReportView wid={WID} />);
    expect(screen.getByText("ai.dailyReport:title")).toBeTruthy();
    expect(screen.getByText("ai.dailyReport:empty")).toBeTruthy();
    const sparkles = Array.from(container.querySelectorAll("svg.lucide-sparkles"));
    expect(sparkles.some((s) => s.getAttribute("width") === "32")).toBe(true);
    expect(screen.queryByText("ai.dailyReport:save")).toBeFalsy();
  });

  it("日期默认今天、max=今天；header 含 Calendar 图标", () => {
    const { container } = render(<DailyReportView wid={WID} />);
    const input = dateInput();
    expect(input.value).toBe(TODAY);
    expect(input.getAttribute("max")).toBe(TODAY);
    expect(container.querySelector("svg.lucide-calendar")).toBeTruthy();
  });

  it("生成：url 与 body（date → ISO datetime，T00:00:00.000Z）", async () => {
    const h = streamHarness();
    render(<DailyReportView wid={WID} />);
    fireEvent.change(dateInput(), { target: { value: "2026-10-31" } });
    fireEvent.click(generateButton());
    await waitFor(() => expect(mocks.stream).toHaveBeenCalledTimes(1));
    expect(h.url).toBe("/api/v1/ai/daily-report");
    expect(h.body).toEqual({ wid: WID, date: "2026-10-31T00:00:00.000Z" });
    h.resolve("x");
  });

  it("默认日期生成：body.date 为今天 T00:00:00.000Z", async () => {
    const h = streamHarness();
    render(<DailyReportView wid={WID} />);
    fireEvent.click(generateButton());
    await waitFor(() => expect(mocks.stream).toHaveBeenCalledTimes(1));
    expect(h.body).toEqual({ wid: WID, date: `${TODAY}T00:00:00.000Z` });
    h.resolve("x");
  });

  it("流式中：生成按钮与日期输入均 disabled，Loader2 + t('generating')", async () => {
    const h = streamHarness();
    render(<DailyReportView wid={WID} />);
    const btn = generateButton();
    const dInput = dateInput();
    fireEvent.click(btn);
    await waitFor(() => {
      expect(btn).toBeDisabled();
      expect(dInput).toBeDisabled();
    });
    expect(screen.getByText("ai.dailyReport:generating")).toBeTruthy();
    expect(btn.querySelector("svg.lucide-loader-2")).toBeTruthy();
    h.resolve("完成");
  });

  it("onProgress → ProgressSteps（stage/message 透传，含 ai.progress 命名空间）", async () => {
    const h = streamHarness();
    render(<DailyReportView wid={WID} />);
    fireEvent.click(generateButton());
    await waitFor(() => expect(mocks.stream).toHaveBeenCalled());
    h.onProgress?.({ stage: "analyzing", message: "汇总任务" });
    await waitFor(() => expect(screen.getByTestId("steps")).toBeTruthy());
    const steps = screen.getByTestId("steps");
    expect(steps.getAttribute("data-stage")).toBe("analyzing");
    expect(steps.getAttribute("data-message")).toBe("汇总任务");
    h.resolve("x");
  });

  it("onDelta 增量实时渲染 Markdown；完成后渲染全文 + FeedbackButtons(daily-report)", async () => {
    const h = streamHarness();
    const { container } = render(<DailyReportView wid={WID} />);
    fireEvent.click(generateButton());
    await waitFor(() => expect(mocks.stream).toHaveBeenCalled());
    h.onDelta?.("早会");
    h.onDelta?.("纪要");
    await waitFor(() => expect(container.querySelectorAll('[data-testid="md"]').length).toBe(1));
    expect(screen.getByTestId("md").textContent).toBe("早会纪要");
    h.resolve("早会纪要完成");
    await waitFor(() => expect(screen.getByTestId("md").textContent).toBe("早会纪要完成"));
    const fb = screen.getByTestId("fb");
    expect(fb.getAttribute("data-capability")).toBe("daily-report");
    expect(fb.getAttribute("data-wid")).toBe(WID);
  });

  it("生成失败（非 abort）→ t('generateFailed') 回到 idle，无保存栏", async () => {
    const h = streamHarness();
    render(<DailyReportView wid={WID} />);
    fireEvent.click(generateButton());
    await waitFor(() => expect(mocks.stream).toHaveBeenCalled());
    h.reject(new Error("boom"));
    await waitFor(() => expect(screen.getByText("ai.dailyReport:generateFailed")).toBeTruthy());
    expect(generateButton()).toBeTruthy();
    expect(screen.queryByText("ai.dailyReport:save")).toBeFalsy();
  });

  it("生成被 abort（AbortError）不视为错误：无 error 文案，按钮保持 generating", async () => {
    const h = streamHarness();
    render(<DailyReportView wid={WID} />);
    fireEvent.click(generateButton());
    await waitFor(() => expect(mocks.stream).toHaveBeenCalled());
    const e = new Error("aborted");
    e.name = "AbortError";
    h.reject(e);
    await waitFor(() => expect(screen.getByText("ai.dailyReport:generating")).toBeTruthy());
    expect(screen.queryByText("ai.dailyReport:generateFailed")).toBeFalsy();
  });

  it("保存：POST title=`t('docTitle') - date` + markdown；成功 t('saved') 且按钮 disabled", async () => {
    const h = streamHarness();
    render(<DailyReportView wid={WID} />);
    await generateDone(h, "# 日报\n今日完成三项");
    fireEvent.click(screen.getByText("ai.dailyReport:save").closest("button")!);
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    expect(mocks.api).toHaveBeenCalledWith(`/api/v1/workspaces/${WID}/documents`, {
      method: "POST",
      body: JSON.stringify({
        title: `ai.dailyReport:docTitle - ${TODAY}`,
        markdown: "# 日报\n今日完成三项",
      }),
    });
    await waitFor(() => expect(screen.getByText("ai.dailyReport:saved")).toBeTruthy());
    expect(screen.getByText("ai.dailyReport:save").closest("button")).toBeDisabled();
  });

  it("保存失败 → t('saveFailed')，按钮恢复可点", async () => {
    mocks.api.mockRejectedValueOnce(new Error("save boom"));
    const h = streamHarness();
    render(<DailyReportView wid={WID} />);
    await generateDone(h, "# 日报\n正文");
    fireEvent.click(screen.getByText("ai.dailyReport:save").closest("button")!);
    await waitFor(() => expect(screen.getByText("ai.dailyReport:saveFailed")).toBeTruthy());
    expect(screen.getByText("ai.dailyReport:save").closest("button")).not.toBeDisabled();
  });

  it("预览/编辑切换：编辑态出现 textarea（aria-label=t('edit')），回切预览", async () => {
    const h = streamHarness();
    render(<DailyReportView wid={WID} />);
    await generateDone(h, "# 日报\n正文");
    expect(screen.queryByLabelText("ai.dailyReport:edit")).toBeFalsy();
    fireEvent.click(screen.getByText("ai.dailyReport:edit").closest("button")!);
    const ta = screen.getByLabelText("ai.dailyReport:edit") as HTMLTextAreaElement;
    expect(ta.value).toBe("# 日报\n正文");
    fireEvent.click(screen.getByText("ai.dailyReport:preview").closest("button")!);
    expect(screen.queryByLabelText("ai.dailyReport:edit")).toBeFalsy();
    h.resolve("ignored");
  });

  it("编辑 textarea 修改内容清除 saved 标志（按钮重新可用）", async () => {
    const h = streamHarness();
    render(<DailyReportView wid={WID} />);
    await generateDone(h, "# 日报一");
    fireEvent.click(screen.getByText("ai.dailyReport:save").closest("button")!);
    await waitFor(() => expect(screen.getByText("ai.dailyReport:saved")).toBeTruthy());
    fireEvent.click(screen.getByText("ai.dailyReport:edit").closest("button")!);
    fireEvent.change(screen.getByLabelText("ai.dailyReport:edit"), {
      target: { value: "# 日报二" },
    });
    expect(screen.queryByText("ai.dailyReport:saved")).toBeFalsy();
    expect(screen.getByText("ai.dailyReport:save").closest("button")).not.toBeDisabled();
    h.resolve("ignored");
  });
});
