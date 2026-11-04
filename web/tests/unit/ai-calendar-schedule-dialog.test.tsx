// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * CalendarScheduleDialog 契约（components/ai/CalendarScheduleDialog.tsx）：
 *  1. props {wid, open, onClose, onSchedule?}；open=false 返回 null 且重置全部状态
 *  2. 描述必填（空/空白时生成按钮 disabled）；时长可选，5-480 内才随 payload 带上（Math.round）
 *  3. 生成 → POST /api/v1/ai/calendar-schedule {wid, description, duration?}，loading 中
 *     Escape 与遮罩点击均不关闭（close X 按钮 disabled）
 *  4. 成功渲染建议列表：title / 时间 formatTime→"MM-DD HH:MM" / duration / reason /
 *     conflicts（有冲突 t("conflict")：xxx，无冲突 t("noConflict")）+ FeedbackButtons
 *  5. 采纳 → onSchedule({title,startTime,endTime,duration}) + onClose
 *  6. 生成失败 → t("generateFailed") 错误条（可 dismiss）；空建议 → t("noSuggestions")
 */

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  toast: vi.fn(),
  onClose: vi.fn(),
  onSchedule: vi.fn(),
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

import CalendarScheduleDialog from "@/components/ai/CalendarScheduleDialog";

const WID = "ws-csd-1";
const NS = "ai.calendarSchedule";

/** 本地时区构造 ISO（formatTime 再解析回本地，前后往返恒定，不依赖 CI 时区） */
function localIso(y: number, m: number, d: number, h: number, mi: number): string {
  return new Date(y, m - 1, d, h, mi).toISOString();
}

const SUG_A = {
  title: "评审会议",
  startTime: localIso(2026, 11, 5, 9, 30),
  endTime: localIso(2026, 11, 5, 10, 30),
  duration: 60,
  reason: "避开已有会议",
  conflicts: null,
};
const SUG_B = {
  title: "专注编码时段",
  startTime: localIso(2026, 11, 6, 14, 0),
  endTime: localIso(2026, 11, 6, 16, 0),
  duration: 120,
  reason: "",
  conflicts: "与周会重叠",
};

function renderDialog(props: { open?: boolean } = {}) {
  return render(
    <CalendarScheduleDialog
      wid={WID}
      open={props.open ?? true}
      onClose={mocks.onClose}
      onSchedule={mocks.onSchedule}
    />,
  );
}

function descArea() {
  return screen.getByLabelText(`${NS}:descriptionLabel`) as HTMLTextAreaElement;
}
function durationInput() {
  return screen.getByLabelText(`${NS}:durationLabel`) as HTMLInputElement;
}
function generateButton() {
  return screen.getByText(`${NS}:generate`).closest("button") as HTMLButtonElement;
}

beforeEach(() => {
  mocks.api.mockReset();
  mocks.toast.mockReset();
  mocks.onClose.mockReset();
  mocks.onSchedule.mockReset();
});
afterEach(() => cleanup());

describe("CalendarScheduleDialog", () => {
  it("对话框骨架：dialog 角色、标题、描述/时长输入、关闭按钮（button:close）", () => {
    renderDialog();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(`${NS}:title`)).toBeInTheDocument();
    expect(descArea()).toBeInTheDocument();
    expect(durationInput()).toBeInTheDocument();
    expect(screen.getByLabelText("button:close")).toBeInTheDocument();
    // 初始空描述 → 生成按钮 disabled（无建议时显示空态文案）
    expect(generateButton()).toBeDisabled();
    expect(screen.getByText(`${NS}:noSuggestions`)).toBeInTheDocument();
  });

  it("open=false 返回 null，不渲染任何内容", () => {
    const { container } = renderDialog({ open: false });
    expect(container).toBeEmptyDOMElement();
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it("空/纯空白描述时生成按钮 disabled（descriptionRequired 分支经 disabled 拦截）", () => {
    renderDialog();
    fireEvent.change(descArea(), { target: { value: "   " } });
    expect(generateButton()).toBeDisabled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("生成请求：POST /api/v1/ai/calendar-schedule，无时长时 body 恰为 {wid, description}", async () => {
    mocks.api.mockResolvedValueOnce({ suggestions: [] });
    renderDialog();
    fireEvent.change(descArea(), { target: { value: "  安排下周复盘会  " } });
    fireEvent.click(generateButton());

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    expect(mocks.api).toHaveBeenCalledWith("/api/v1/ai/calendar-schedule", {
      method: "POST",
      body: JSON.stringify({ wid: WID, description: "安排下周复盘会" }),
      signal: expect.any(AbortSignal),
    });
  });

  it("时长合法（90.6）→ Math.round 后 91 随 payload 带上", async () => {
    mocks.api.mockResolvedValueOnce({ suggestions: [] });
    renderDialog();
    fireEvent.change(descArea(), { target: { value: "写周报" } });
    fireEvent.change(durationInput(), { target: { value: "90.6" } });
    fireEvent.click(generateButton());

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    expect(mocks.api).toHaveBeenCalledWith("/api/v1/ai/calendar-schedule", {
      method: "POST",
      body: JSON.stringify({ wid: WID, description: "写周报", duration: 91 }),
      signal: expect.any(AbortSignal),
    });
  });

  it("时长越界（600 与 4）→ 不随 payload 带上", async () => {
    mocks.api.mockResolvedValue({ suggestions: [] });
    renderDialog();
    fireEvent.change(descArea(), { target: { value: "排会" } });

    fireEvent.change(durationInput(), { target: { value: "600" } });
    fireEvent.click(generateButton());
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    expect(mocks.api).toHaveBeenLastCalledWith(
      "/api/v1/ai/calendar-schedule",
      expect.objectContaining({
        body: JSON.stringify({ wid: WID, description: "排会" }),
      }),
    );

    fireEvent.change(durationInput(), { target: { value: "4" } });
    fireEvent.click(generateButton());
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    expect(mocks.api).toHaveBeenLastCalledWith(
      "/api/v1/ai/calendar-schedule",
      expect.objectContaining({
        body: JSON.stringify({ wid: WID, description: "排会" }),
      }),
    );
    await waitFor(() => expect(screen.getByText(`${NS}:noSuggestions`)).toBeInTheDocument());
  });

  it("成功渲染建议列表：时间 MM-DD HH:MM、reason、无冲突 noConflict、FeedbackButtons", async () => {
    mocks.api.mockResolvedValueOnce({ suggestions: [SUG_A] });
    renderDialog();
    fireEvent.change(descArea(), { target: { value: "评审" } });
    fireEvent.click(generateButton());

    await waitFor(() => expect(screen.getByText("评审会议")).toBeInTheDocument());
    expect(screen.getByText(`${NS}:suggestions`)).toBeInTheDocument();
    // 本地时区往返：2026-11-05 09:30 — 2026-11-05 10:30
    expect(screen.getByText(/11-05 09:30 — 11-05 10:30/)).toBeInTheDocument();
    expect(screen.getByText("避开已有会议")).toBeInTheDocument();
    expect(screen.getByText(`${NS}:noConflict`)).toBeInTheDocument();
    expect(screen.queryByText(`${NS}:conflict`)).toBeFalsy();
    const fb = screen.getByTestId("fb");
    expect(fb.getAttribute("data-capability")).toBe("calendar-schedule");
    expect(fb.getAttribute("data-wid")).toBe(WID);
  });

  it("conflicts 非空 → conflict 文案拼接冲突说明；空 reason 不渲染", async () => {
    mocks.api.mockResolvedValueOnce({ suggestions: [SUG_B] });
    renderDialog();
    fireEvent.change(descArea(), { target: { value: "专注时段" } });
    fireEvent.click(generateButton());

    await waitFor(() => expect(screen.getByText("专注编码时段")).toBeInTheDocument());
    expect(screen.getByText(`${NS}:conflict：与周会重叠`)).toBeInTheDocument();
    expect(screen.queryByText(`${NS}:noConflict`)).toBeFalsy();
    expect(screen.queryByText(`${NS}:reason`)).toBeFalsy();
    // SUG_B.reason 为空 → 无理由段落
    expect(screen.queryByText("避开已有会议")).toBeFalsy();
  });

  it("采纳：onSchedule 收到 {title,startTime,endTime,duration} 并 onClose", async () => {
    mocks.api.mockResolvedValueOnce({ suggestions: [SUG_A] });
    renderDialog();
    fireEvent.change(descArea(), { target: { value: "评审" } });
    fireEvent.click(generateButton());
    await waitFor(() => expect(screen.getByText("评审会议")).toBeInTheDocument());

    fireEvent.click(screen.getByText(`${NS}:adopt`).closest("button")!);
    expect(mocks.onSchedule).toHaveBeenCalledTimes(1);
    expect(mocks.onSchedule).toHaveBeenCalledWith({
      title: SUG_A.title,
      startTime: SUG_A.startTime,
      endTime: SUG_A.endTime,
      duration: 60,
    });
    expect(mocks.onClose).toHaveBeenCalledTimes(1);
  });

  it("生成失败 → generateFailed 错误条，dismiss（calendarSchedule:close）后清除", async () => {
    mocks.api.mockRejectedValueOnce(new Error("boom"));
    renderDialog();
    fireEvent.change(descArea(), { target: { value: "排会" } });
    fireEvent.click(generateButton());

    await waitFor(() => expect(screen.getByText(`${NS}:generateFailed`)).toBeInTheDocument());
    expect(screen.queryByTestId("fb")).toBeFalsy();
    fireEvent.click(screen.getByLabelText(`${NS}:close`));
    expect(screen.queryByText(`${NS}:generateFailed`)).toBeFalsy();
  });

  it("空建议 → noSuggestions 空态，无反馈按钮", async () => {
    mocks.api.mockResolvedValueOnce({ suggestions: [] });
    renderDialog();
    fireEvent.change(descArea(), { target: { value: "排会" } });
    fireEvent.click(generateButton());

    await waitFor(() => expect(screen.getByText(`${NS}:noSuggestions`)).toBeInTheDocument());
    expect(screen.queryByTestId("fb")).toBeFalsy();
  });

  it("loading 中 Escape 与遮罩点击不关闭；加载完成后 Escape 关闭", async () => {
    let resolveApi!: (v: unknown) => void;
    mocks.api.mockReturnValueOnce(
      new Promise((res) => {
        resolveApi = res;
      }),
    );
    renderDialog();
    fireEvent.change(descArea(), { target: { value: "排会" } });
    fireEvent.click(generateButton());
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));

    // loading：生成按钮文案切换、Escape/遮罩/关闭按钮均不生效
    const genBtn = screen.getByText(`${NS}:generating`).closest("button") as HTMLButtonElement;
    expect(genBtn).toBeDisabled();
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("dialog"));
    fireEvent.click(screen.getByLabelText("button:close"));
    expect(mocks.onClose).not.toHaveBeenCalled();

    resolveApi({ suggestions: [SUG_A] });
    await waitFor(() => expect(screen.getByText("评审会议")).toBeInTheDocument());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(mocks.onClose).toHaveBeenCalledTimes(1);
  });

  it("关闭再打开：状态重置（描述清空、建议清空回到空态）", async () => {
    mocks.api.mockResolvedValueOnce({ suggestions: [SUG_A] });
    const { rerender, container } = renderDialog();
    fireEvent.change(descArea(), { target: { value: "排会" } });
    fireEvent.click(generateButton());
    await waitFor(() => expect(screen.getByText("评审会议")).toBeInTheDocument());

    rerender(
      <CalendarScheduleDialog
        wid={WID}
        open={false}
        onClose={mocks.onClose}
        onSchedule={mocks.onSchedule}
      />,
    );
    await waitFor(() => expect(container).toBeEmptyDOMElement());

    rerender(
      <CalendarScheduleDialog
        wid={WID}
        open={true}
        onClose={mocks.onClose}
        onSchedule={mocks.onSchedule}
      />,
    );
    expect((descArea().value as string) || descArea().value).toBe("");
    expect(screen.getByText(`${NS}:noSuggestions`)).toBeInTheDocument();
    expect(screen.queryByText("评审会议")).toBeFalsy();
    expect(screen.queryByText(`${NS}:suggestions`)).toBeFalsy();
  });
});
