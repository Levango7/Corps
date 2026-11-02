// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * ProjectInsightView 契约（components/ai/ProjectInsightView.tsx）：
 *  1. 4 个 tab（progress/risk/summary/weekly），默认 progress 激活
 *     （aria-current="page"），点击切换重新请求；点击当前 tab 不重发
 *  2. 挂载即自动调 consumeAiProgressStream("/api/v1/ai/project-insight",
 *     { wid, scope })，切换 tab 先 abort 上一个（signal.aborted=true）
 *  3. onProgress 回调驱动 ProgressSteps（stage/message）；loading 且无
 *     progress 时显示骨架 Loader2 + t("loading")
 *  4. onDelta 增量累加；完成后 content=full、loading 结束、Markdown 渲染全文
 *  5. 流失败 → t("error") + 重试按钮（再调一次流）
 *  6. 保存按钮仅 weekly 且非 loading/无错时出现；POST
 *     /api/v1/workspaces/{wid}/documents body={title:t('weeklyDocTitle'),markdown}
 *     成功→t('saved')、失败→t('saveFailed')
 *  7. 结果出来后 FeedbackButtons(capability='project-insight')
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
  ProgressSteps: (props: { currentStage: number; currentMessage?: string }) => (
    <div
      data-testid="steps"
      data-stage={props.currentStage}
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

import { ProjectInsightView } from "@/components/ai/ProjectInsightView";

const WID = "ws-pi-1";

/** 一次可控的流：opts 供测试手动触发 onDelta/onProgress，resolve 驱动完成 */
interface StreamHarness {
  url: string;
  body: Record<string, unknown>;
  signal?: AbortSignal;
  onDelta?: (d: string) => void;
  onProgress?: (p: { stage: 1 | 2 | 3; message: string }) => void;
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
        onProgress?: (p: unknown) => void;
      },
    ) => {
      h.url = url;
      h.body = body;
      h.signal = opts?.signal;
      h.onDelta = opts?.onDelta;
      h.onProgress = opts?.onProgress as StreamHarness["onProgress"];
      return new Promise<{ text: string }>((res, rej) => {
        h.resolve = (text: string) => res({ text });
        h.reject = rej;
      });
    },
  );
  return h;
}

/** 最近一次流的入参（url/body），用于切 tab 后的断言 */
function lastCall() {
  const calls = mocks.stream.mock.calls;
  return calls[calls.length - 1] as [string, Record<string, unknown>];
}

/** 等到 ProgressSteps 出现且 stage 符合预期 */
async function waitForStage(stage: string) {
  await waitFor(() => expect(screen.getByTestId("steps").getAttribute("data-stage")).toBe(stage));
}

describe("ProjectInsightView", () => {
  beforeEach(() => {
    mocks.api.mockReset();
    mocks.stream.mockReset();
  });
  afterEach(() => cleanup());

  it("4 个 tab 渲染默认文案，默认 progress 激活（aria-current）", () => {
    const h = streamHarness();
    render(<ProjectInsightView wid={WID} />);
    for (const key of ["tabProgress", "tabRisk", "tabSummary", "tabWeekly"]) {
      expect(screen.getByText(`ai.projectInsight:${key}`)).toBeTruthy();
    }
    const progressTab = screen.getByText("ai.projectInsight:tabProgress").closest("button")!;
    expect(progressTab.getAttribute("aria-current")).toBe("page");
    expect(
      screen.getByText("ai.projectInsight:tabRisk").closest("button")!.getAttribute("aria-current"),
    ).toBeNull();
    h.resolve("done");
  });

  it("挂载即自动请求：url + body={wid, scope:'progress'}", async () => {
    const h = streamHarness();
    render(<ProjectInsightView wid={WID} />);
    await waitFor(() => expect(mocks.stream).toHaveBeenCalledTimes(1));
    expect(h.url).toBe("/api/v1/ai/project-insight");
    expect(h.body).toEqual({ wid: WID, scope: "progress" });
    h.resolve("全文");
  });

  it("onProgress 驱动 ProgressSteps 的 stage/message", async () => {
    const h = streamHarness();
    render(<ProjectInsightView wid={WID} />);
    await waitFor(() => expect(mocks.stream).toHaveBeenCalled());
    h.onProgress?.({ stage: 2, message: "分析项目数据" });
    await waitForStage("2");
    expect(screen.getByTestId("steps").getAttribute("data-message")).toBe("分析项目数据");
    h.resolve("ok");
  });

  it("onDelta 增量累加渲染；完成后 Markdown 显示 full 且 loading 结束", async () => {
    const h = streamHarness();
    const { container } = render(<ProjectInsightView wid={WID} />);
    await waitFor(() => expect(mocks.stream).toHaveBeenCalled());
    h.onDelta?.("Hel");
    h.onDelta?.("lo");
    // 流式期间 Markdown 已渲染累加文本且有光标 span
    await waitFor(() => expect(screen.getByTestId("md").textContent).toBe("Hello"));
    expect(container.querySelector(".animate-pulse")).toBeTruthy();
    h.resolve("Hello World");
    await waitFor(() => {
      expect(screen.getByTestId("md").textContent).toBe("Hello World");
      expect(container.querySelector(".animate-pulse")).toBeFalsy();
    });
    expect(screen.getByText("ai.projectInsight:title")).toBeTruthy();
  });

  it("完成后 FeedbackButtons 以 capability='project-insight' 渲染", async () => {
    const h = streamHarness();
    render(<ProjectInsightView wid={WID} />);
    h.resolve("内容");
    await waitFor(() => expect(screen.getByTestId("fb")).toBeTruthy());
    expect(screen.getByTestId("fb").getAttribute("data-capability")).toBe("project-insight");
    expect(screen.getByTestId("fb").getAttribute("data-wid")).toBe(WID);
  });

  it("流失败：t('error') + 重试按钮，点击重试再发一次流", async () => {
    const h1 = streamHarness();
    render(<ProjectInsightView wid={WID} />);
    h1.reject(new Error("boom"));
    await waitFor(() => expect(screen.getByText("ai.projectInsight:error")).toBeTruthy());
    expect(screen.getByText("ai.projectInsight:retry").closest("button")).toBeTruthy();
    // 重试
    const h2 = streamHarness();
    fireEvent.click(screen.getByText("ai.projectInsight:retry").closest("button")!);
    await waitFor(() => expect(mocks.stream).toHaveBeenCalledTimes(2));
    expect(lastCall()[1]).toEqual({ wid: WID, scope: "progress" });
    h2.resolve("重试成功");
    await waitFor(() => expect(screen.getByTestId("md").textContent).toBe("重试成功"));
  });

  it("切 tab：发新流（scope 变化）且上一个请求被 abort", async () => {
    const h1 = streamHarness();
    render(<ProjectInsightView wid={WID} />);
    await waitFor(() => expect(mocks.stream).toHaveBeenCalledTimes(1));
    const h2 = streamHarness();
    fireEvent.click(screen.getByText("ai.projectInsight:tabRisk").closest("button")!);
    await waitFor(() => expect(mocks.stream).toHaveBeenCalledTimes(2));
    expect(lastCall()[1]).toEqual({ wid: WID, scope: "risk" });
    expect(h1.signal?.aborted).toBe(true);
    expect(h2.signal?.aborted).toBe(false);
    h2.resolve("风险内容");
    await waitFor(() => expect(screen.getByTestId("md").textContent).toBe("风险内容"));
  });

  it("点击当前激活 tab 不重发", async () => {
    const h = streamHarness();
    render(<ProjectInsightView wid={WID} />);
    await waitFor(() => expect(mocks.stream).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText("ai.projectInsight:tabProgress").closest("button")!);
    await new Promise((r) => setTimeout(r, 60));
    expect(mocks.stream).toHaveBeenCalledTimes(1);
    h.resolve("x");
  });

  it("loading 且无 progress 时显示骨架 Loader2 + t('loading')", async () => {
    const h = streamHarness();
    const { container } = render(<ProjectInsightView wid={WID} />);
    await waitFor(() => expect(screen.getByText("ai.projectInsight:loading")).toBeTruthy());
    expect(container.querySelector("svg.lucide-loader-2")).toBeTruthy();
    h.resolve("skeleton-end");
  });

  it("保存按钮仅 weekly 且非 loading/无错时出现；非 weekly tab 不渲染", async () => {
    const h = streamHarness();
    render(<ProjectInsightView wid={WID} />);
    h.resolve("日报内容");
    await waitFor(() => expect(screen.getByTestId("md")).toBeTruthy());
    expect(screen.queryByText("ai.projectInsight:saveAsDoc")).toBeFalsy();
    // 切到 weekly
    const h2 = streamHarness();
    fireEvent.click(screen.getByText("ai.projectInsight:tabWeekly").closest("button")!);
    h2.resolve("周报内容");
    await waitFor(() => expect(screen.getByText("ai.projectInsight:saveAsDoc")).toBeTruthy());
  });

  it("保存：POST documents，body 含 weeklyDocTitle 与 markdown；成功 → t('saved')", async () => {
    const h = streamHarness();
    render(<ProjectInsightView wid={WID} />);
    const h2 = streamHarness();
    fireEvent.click(screen.getByText("ai.projectInsight:tabWeekly").closest("button")!);
    await waitFor(() => expect(mocks.stream).toHaveBeenCalledTimes(2));
    h2.resolve("周报正文");
    await waitFor(() => expect(screen.getByText("ai.projectInsight:saveAsDoc")).toBeTruthy());
    fireEvent.click(screen.getByText("ai.projectInsight:saveAsDoc").closest("button")!);
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    expect(mocks.api).toHaveBeenCalledWith(`/api/v1/workspaces/${WID}/documents`, {
      method: "POST",
      body: JSON.stringify({ title: "ai.projectInsight:weeklyDocTitle", markdown: "周报正文" }),
    });
    await waitFor(() => expect(screen.getByText("ai.projectInsight:saved")).toBeTruthy());
    h.resolve("ignored");
  });

  it("保存失败 → t('saveFailed')", async () => {
    mocks.api.mockRejectedValueOnce(new Error("save boom"));
    const h = streamHarness();
    render(<ProjectInsightView wid={WID} />);
    const h2 = streamHarness();
    fireEvent.click(screen.getByText("ai.projectInsight:tabWeekly").closest("button")!);
    await waitFor(() => expect(mocks.stream).toHaveBeenCalledTimes(2));
    h2.resolve("周报正文B");
    await waitFor(() => expect(screen.getByText("ai.projectInsight:saveAsDoc")).toBeTruthy());
    fireEvent.click(screen.getByText("ai.projectInsight:saveAsDoc").closest("button")!);
    await waitFor(() => expect(screen.getByText("ai.projectInsight:saveFailed")).toBeTruthy());
    h.resolve("ignored");
  });

  it("aria-label、标题与 Sparkles 渲染", async () => {
    const h = streamHarness();
    const { container } = render(<ProjectInsightView wid={WID} />);
    expect(container.firstElementChild?.getAttribute("aria-label")).toBe("ai.projectInsight:title");
    expect(container.querySelector("svg.lucide-sparkles")).toBeTruthy();
    h.resolve("x");
  });
});
