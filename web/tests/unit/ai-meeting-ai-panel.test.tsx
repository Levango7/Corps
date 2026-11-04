// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * MeetingAiPanel 契约（components/ai/MeetingAiPanel.tsx）：
 *  1. 挂载即 GET /api/v1/ai/meetings/sessions?wid=<wid>&limit=50；空列表 → t("noSessions")
 *  2. 列表非空默认选中第一条 → GET /api/v1/ai/meetings/sessions/{id}?wid=<wid> 渲染详情
 *     （状态文案、transcriptCount、转录输入区）
 *  3. 创建会话：POST /api/v1/ai/meetings/sessions {wid, title} → 新会话置顶并选中
 *     （触发详情 GET）+ toast success created + 输入框清空；标题空白时创建按钮 disabled
 *  4. 提交转录：POST /{id}/transcript {wid, speaker, text} → 详情刷新 + toast transcriptAdded；
 *     speaker/text 任一为空时发送按钮 disabled
 *  5. 分析：transcriptCount=0 时按钮 disabled 并提示 needTranscript；>0 可点 →
 *     POST /{id}/analyze {wid} → 详情刷新 + toast analyzed；结果全空时追加 toast warning noResults
 *  6. 结束/删除会话走 window.confirm：确认后 PATCH {status:"ended"} / DELETE；
 *     取消则不发请求
 *  7. 列表加载失败 → t("loadFailed") 错误条，可点关闭按钮清除
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
vi.mock("@/components/ai/MeetingActionItems", () => ({
  MeetingActionItems: (props: { wid: string; sessionId: string }) => (
    <div data-testid="mai" data-wid={props.wid} data-sid={props.sessionId} />
  ),
}));
vi.mock("@/components/ai/MeetingDecisions", () => ({
  MeetingDecisions: (props: { wid: string; sessionId: string }) => (
    <div data-testid="mad" data-wid={props.wid} data-sid={props.sessionId} />
  ),
}));

import MeetingAiPanel from "@/components/ai/MeetingAiPanel";

const WID = "ws-map-1";
const NS = "ai.aiMeeting";

const SESSION = {
  id: "sess-1",
  title: "周例会",
  status: "active",
  participantCount: 3,
  startTime: "2026-11-01T10:00:00.000Z",
  endTime: null,
  createdAt: "2026-11-01T09:00:00.000Z",
};
const DETAIL = {
  ...SESSION,
  transcript: [
    { speaker: "张三", text: "开始评审" },
    { speaker: "李四", text: "没有问题" },
  ],
  summary: null,
};
const SESSIONS_RESP = { items: [SESSION], nextCursor: null, hasMore: false };

/** 渲染并等待列表 + 默认详情加载完成（transcriptCount 文案出现） */
async function renderLoaded(detail = DETAIL, transcriptCount = 2) {
  mocks.api.mockResolvedValueOnce(SESSIONS_RESP);
  mocks.api.mockResolvedValueOnce(detail);
  render(<MeetingAiPanel wid={WID} />);
  await waitFor(() =>
    expect(screen.getByText(`${NS}:transcriptCount:{"n":${transcriptCount}}`)).toBeTruthy(),
  );
}

const createBtn = () => screen.getByText(`${NS}:create`).closest("button") as HTMLButtonElement;
const titleInput = () => screen.getByLabelText(`${NS}:titlePlaceholder`) as HTMLInputElement;
const analyzeBtn = () => screen.getByText(`${NS}:analyze`).closest("button") as HTMLButtonElement;

beforeEach(() => {
  mocks.api.mockReset();
  mocks.toast.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe("MeetingAiPanel", () => {
  it("空列表初始：GET sessions?wid&limit=50 → noSessions 空态；标题为空时创建按钮 disabled", async () => {
    mocks.api.mockResolvedValueOnce({ items: [], nextCursor: null, hasMore: false });
    render(<MeetingAiPanel wid={WID} />);

    await waitFor(() => expect(screen.getByText(`${NS}:noSessions`)).toBeTruthy());
    expect(mocks.api).toHaveBeenCalledWith(
      `/api/v1/ai/meetings/sessions?wid=${encodeURIComponent(WID)}&limit=50`,
      { signal: expect.any(AbortSignal) },
    );
    expect(createBtn()).toBeDisabled();
    expect(screen.queryByText(`${NS}:analyze`)).toBeFalsy();
  });

  it("列表默认选中第一条 → GET /{id}?wid= 详情；渲染状态 active、transcriptCount、转录输入区", async () => {
    await renderLoaded();

    // 详情 GET 无第二参数（不带 signal）
    expect(mocks.api).toHaveBeenNthCalledWith(
      2,
      `/api/v1/ai/meetings/sessions/${SESSION.id}?wid=${encodeURIComponent(WID)}`,
    );
    // 列表项与详情标题各一处
    expect(screen.getAllByText(SESSION.title)).toHaveLength(2);
    expect(screen.getByText(`${NS}:active`)).toBeTruthy();
    expect(screen.getByLabelText(`${NS}:speakerPlaceholder`)).toBeTruthy();
    expect(screen.getByLabelText(`${NS}:textPlaceholder`)).toBeTruthy();
    expect(screen.getByTestId("mai").getAttribute("data-sid")).toBe(SESSION.id);
    expect(screen.getByTestId("mad").getAttribute("data-wid")).toBe(WID);
  });

  it("创建会话：POST {wid, title} → toast created、新会话选中并拉详情、输入框清空", async () => {
    const created = { ...SESSION, id: "sess-2", title: "评审会" };
    mocks.api
      .mockResolvedValueOnce({ items: [], nextCursor: null, hasMore: false })
      .mockResolvedValueOnce(created)
      .mockResolvedValueOnce({ ...created, transcript: [], summary: null });
    render(<MeetingAiPanel wid={WID} />);
    await waitFor(() => expect(screen.getByText(`${NS}:noSessions`)).toBeTruthy());

    fireEvent.change(titleInput(), { target: { value: "  评审会  " } });
    fireEvent.click(createBtn());

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(3));
    expect(mocks.api).toHaveBeenNthCalledWith(2, "/api/v1/ai/meetings/sessions", {
      method: "POST",
      body: JSON.stringify({ wid: WID, title: "评审会" }),
    });
    expect(mocks.api).toHaveBeenNthCalledWith(
      3,
      `/api/v1/ai/meetings/sessions/sess-2?wid=${encodeURIComponent(WID)}`,
    );
    expect(mocks.toast).toHaveBeenCalledWith("success", `${NS}:created`);
    expect((titleInput() as HTMLInputElement).value).toBe("");
  });

  it("提交转录：POST /{id}/transcript {wid, speaker, text} → 详情刷新 + toast transcriptAdded + 文本清空", async () => {
    await renderLoaded();
    mocks.api.mockResolvedValueOnce({});
    mocks.api.mockResolvedValueOnce({
      ...DETAIL,
      transcript: [...DETAIL.transcript, { speaker: "王五", text: "通过" }],
    });

    fireEvent.change(screen.getByLabelText(`${NS}:speakerPlaceholder`), {
      target: { value: " 王五 " },
    });
    fireEvent.change(screen.getByLabelText(`${NS}:textPlaceholder`), {
      target: { value: " 通过 " },
    });
    // 发送按钮 = 转录输入行内唯一 button（图标按钮，无 aria-label）
    const row = screen.getByLabelText(`${NS}:textPlaceholder`).closest("div")!;
    fireEvent.click(row.querySelector("button")!);

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(4));
    expect(mocks.api).toHaveBeenNthCalledWith(
      3,
      `/api/v1/ai/meetings/sessions/${SESSION.id}/transcript`,
      {
        method: "POST",
        body: JSON.stringify({ wid: WID, speaker: "王五", text: "通过" }),
      },
    );
    expect(mocks.api).toHaveBeenNthCalledWith(
      4,
      `/api/v1/ai/meetings/sessions/${SESSION.id}?wid=${encodeURIComponent(WID)}`,
    );
    expect(mocks.toast).toHaveBeenCalledWith("success", `${NS}:transcriptAdded`);
    expect((screen.getByLabelText(`${NS}:textPlaceholder`) as HTMLInputElement).value).toBe("");
  });

  it("speaker 或 text 为空时发送按钮 disabled", async () => {
    await renderLoaded();
    const row = screen.getByLabelText(`${NS}:textPlaceholder`).closest("div")!;
    const sendBtn = row.querySelector("button") as HTMLButtonElement;

    expect(sendBtn).toBeDisabled();
    fireEvent.change(screen.getByLabelText(`${NS}:speakerPlaceholder`), {
      target: { value: "王五" },
    });
    expect(sendBtn).toBeDisabled();
    fireEvent.change(screen.getByLabelText(`${NS}:textPlaceholder`), {
      target: { value: "通过" },
    });
    expect(sendBtn).not.toBeDisabled();
  });

  it("transcriptCount=0 → 分析按钮 disabled + needTranscript 提示", async () => {
    await renderLoaded({ ...DETAIL, transcript: [] }, 0);

    expect(analyzeBtn()).toBeDisabled();
    expect(screen.getByText(`${NS}:needTranscript`)).toBeTruthy();
  });

  it("分析：POST /{id}/analyze {wid} → 详情刷新 + toast analyzed（有结果无 warning）", async () => {
    await renderLoaded();
    mocks.api
      .mockResolvedValueOnce({
        summary: "本周期完成评审",
        actionItems: [{ id: "a1" }],
        decisions: [],
      })
      .mockResolvedValueOnce({ ...DETAIL, summary: "本周期完成评审" });

    fireEvent.click(analyzeBtn());

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(4));
    expect(mocks.api).toHaveBeenNthCalledWith(
      3,
      `/api/v1/ai/meetings/sessions/${SESSION.id}/analyze`,
      { method: "POST", body: JSON.stringify({ wid: WID }) },
    );
    // 分析后详情刷新
    expect(mocks.api).toHaveBeenNthCalledWith(
      4,
      `/api/v1/ai/meetings/sessions/${SESSION.id}?wid=${encodeURIComponent(WID)}`,
    );
    expect(mocks.toast).toHaveBeenCalledWith("success", `${NS}:analyzed`);
    expect(mocks.toast).not.toHaveBeenCalledWith("warning", `${NS}:noResults`);
  });

  it("分析结果全空 → 追加 toast warning noResults", async () => {
    await renderLoaded();
    mocks.api
      .mockResolvedValueOnce({ summary: "", actionItems: [], decisions: [] })
      .mockResolvedValueOnce(DETAIL);

    fireEvent.click(analyzeBtn());

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("warning", `${NS}:noResults`));
    expect(mocks.toast).toHaveBeenCalledWith("success", `${NS}:analyzed`);
  });

  it("结束会话：confirm 确认 → PATCH {wid, status:'ended'} + toast ended", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    await renderLoaded();
    mocks.api.mockResolvedValueOnce({});

    fireEvent.click(screen.getByTitle(`${NS}:end`));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("success", `${NS}:ended`));
    expect(confirmSpy).toHaveBeenCalledWith(`${NS}:confirmEnd`);
    expect(mocks.api).toHaveBeenLastCalledWith(
      `/api/v1/ai/meetings/sessions/${SESSION.id}?wid=${encodeURIComponent(WID)}`,
      { method: "PATCH", body: JSON.stringify({ wid: WID, status: "ended" }) },
    );
  });

  it("结束会话：confirm 取消 → 不发 PATCH", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await renderLoaded();

    fireEvent.click(screen.getByTitle(`${NS}:end`));

    expect(mocks.api).toHaveBeenCalledTimes(2); // 仅挂载时的列表 + 详情
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("删除会话：confirm 确认 → DELETE → 回到 noSessions 空态 + toast deleted", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    await renderLoaded();
    mocks.api.mockResolvedValueOnce({});

    fireEvent.click(screen.getByTitle(`${NS}:delete`));

    await waitFor(() => expect(screen.getByText(`${NS}:noSessions`)).toBeTruthy());
    expect(confirmSpy).toHaveBeenCalledWith(`${NS}:confirmDelete`);
    expect(mocks.api).toHaveBeenLastCalledWith(
      `/api/v1/ai/meetings/sessions/${SESSION.id}?wid=${encodeURIComponent(WID)}`,
      { method: "DELETE" },
    );
    expect(mocks.toast).toHaveBeenCalledWith("success", `${NS}:deleted`);
  });

  it("列表加载失败 → loadFailed 错误条；点关闭按钮清除", async () => {
    mocks.api.mockRejectedValueOnce(new Error("boom"));
    render(<MeetingAiPanel wid={WID} />);

    await waitFor(() => expect(screen.getByText(`${NS}:loadFailed`)).toBeTruthy());
    fireEvent.click(screen.getByLabelText("close"));
    expect(screen.queryByText(`${NS}:loadFailed`)).toBeFalsy();
  });
});
