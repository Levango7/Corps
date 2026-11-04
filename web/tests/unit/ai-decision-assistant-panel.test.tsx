// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * DecisionAssistantPanel 契约（components/ai/DecisionAssistantPanel.tsx）：
 *  1. 初始空态：问题为空时分析按钮 disabled + noQuestion 提示 + emptyHint
 *  2. 点击分析 → POST /api/v1/ai/decision-assistant { wid, question(trim), context?(trim||undefined) }
 *     分析中按钮 disabled 且文案变 analyzing
 *  3. 成功渲染方案卡片（标题/描述/优势/劣势/风险列表）、推荐理由、历史决策参考
 *  4. recommendation.optionIndex 对应卡片带 recommended 徽标（唯一）
 *  5. options 为空 → toast warning noResults；historicalRefs 为空 → noHistoricalRefs 文案
 *  6. ApiError → 错误条透传 e.message；普通 Error → t("analyzeFailed")（不泄露 e.message）
 *  7. 错误条 close 按钮（aria-label="close"）清除错误
 */

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  toast: vi.fn(),
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
  ApiError: class ApiError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ApiError";
    }
  },
}));
vi.mock("@/components/Toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

import DecisionAssistantPanel from "@/components/ai/DecisionAssistantPanel";
import { ApiError } from "@/lib/api";

const NS = "ai.decisionAssistant";
const WID = "ws-dap-1";
const QUESTION = "  应该选 A 方案还是 B 方案  ";
const QUESTION_TRIMMED = "应该选 A 方案还是 B 方案";

function decisionResult() {
  return {
    options: [
      {
        title: "自建服务",
        description: "团队自研并维护",
        pros: ["完全可控", "无订阅费用"],
        cons: ["人力成本高"],
        risks: ["进度延期"],
      },
      {
        title: "采购 SaaS",
        description: "直接使用第三方服务",
        pros: ["上线快"],
        cons: [],
        risks: [],
      },
    ],
    recommendation: { optionIndex: 0, reason: "长期成本更低且数据自主可控" },
    historicalRefs: [{ title: "去年监控选型", outcome: "自建方案按期上线" }],
  };
}

function renderPanel() {
  return render(<DecisionAssistantPanel wid={WID} />);
}

function analyzeButton() {
  return screen.getByText(`${NS}:analyze`).closest("button") as HTMLButtonElement;
}

function questionBox() {
  return screen.getByLabelText(`${NS}:questionLabel`) as HTMLTextAreaElement;
}

/** 等首次分析完成（结果标题出现） */
async function analyzed() {
  await waitFor(() => expect(screen.getByText("自建服务")).toBeTruthy());
}

beforeEach(() => {
  mocks.api.mockReset();
  mocks.toast.mockReset();
});
afterEach(() => cleanup());

describe("DecisionAssistantPanel", () => {
  it("初始空态：面板标题、分析按钮 disabled、noQuestion 提示与 emptyHint", () => {
    const { container } = renderPanel();

    expect(container.querySelector(`[aria-label="${NS}:title"]`)).toBeTruthy();
    expect(analyzeButton()).toBeDisabled();
    expect(screen.getByText(`${NS}:noQuestion`)).toBeInTheDocument();
    expect(screen.getByText(`${NS}:emptyHint`)).toBeInTheDocument();
    expect(screen.queryByText(`${NS}:options`)).toBeFalsy();
  });

  it("输入决策问题后分析按钮启用且提示消失", () => {
    renderPanel();

    fireEvent.change(questionBox(), { target: { value: QUESTION } });
    expect(analyzeButton()).not.toBeDisabled();
    expect(screen.queryByText(`${NS}:noQuestion`)).toBeFalsy();
  });

  it("分析请求：question 去首尾空格、无 context 时为 undefined；分析中按钮 disabled 且文案变 analyzing", async () => {
    let resolveApi!: (v: unknown) => void;
    mocks.api.mockReturnValueOnce(
      new Promise((res) => {
        resolveApi = res;
      }),
    );
    renderPanel();

    const btn = analyzeButton();
    fireEvent.change(questionBox(), { target: { value: QUESTION } });
    fireEvent.click(btn);

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    expect(mocks.api).toHaveBeenCalledWith("/api/v1/ai/decision-assistant", {
      method: "POST",
      body: JSON.stringify({ wid: WID, question: QUESTION_TRIMMED, context: undefined }),
    });
    expect(btn).toBeDisabled();
    expect(screen.getAllByText(`${NS}:analyzing`).length).toBeGreaterThan(0);
    expect(questionBox()).toBeDisabled();
    resolveApi(decisionResult());
    await analyzed();
  });

  it("填写补充背景时请求体携带 context", async () => {
    mocks.api.mockResolvedValueOnce(decisionResult());
    renderPanel();

    fireEvent.change(questionBox(), { target: { value: QUESTION } });
    fireEvent.change(screen.getByLabelText(`${NS}:contextLabel`), {
      target: { value: "  当前已有两个候选供应商  " },
    });
    fireEvent.click(analyzeButton());

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    expect(mocks.api).toHaveBeenCalledWith("/api/v1/ai/decision-assistant", {
      method: "POST",
      body: JSON.stringify({
        wid: WID,
        question: QUESTION_TRIMMED,
        context: "当前已有两个候选供应商",
      }),
    });
    await analyzed();
  });

  it("成功渲染：方案卡片（标题/描述/优势/劣势/风险）、推荐理由与历史参考", async () => {
    mocks.api.mockResolvedValueOnce(decisionResult());
    renderPanel();
    fireEvent.change(questionBox(), { target: { value: QUESTION } });
    fireEvent.click(analyzeButton());
    await analyzed();

    expect(screen.getByText(`${NS}:optionLabel 1`).closest("h4")!.textContent).toContain(
      "自建服务",
    );
    expect(screen.getByText(`${NS}:optionLabel 2`).closest("h4")!.textContent).toContain(
      "采购 SaaS",
    );
    expect(screen.getByText(`${NS}:options`)).toBeInTheDocument();
    expect(screen.getByText("完全可控")).toBeInTheDocument();
    expect(screen.getByText("无订阅费用")).toBeInTheDocument();
    // 两个方案都有优势，故 pros 头出现两次
    expect(screen.getAllByText(`${NS}:pros`)).toHaveLength(2);
    expect(screen.getByText("人力成本高")).toBeInTheDocument();
    expect(screen.getByText(`${NS}:cons`)).toBeInTheDocument();
    expect(screen.getByText("进度延期")).toBeInTheDocument();
    expect(screen.getByText(`${NS}:risks`)).toBeInTheDocument();
    expect(screen.getByText(`${NS}:recommendationReason`)).toBeInTheDocument();
    expect(screen.getByText("长期成本更低且数据自主可控")).toBeInTheDocument();
    expect(screen.getByText(`${NS}:historicalRefs`)).toBeInTheDocument();
    expect(screen.getByText("去年监控选型")).toBeInTheDocument();
    expect(screen.getByText("自建方案按期上线")).toBeInTheDocument();
  });

  it("推荐徽标唯一且落在 recommendation.optionIndex 对应卡片标题内", async () => {
    mocks.api.mockResolvedValueOnce(decisionResult());
    renderPanel();
    fireEvent.change(questionBox(), { target: { value: QUESTION } });
    fireEvent.click(analyzeButton());
    await analyzed();

    const badges = screen.getAllByText(`${NS}:recommended`);
    expect(badges).toHaveLength(1);
    // 徽标与 h4 同级（外层为标题行 div），再上一层即方案卡片
    const card = badges[0]!.closest("div")!.parentElement!;
    expect(card.textContent).toContain("自建服务");
    expect(card.textContent).not.toContain("采购 SaaS");
  });

  it("options 为空 → toast warning noResults，不渲染方案区但渲染历史参考", async () => {
    mocks.api.mockResolvedValueOnce({
      options: [],
      recommendation: { optionIndex: -1, reason: "" },
      historicalRefs: [{ title: "旧决策", outcome: "结果尚可" }],
    });
    renderPanel();
    fireEvent.change(questionBox(), { target: { value: QUESTION } });
    fireEvent.click(analyzeButton());
    await waitFor(() => expect(screen.getByText("旧决策")).toBeTruthy());

    expect(mocks.toast).toHaveBeenCalledWith("warning", `${NS}:noResults`);
    expect(screen.queryByText(`${NS}:options`)).toBeFalsy();
    expect(screen.queryByText(`${NS}:recommendationReason`)).toBeFalsy();
    expect(screen.getByText(`${NS}:historicalRefs`)).toBeInTheDocument();
  });

  it("historicalRefs 为空 → 显示 noHistoricalRefs 占位文案", async () => {
    mocks.api.mockResolvedValueOnce({
      options: decisionResult().options,
      recommendation: decisionResult().recommendation,
      historicalRefs: [],
    });
    renderPanel();
    fireEvent.change(questionBox(), { target: { value: QUESTION } });
    fireEvent.click(analyzeButton());
    await analyzed();

    expect(screen.getByText(`${NS}:noHistoricalRefs`)).toBeInTheDocument();
    expect(screen.queryByText("去年监控选型")).toBeFalsy();
  });

  it("ApiError → 错误条透传 e.message，分析结束按钮恢复", async () => {
    mocks.api.mockRejectedValueOnce(new ApiError("AI 配额不足", 429, 1001));
    renderPanel();
    fireEvent.change(questionBox(), { target: { value: QUESTION } });
    fireEvent.click(analyzeButton());

    await waitFor(() => expect(screen.getByText("AI 配额不足")).toBeTruthy());
    expect(analyzeButton()).not.toBeDisabled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("普通 Error → 错误文案为 analyzeFailed，不泄露 e.message", async () => {
    mocks.api.mockRejectedValueOnce(new Error("内部堆栈详情"));
    renderPanel();
    fireEvent.change(questionBox(), { target: { value: QUESTION } });
    fireEvent.click(analyzeButton());

    await waitFor(() => expect(screen.getByText(`${NS}:analyzeFailed`)).toBeTruthy());
    expect(screen.queryByText("内部堆栈详情")).toBeFalsy();
  });

  it("错误条 close 按钮（aria-label=close）清除错误", async () => {
    mocks.api.mockRejectedValueOnce(new Error("boom"));
    renderPanel();
    fireEvent.change(questionBox(), { target: { value: QUESTION } });
    fireEvent.click(analyzeButton());
    await waitFor(() => expect(screen.getByText(`${NS}:analyzeFailed`)).toBeTruthy());

    fireEvent.click(screen.getAllByLabelText("close")[0]!);
    expect(screen.queryByText(`${NS}:analyzeFailed`)).toBeFalsy();
  });
});
