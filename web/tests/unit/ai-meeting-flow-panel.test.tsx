// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * MeetingFlowPanel 契约（components/ai/MeetingFlowPanel.tsx）：
 *  五步流程状态机 input → minutes → decisions → actions → confirm → done，每步可跳过。
 *  1. input：转写 textarea；为空时分析按钮 disabled；点击 → POST /api/v1/ai/meeting-flow
 *     { phase:"post", transcript, wid, meetingId } → minutes 步（Markdown 渲染纪要）
 *  2. minutes：编辑/预览切换（编辑 textarea aria-label=summaryLabel）；下一步 →
 *     POST /api/v1/workspaces/{wid}/decisions/extract { sourceText: summary } → decisions
 *  3. decisions：决策标题输入 + Markdown；下一步 → POST /{wid}/action-items/generate
 *     { decisionMarkdown } → actions
 *  4. actions：标题/描述/负责人/截止日期输入；下一步 → confirm（taskCount）
 *  5. confirm：执行 → 逐条 POST /{wid}/tasks {title, description, status:"todo",
 *     priority:"medium", dueDate}；部分失败 → toast warning partialCreateSuccess{created, failed:1}
 *     仍进入 done；done：doneTitle + doneHint{count} + FeedbackButtons(meeting-flow)
 *  6. skip 逐步推进（minutes→decisions→actions→confirm）；分析失败 → t("error")
 */

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  toast: vi.fn(),
  onClose: vi.fn(),
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
vi.mock("@/components/Toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));
vi.mock("@/components/Markdown", () => ({
  default: ({ source }: { source: string }) => <div data-testid="md">{source}</div>,
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

import MeetingFlowPanel from "@/components/ai/MeetingFlowPanel";

const WID = "ws-mfp-1";
const MEETING_ID = "mtg-7";
const NS = "ai.meetingFlow";
const TRANSCRIPT = "本周评审了登录模块，决定采用方案 A";

const EXTRACT_RESP = {
  title: "采用方案 A",
  markdown: "- 决策一",
  suggestedTags: ["范围"],
  provider: "deepseek",
};
const TWO_ACTIONS = {
  actionItems: [
    {
      title: "改造登录表单",
      description: "接入方案 A",
      suggestedAssignee: "Alice",
      suggestedDueDate: "2026-11-10",
    },
    {
      title: "回归测试",
      description: "覆盖主流程",
      suggestedAssignee: null,
      suggestedDueDate: null,
    },
  ],
};

const transcriptBox = () =>
  screen.getByLabelText(`${NS}:transcriptPlaceholder`) as HTMLTextAreaElement;
const analyzeBtn = () => screen.getByText(`${NS}:analyze`).closest("button") as HTMLButtonElement;
const nextBtn = () => screen.getByText(`${NS}:next`).closest("button") as HTMLButtonElement;
const skipBtn = () => screen.getByText(`${NS}:skip`).closest("button") as HTMLButtonElement;

/** 渲染并走完 input → minutes（纪要已生成） */
async function toMinutes(summary = "## 会议纪要\n完成三项") {
  mocks.api.mockResolvedValueOnce({ summary, decisions: [], actionItems: [] });
  render(<MeetingFlowPanel wid={WID} meetingId={MEETING_ID} onClose={mocks.onClose} />);
  fireEvent.change(transcriptBox(), { target: { value: TRANSCRIPT } });
  fireEvent.click(analyzeBtn());
  await waitFor(() => expect(screen.getByText(`${NS}:minutesTitle`)).toBeTruthy());
}

/** minutes → decisions（已提取决策） */
async function toDecisions() {
  await toMinutes();
  mocks.api.mockResolvedValueOnce(EXTRACT_RESP);
  fireEvent.click(nextBtn());
  await waitFor(() => expect(screen.getByText(`${NS}:decisionsTitle`)).toBeTruthy());
}

/** decisions → actions（已生成 2 条行动项） */
async function toActions() {
  await toDecisions();
  mocks.api.mockResolvedValueOnce(TWO_ACTIONS);
  fireEvent.click(nextBtn());
  await waitFor(() => expect(screen.getByText(`${NS}:actionItemsTitle`)).toBeTruthy());
}

/** actions → confirm */
async function toConfirm() {
  await toActions();
  fireEvent.click(nextBtn());
  await waitFor(() => expect(screen.getByText(`${NS}:confirmTitle`)).toBeTruthy());
}

beforeEach(() => {
  mocks.api.mockReset();
  mocks.toast.mockReset();
  mocks.onClose.mockReset();
});
afterEach(() => cleanup());

describe("MeetingFlowPanel", () => {
  it("初始 input 步：标题、输入提示、转写 textarea、关闭按钮 onClose；转写为空时分析按钮 disabled", () => {
    render(<MeetingFlowPanel wid={WID} onClose={mocks.onClose} />);

    expect(screen.getByText(`${NS}:title`)).toBeTruthy();
    expect(screen.getByText(`${NS}:inputHint`)).toBeTruthy();
    expect(transcriptBox().value).toBe("");
    expect(analyzeBtn()).toBeDisabled();
    expect(screen.queryByText(`${NS}:skip`)).toBeFalsy();
    fireEvent.click(screen.getByLabelText(`${NS}:close`));
    expect(mocks.onClose).toHaveBeenCalledTimes(1);
  });

  it("分析：POST /api/v1/ai/meeting-flow（phase/transcript/wid/meetingId）→ minutes 步 Markdown 渲染纪要 + 进度指示", async () => {
    await toMinutes();

    expect(mocks.api).toHaveBeenCalledWith("/api/v1/ai/meeting-flow", {
      method: "POST",
      body: JSON.stringify({
        phase: "post",
        transcript: TRANSCRIPT,
        wid: WID,
        meetingId: MEETING_ID,
      }),
      signal: expect.any(AbortSignal),
    });
    expect(screen.getByTestId("md").textContent).toBe("## 会议纪要\n完成三项");
    // 进度指示 4 段（minutes 为第 1 步）
    expect(screen.getByText(`${NS}:step 1`)).toBeTruthy();
    expect(screen.queryByText(`${NS}:inputHint`)).toBeFalsy();
  });

  it("分析失败（非 AbortError）→ t('error') 错误条，停留 input 步", async () => {
    mocks.api.mockRejectedValueOnce(new Error("boom"));
    render(<MeetingFlowPanel wid={WID} onClose={mocks.onClose} />);
    fireEvent.change(transcriptBox(), { target: { value: TRANSCRIPT } });
    fireEvent.click(analyzeBtn());

    await waitFor(() => expect(screen.getByText(`${NS}:error`)).toBeTruthy());
    expect(screen.getByText(`${NS}:inputHint`)).toBeTruthy();
  });

  it("minutes 编辑/预览切换：编辑 textarea 可改纪要，回预览渲染新文本", async () => {
    await toMinutes();

    fireEvent.click(screen.getByText(`${NS}:edit`));
    const ta = screen.getByLabelText(`${NS}:summaryLabel`) as HTMLTextAreaElement;
    expect(ta.value).toBe("## 会议纪要\n完成三项");
    fireEvent.change(ta, { target: { value: "## 修改后的纪要" } });
    fireEvent.click(screen.getByText(`${NS}:preview`));
    expect(screen.queryByLabelText(`${NS}:summaryLabel`)).toBeFalsy();
    expect(screen.getByTestId("md").textContent).toBe("## 修改后的纪要");
  });

  it("minutes → decisions：POST /decisions/extract {sourceText} → 决策标题与 Markdown 渲染", async () => {
    await toMinutes();
    mocks.api.mockResolvedValueOnce(EXTRACT_RESP);

    fireEvent.click(nextBtn());
    await waitFor(() => expect(screen.getByText(`${NS}:decisionsTitle`)).toBeTruthy());

    expect(mocks.api).toHaveBeenLastCalledWith(`/api/v1/workspaces/${WID}/decisions/extract`, {
      method: "POST",
      body: JSON.stringify({ sourceText: "## 会议纪要\n完成三项" }),
      signal: expect.any(AbortSignal),
    });
    expect((screen.getByLabelText(`${NS}:decisionTitleLabel`) as HTMLInputElement).value).toBe(
      "采用方案 A",
    );
    expect(screen.getByTestId("md").textContent).toBe("- 决策一");
  });

  it("minutes 跳过 → 直接进 decisions 步并显示 noDecisions，不调 extract", async () => {
    await toMinutes();
    fireEvent.click(skipBtn());

    await waitFor(() => expect(screen.getByText(`${NS}:noDecisions`)).toBeTruthy());
    expect(mocks.api).toHaveBeenCalledTimes(1); // 仅 analyze 一次
  });

  it("decisions → actions：POST /action-items/generate {decisionMarkdown} → 行动项四个输入回填", async () => {
    await toDecisions();
    mocks.api.mockResolvedValueOnce(TWO_ACTIONS);

    fireEvent.click(nextBtn());
    await waitFor(() => expect(screen.getByText(`${NS}:actionItemsTitle`)).toBeTruthy());

    expect(mocks.api).toHaveBeenLastCalledWith(`/api/v1/workspaces/${WID}/action-items/generate`, {
      method: "POST",
      body: JSON.stringify({ decisionMarkdown: "- 决策一" }),
      signal: expect.any(AbortSignal),
    });
    // 两条行动项各有同名列控件，断言取第一条
    expect((screen.getAllByLabelText(`${NS}:actionTitleLabel`)[0] as HTMLInputElement).value).toBe(
      "改造登录表单",
    );
    expect(
      (screen.getAllByLabelText(`${NS}:actionDescLabel`)[0] as HTMLTextAreaElement).value,
    ).toBe("接入方案 A");
    expect((screen.getAllByLabelText(`${NS}:assigneeLabel`)[0] as HTMLInputElement).value).toBe(
      "Alice",
    );
    expect((screen.getAllByLabelText(`${NS}:dueDateLabel`)[0] as HTMLInputElement).value).toBe(
      "2026-11-10",
    );
  });

  it("decisions 跳过 → actions 步显示 noActionItems，不调 generate", async () => {
    await toMinutes();
    fireEvent.click(skipBtn());
    await waitFor(() => expect(screen.getByText(`${NS}:noDecisions`)).toBeTruthy());

    fireEvent.click(skipBtn());
    await waitFor(() => expect(screen.getByText(`${NS}:noActionItems`)).toBeTruthy());
    expect(mocks.api).toHaveBeenCalledTimes(1);
  });

  it("actions → confirm：显示 taskCount {count:2}", async () => {
    await toConfirm();

    expect(screen.getByText(`${NS}:taskCount:{"count":2}`)).toBeTruthy();
    expect(screen.getByText(`${NS}:confirmHint`)).toBeTruthy();
  });

  it("confirm 执行：逐条 POST /{wid}/tasks（status/priority/dueDate）→ done 步 doneHint + FeedbackButtons", async () => {
    await toConfirm();
    mocks.api.mockResolvedValue({});

    fireEvent.click(screen.getByText(`${NS}:execute`).closest("button")!);
    await waitFor(() => expect(screen.getByText(`${NS}:doneTitle`)).toBeTruthy());

    // 调用序：1=meeting-flow、2=extract、3=generate、4/5=两条任务创建
    expect(mocks.api).toHaveBeenNthCalledWith(4, `/api/v1/workspaces/${WID}/tasks`, {
      method: "POST",
      body: JSON.stringify({
        title: "改造登录表单",
        description: "接入方案 A",
        status: "todo",
        priority: "medium",
        dueDate: "2026-11-10",
      }),
      signal: expect.any(AbortSignal),
    });
    // 第 2 条无 dueDate（undefined 被 JSON.stringify 丢弃）
    expect(mocks.api).toHaveBeenNthCalledWith(5, `/api/v1/workspaces/${WID}/tasks`, {
      method: "POST",
      body: JSON.stringify({
        title: "回归测试",
        description: "覆盖主流程",
        status: "todo",
        priority: "medium",
      }),
      signal: expect.any(AbortSignal),
    });
    expect(screen.getByText(`${NS}:doneHint:{"count":2}`)).toBeTruthy();
    const fb = screen.getByTestId("fb");
    expect(fb.getAttribute("data-capability")).toBe("meeting-flow");
    expect(fb.getAttribute("data-wid")).toBe(WID);
    // done 步无底部操作栏与错误
    expect(screen.queryByText(`${NS}:execute`)).toBeFalsy();
    expect(screen.queryByText(`${NS}:skip`)).toBeFalsy();
  });

  it("执行部分失败：第 2 条失败 → toast warning partialCreateSuccess{created:1, failed:1} 仍进 done（count=1）", async () => {
    await toConfirm();
    mocks.api.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("boom"));

    fireEvent.click(screen.getByText(`${NS}:execute`).closest("button")!);
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        "warning",
        `${NS}:partialCreateSuccess:{"created":1,"failed":1}`,
      ),
    );
    expect(screen.getByText(`${NS}:doneHint:{"count":1}`)).toBeTruthy();
  });

  it("actions 跳过 → confirm（0 条）→ 执行按钮 disabled", async () => {
    await toMinutes();
    fireEvent.click(skipBtn());
    await waitFor(() => expect(screen.getByText(`${NS}:noDecisions`)).toBeTruthy());
    fireEvent.click(skipBtn());
    await waitFor(() => expect(screen.getByText(`${NS}:noActionItems`)).toBeTruthy());
    fireEvent.click(skipBtn());
    await waitFor(() => expect(screen.getByText(`${NS}:confirmTitle`)).toBeTruthy());

    expect(screen.getByText(`${NS}:taskCount:{"count":0}`)).toBeTruthy();
    expect(screen.getByText(`${NS}:execute`).closest("button")).toBeDisabled();
  });
});
