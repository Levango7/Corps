// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * ApprovalAdvicePanel 契约（components/ai/ApprovalAdvicePanel.tsx）：
 *  1. 挂载即 consumeAiProgressStream("/api/v1/ai/approval-advice", { wid, approvalInstanceId },
 *     { signal, onProgress, onData })；初始 loading 态 t("analyzing")
 *  2. onProgress → ProgressSteps（currentStage/currentMessage 透传，
 *     stageNames = [tp("context"), tp("analyzing"), tp("generating")]）
 *  3. onData → 结构化结果：风险徽标（low/medium/high → riskLow/riskMedium/riskHigh）+
 *     riskFactors 列表 + suggestion + similarCases（approved/rejected 图标、amount>0 才显示 ¥金额）
 *  4. 失败（reject 非 AbortError）→ t("error") + t("retry") 重试按钮；点重试再次发起流
 *  5. AbortError 不视为错误：无 error 文案、无结果区
 *  6. 空分支：riskFactors/similarCases 为空显示 noRiskFactors/noSimilarCases，
 *     suggestion 为空不渲染该区块
 *  7. FeedbackButtons(capability="approval-advice", workspaceId=wid, originalOutput=advice)
 */

const mocks = vi.hoisted(() => ({
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
vi.mock("@/components/ai/ProgressSteps", () => ({
  ProgressSteps: (props: {
    currentStage?: unknown;
    currentMessage?: string;
    stageNames?: string[];
  }) => (
    <div
      data-testid="steps"
      data-stage={String(props.currentStage ?? "")}
      data-message={props.currentMessage ?? ""}
      data-stages={JSON.stringify(props.stageNames ?? [])}
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

import { ApprovalAdvicePanel } from "@/components/ai/ApprovalAdvicePanel";

const WID = "ws-aap-1";
const INSTANCE_ID = "appr-9";

/** 一次可控的进度流 */
interface StreamHarness {
  url: string;
  body: Record<string, unknown>;
  signal?: AbortSignal;
  onProgress?: (p: { stage: number; message: string }) => void;
  onData?: (d: unknown) => void;
  resolve: (result?: { text?: string; data?: unknown }) => void;
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
        onProgress?: (p: { stage: number; message: string }) => void;
        onData?: (d: unknown) => void;
      },
    ) => {
      h.url = url;
      h.body = body;
      h.signal = opts?.signal;
      h.onProgress = opts?.onProgress;
      h.onData = opts?.onData;
      return new Promise<{ text: string; data: unknown }>((res, rej) => {
        h.resolve = (result) => res({ text: result?.text ?? "", data: result?.data });
        h.reject = rej;
      });
    },
  );
  return h;
}

/** 完整建议结果（medium 风险 + 两条因素 + 两个案例） */
function adviceResult(overrides: Record<string, unknown> = {}) {
  return {
    riskLevel: "medium",
    riskFactors: ["金额超出常规区间", "审批人与申请人为同一人"],
    suggestion: "建议补充合同附件后再审",
    similarCases: [
      { title: "办公用品采购", result: "approved", amount: 1200 },
      { title: "差旅报销", result: "rejected", amount: 0 },
    ],
    ...overrides,
  };
}

/** 通过 onData 注入结果并等待结果态（风险徽标出现） */
async function loaded(h: StreamHarness, advice: Record<string, unknown>) {
  await waitFor(() => expect(mocks.stream).toHaveBeenCalled());
  h.onData?.(advice);
  h.resolve({});
  await waitFor(() => expect(screen.getByText("ai.approvalAdvice:riskLevel")).toBeTruthy());
}

/** 面板根容器（三种状态均为 aside aria-label=t("title")） */
const panel = () => screen.getByLabelText("ai.approvalAdvice:title");

beforeEach(() => {
  mocks.stream.mockReset();
});
afterEach(() => cleanup());

describe("ApprovalAdvicePanel", () => {
  it("挂载即自动调用流：url/body（wid + approvalInstanceId）/signal；初始 loading 态 t('analyzing')", async () => {
    const h = streamHarness();
    render(<ApprovalAdvicePanel wid={WID} approvalInstanceId={INSTANCE_ID} />);

    await waitFor(() => expect(mocks.stream).toHaveBeenCalledTimes(1));
    expect(h.url).toBe("/api/v1/ai/approval-advice");
    expect(h.body).toEqual({ wid: WID, approvalInstanceId: INSTANCE_ID });
    expect(h.signal).toBeInstanceOf(AbortSignal);
    expect(panel()).toBeTruthy();
    expect(screen.getByText("ai.approvalAdvice:analyzing")).toBeTruthy();
    expect(screen.queryByText("ai.approvalAdvice:riskLevel")).toBeFalsy();
    h.resolve({});
  });

  it("onProgress → ProgressSteps：stage/message 透传，stageNames 为 ai.progress 三键", async () => {
    const h = streamHarness();
    render(<ApprovalAdvicePanel wid={WID} approvalInstanceId={INSTANCE_ID} />);
    await waitFor(() => expect(mocks.stream).toHaveBeenCalled());

    h.onProgress?.({ stage: 2, message: "分析审批记录" });
    await waitFor(() => expect(screen.getByTestId("steps")).toBeTruthy());
    const steps = screen.getByTestId("steps");
    expect(steps.getAttribute("data-stage")).toBe("2");
    expect(steps.getAttribute("data-message")).toBe("分析审批记录");
    expect(JSON.parse(steps.getAttribute("data-stages") ?? "[]")).toEqual([
      "ai.progress:context",
      "ai.progress:analyzing",
      "ai.progress:generating",
    ]);
    // 有进度时不再显示纯 loading 文案
    expect(screen.queryByText("ai.approvalAdvice:analyzing")).toBeFalsy();
    h.resolve({});
  });

  it("onData 成功：medium 徽标 riskMedium + riskFactors 列表 + suggestion + FeedbackButtons", async () => {
    const h = streamHarness();
    const { container } = render(
      <ApprovalAdvicePanel wid={WID} approvalInstanceId={INSTANCE_ID} />,
    );
    await loaded(h, adviceResult());

    expect(screen.getByText("ai.approvalAdvice:riskMedium")).toBeTruthy();
    expect(screen.getByText("ai.approvalAdvice:riskFactors")).toBeTruthy();
    expect(screen.getByText("金额超出常规区间")).toBeTruthy();
    expect(screen.getByText("审批人与申请人为同一人")).toBeTruthy();
    expect(screen.getByText("ai.approvalAdvice:suggestion")).toBeTruthy();
    expect(screen.getByText("建议补充合同附件后再审")).toBeTruthy();
    // 2 条风险因素 + medium 徽标自身的 AlertTriangle = 3 枚
    expect(container.querySelectorAll("svg.lucide-alert-triangle")).toHaveLength(3);
    const fb = screen.getByTestId("fb");
    expect(fb.getAttribute("data-capability")).toBe("approval-advice");
    expect(fb.getAttribute("data-wid")).toBe(WID);
  });

  it("similarCases：approved→CheckCircle2、rejected→XCircle；amount>0 显示 ¥ 金额，amount=0 不显示", async () => {
    const h = streamHarness();
    const { container } = render(
      <ApprovalAdvicePanel wid={WID} approvalInstanceId={INSTANCE_ID} />,
    );
    await loaded(h, adviceResult());

    expect(screen.getByText("ai.approvalAdvice:similarCases")).toBeTruthy();
    expect(screen.getByText("办公用品采购")).toBeTruthy();
    expect(screen.getByText("¥1200")).toBeTruthy();
    expect(screen.getByText("差旅报销")).toBeTruthy();
    // approved 案例带 CheckCircle2（还含风险徽标 1 枚 medium 的 AlertTriangle，不冲突）
    expect(container.querySelectorAll("svg.lucide-check-circle-2")).toHaveLength(1);
    expect(container.querySelectorAll("svg.lucide-x-circle")).toHaveLength(1);
    h.resolve({});
  });

  it("riskLow：low 徽标文案为 riskLow", async () => {
    const h = streamHarness();
    render(<ApprovalAdvicePanel wid={WID} approvalInstanceId={INSTANCE_ID} />);
    await loaded(h, adviceResult({ riskLevel: "low", riskFactors: [], similarCases: [] }));
    expect(screen.getByText("ai.approvalAdvice:riskLow")).toBeTruthy();
  });

  it("riskHigh：high 徽标文案为 riskHigh", async () => {
    const h = streamHarness();
    render(<ApprovalAdvicePanel wid={WID} approvalInstanceId={INSTANCE_ID} />);
    await loaded(h, adviceResult({ riskLevel: "high" }));
    expect(screen.getByText("ai.approvalAdvice:riskHigh")).toBeTruthy();
  });

  it("空分支：riskFactors/similarCases 为空 → noRiskFactors/noSimilarCases；suggestion 空 → 无该区块", async () => {
    const h = streamHarness();
    render(<ApprovalAdvicePanel wid={WID} approvalInstanceId={INSTANCE_ID} />);
    await loaded(h, adviceResult({ suggestion: "", riskFactors: [], similarCases: [] }));

    expect(screen.getByText("ai.approvalAdvice:noRiskFactors")).toBeTruthy();
    expect(screen.getByText("ai.approvalAdvice:noSimilarCases")).toBeTruthy();
    expect(screen.queryByText("ai.approvalAdvice:suggestion")).toBeFalsy();
  });

  it("流失败（非 AbortError）→ t('error') + t('retry') 重试按钮，无结果区", async () => {
    const h = streamHarness();
    render(<ApprovalAdvicePanel wid={WID} approvalInstanceId={INSTANCE_ID} />);
    await waitFor(() => expect(mocks.stream).toHaveBeenCalled());
    h.reject(new Error("ai unavailable"));

    await waitFor(() => expect(screen.getByText("ai.approvalAdvice:error")).toBeTruthy());
    expect(screen.getByText("ai.approvalAdvice:retry").closest("button")).toBeTruthy();
    expect(screen.queryByText("ai.approvalAdvice:riskLevel")).toBeFalsy();
    expect(screen.queryByTestId("fb")).toBeFalsy();
  });

  it("点重试 → 再次调用流；第二次 onData 成功后渲染结果", async () => {
    const h1 = streamHarness();
    render(<ApprovalAdvicePanel wid={WID} approvalInstanceId={INSTANCE_ID} />);
    await waitFor(() => expect(mocks.stream).toHaveBeenCalledTimes(1));
    h1.reject(new Error("ai unavailable"));
    await waitFor(() => expect(screen.getByText("ai.approvalAdvice:error")).toBeTruthy());

    const h2 = streamHarness();
    fireEvent.click(screen.getByText("ai.approvalAdvice:retry").closest("button")!);
    await waitFor(() => expect(mocks.stream).toHaveBeenCalledTimes(2));
    expect(h2.url).toBe("/api/v1/ai/approval-advice");
    expect(h2.body).toEqual({ wid: WID, approvalInstanceId: INSTANCE_ID });

    h2.onData?.(adviceResult());
    h2.resolve({});
    await waitFor(() => expect(screen.getByText("ai.approvalAdvice:riskMedium")).toBeTruthy());
    expect(screen.queryByText("ai.approvalAdvice:error")).toBeFalsy();
  });

  it("流被 abort（AbortError）不视为错误：无 error 文案、无 loading、无结果区", async () => {
    const h = streamHarness();
    render(<ApprovalAdvicePanel wid={WID} approvalInstanceId={INSTANCE_ID} />);
    await waitFor(() => expect(mocks.stream).toHaveBeenCalled());
    const e = new Error("aborted");
    e.name = "AbortError";
    h.reject(e);

    await waitFor(() => expect(screen.queryByLabelText("ai.approvalAdvice:title")).toBeFalsy());
    expect(screen.queryByText("ai.approvalAdvice:error")).toBeFalsy();
    expect(screen.queryByText("ai.approvalAdvice:analyzing")).toBeFalsy();
    expect(screen.queryByTestId("fb")).toBeFalsy();
  });
});
