// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * OrchestrationPanel 契约（components/ai/OrchestrationPanel.tsx）：
 *  1. 可选关注点输入 → POST /api/v1/ai/orchestrate {wid, userRequest?} → plan{summary, reasoning, actions}
 *  2. actions 默认全选（role=checkbox aria-checked），可取消勾选
 *  3. 执行 PATCH 同 URL {wid, actions: [选中的按索引升序]}
 *  4. data.success=true → toast success + 方案清空；部分失败 → 保留方案 + 逐条成功/失败标记
 *     + toast warning（部分成功）或 error（全失败）；无选中 → 执行 disabled
 *  5. analyze 失败 → error 错误条（close 按钮 aria-label=t("cancel")）；FeedbackButtons(orchestrate)
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
vi.mock("@/lib/api", () => ({ api: mocks.api }));
vi.mock("@/components/Toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
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

import OrchestrationPanel from "@/components/ai/OrchestrationPanel";

const WID = "ws-or-1";

function planFixture() {
  return {
    summary: "建议先建任务再通知",
    reasoning: "基于当前进度滞后与团队负载推断",
    actions: [
      { type: "createTask", title: "写周报" },
      { type: "notify", message: "提醒负责人" },
    ],
  };
}

function checkboxes() {
  return screen.getAllByRole("checkbox");
}

/** 等首次分析完成（summary 文案出现） */
async function analyzed() {
  await waitFor(() => expect(screen.getByText("建议先建任务再通知")).toBeInTheDocument());
}

beforeEach(() => {
  mocks.api.mockReset();
  mocks.toast.mockReset();
});
afterEach(() => cleanup());

describe("OrchestrationPanel", () => {
  it("初始：标题/输入框/分析按钮可用（无方案）", () => {
    render(<OrchestrationPanel wid={WID} />);

    expect(screen.getByText("ai.orchestration:title")).toBeInTheDocument();
    expect(screen.getByLabelText("ai.orchestration:userRequest")).toBeInTheDocument();
    expect(screen.getByText("ai.orchestration:analyze").closest("button")).toBeEnabled();
    expect(screen.queryByRole("checkbox")).toBeFalsy();
  });

  it("关注点 trim 后进 body；空输入传 undefined", async () => {
    mocks.api.mockResolvedValueOnce(planFixture());
    render(<OrchestrationPanel wid={WID} />);
    fireEvent.change(screen.getByLabelText("ai.orchestration:userRequest"), {
      target: { value: "  看看进度  " },
    });
    fireEvent.click(screen.getByText("ai.orchestration:analyze").closest("button")!);
    await analyzed();

    expect(mocks.api).toHaveBeenCalledWith("/api/v1/ai/orchestrate", {
      method: "POST",
      body: JSON.stringify({ wid: WID, userRequest: "看看进度" }),
      signal: expect.any(AbortSignal),
    });
  });

  it("方案渲染：summary/reasoning/actions 类型与 createTask 描述；默认全选；反馈按钮带 wid", async () => {
    mocks.api.mockResolvedValueOnce(planFixture());
    render(<OrchestrationPanel wid={WID} />);
    fireEvent.click(screen.getByText("ai.orchestration:analyze").closest("button")!);
    await analyzed();

    expect(screen.getByText("基于当前进度滞后与团队负载推断")).toBeInTheDocument();
    expect(screen.getByText("createTask")).toBeInTheDocument();
    expect(screen.getByText("写周报")).toBeInTheDocument();
    expect(checkboxes()).toHaveLength(2);
    expect(checkboxes()[0]).toHaveAttribute("aria-checked", "true");
    expect(checkboxes()[0]).toHaveAttribute(
      "aria-label",
      "ai.orchestration:selectActions createTask",
    );
    const fb = screen.getByTestId("fb");
    expect(fb.getAttribute("data-capability")).toBe("orchestrate");
    expect(fb.getAttribute("data-wid")).toBe(WID);
  });

  it("取消勾选后执行：PATCH body 只含选中的 action（按索引升序）", async () => {
    mocks.api
      .mockResolvedValueOnce(planFixture())
      .mockResolvedValueOnce({ success: true, results: [] });
    render(<OrchestrationPanel wid={WID} />);
    fireEvent.click(screen.getByText("ai.orchestration:analyze").closest("button")!);
    await analyzed();

    fireEvent.click(checkboxes()[0]); // 取消 createTask
    expect(checkboxes()[0]).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByText("ai.orchestration:execute").closest("button")!);

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    expect(mocks.api).toHaveBeenLastCalledWith("/api/v1/ai/orchestrate", {
      method: "PATCH",
      body: JSON.stringify({ wid: WID, actions: [{ type: "notify", message: "提醒负责人" }] }),
      signal: expect.any(AbortSignal),
    });
  });

  it("执行成功 → toast success 且方案清空", async () => {
    mocks.api
      .mockResolvedValueOnce(planFixture())
      .mockResolvedValueOnce({ success: true, results: [] });
    render(<OrchestrationPanel wid={WID} />);
    fireEvent.click(screen.getByText("ai.orchestration:analyze").closest("button")!);
    await analyzed();
    fireEvent.click(screen.getByText("ai.orchestration:execute").closest("button")!);

    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith("success", "ai.orchestration:success"),
    );
    await waitFor(() => expect(screen.queryByRole("checkbox")).toBeFalsy());
  });

  it("部分失败：方案保留，成功/失败标记各一条，toast warning partialSuccess", async () => {
    mocks.api.mockResolvedValueOnce(planFixture()).mockResolvedValueOnce({
      success: false,
      results: [
        { success: true, result: { id: "t-1" } },
        { success: false, error: "通知渠道不可用" },
      ],
    });
    render(<OrchestrationPanel wid={WID} />);
    fireEvent.click(screen.getByText("ai.orchestration:analyze").closest("button")!);
    await analyzed();
    fireEvent.click(screen.getByText("ai.orchestration:execute").closest("button")!);

    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith("warning", "ai.orchestration:partialSuccess"),
    );
    // 方案没被清空：两个 checkbox 都在，各带 success/failure 标记
    expect(checkboxes()).toHaveLength(2);
    expect(screen.getByText("ai.orchestration:success")).toBeInTheDocument();
    expect(screen.getByText("ai.orchestration:failure")).toBeInTheDocument();
  });

  it("全部失败 → toast error failure", async () => {
    mocks.api.mockResolvedValueOnce(planFixture()).mockResolvedValueOnce({
      success: false,
      results: [
        { success: false, error: "x" },
        { success: false, error: "y" },
      ],
    });
    render(<OrchestrationPanel wid={WID} />);
    fireEvent.click(screen.getByText("ai.orchestration:analyze").closest("button")!);
    await analyzed();
    fireEvent.click(screen.getByText("ai.orchestration:execute").closest("button")!);

    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith("error", "ai.orchestration:failure"),
    );
  });

  it("取消全部勾选后执行按钮 disabled", async () => {
    mocks.api.mockResolvedValueOnce(planFixture());
    render(<OrchestrationPanel wid={WID} />);
    fireEvent.click(screen.getByText("ai.orchestration:analyze").closest("button")!);
    await analyzed();

    fireEvent.click(checkboxes()[0]);
    fireEvent.click(checkboxes()[1]);
    expect(screen.getByText("ai.orchestration:execute").closest("button")).toBeDisabled();
  });

  it("analyze 失败 → error 错误条，close（aria-label=t('cancel')）可清除", async () => {
    mocks.api.mockRejectedValueOnce(new Error("boom"));
    render(<OrchestrationPanel wid={WID} />);
    fireEvent.click(screen.getByText("ai.orchestration:analyze").closest("button")!);

    await waitFor(() => expect(screen.getByText("ai.orchestration:error")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("ai.orchestration:cancel"));
    expect(screen.queryByText("ai.orchestration:error")).toBeFalsy();
  });

  it("方案 actions 为空 → noActions 文案且无执行按钮", async () => {
    mocks.api.mockResolvedValueOnce({ summary: "无需操作", reasoning: "一切正常", actions: [] });
    render(<OrchestrationPanel wid={WID} />);
    fireEvent.click(screen.getByText("ai.orchestration:analyze").closest("button")!);

    await waitFor(() => expect(screen.getByText("ai.orchestration:noActions")).toBeInTheDocument());
    expect(screen.queryByText("ai.orchestration:execute")).toBeFalsy();
  });
});
