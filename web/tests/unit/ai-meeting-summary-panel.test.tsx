// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * MeetingSummaryPanel 契约（components/ai/MeetingSummaryPanel.tsx）：
 *  1. 初始 transcript/meetingTitle 来自 props；transcript 为空时生成按钮 disabled + noTranscript 提示
 *  2. 生成 → POST /api/v1/ai/meeting-summary { wid, transcript(trim), meetingTitle?(trim||undefined) }
 *  3. 成功渲染：标题、参与者标签、关键讨论点、决策卡片、待办列表（负责人/截止日/优先级徽标）+ 编辑/导出入口
 *  4. 全空结果 → toast warning noResults 且无导出按钮（canExport=false）
 *  5. 待办入库 → POST /api/v1/workspaces/{wid}/tasks（dueDate YYYY-MM-DD → ISO；有负责人时 description=assigneePrefix）
 *     成功后按钮变 added disabled + toast success；失败（ApiError）→ toast error 透传 e.message
 *  6. 编辑模式：editBuffer 深拷贝（取消不落盘）、保存后生效
 *  7. 导出 Markdown：Blob + URL.createObjectURL + 锚点 click + revokeObjectURL
 *  8. 生成失败 → generateFailed 错误条
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

import MeetingSummaryPanel from "@/components/ai/MeetingSummaryPanel";
import { ApiError } from "@/lib/api";

const NS = "ai.meetingSummary";
const WID = "ws-mst-1";

function summaryResult() {
  return {
    title: "周会纪要",
    keyPoints: ["确认了排期", "讨论了上线风险"],
    decisions: [{ title: "采用方案 A", description: "成本更低" }],
    actionItems: [
      { title: "发送会议纪要", assignee: "Alice", dueDate: "2026-03-05", priority: "high" },
      { title: "更新项目文档", assignee: null, dueDate: null, priority: "low" },
    ],
    participants: ["Alice", "Bob"],
  };
}

function renderPanel(props: { initialTranscript?: string; initialMeetingTitle?: string } = {}) {
  return render(
    <MeetingSummaryPanel
      wid={WID}
      initialTranscript={props.initialTranscript}
      initialMeetingTitle={props.initialMeetingTitle}
    />,
  );
}

function transcriptBox() {
  return screen.getByLabelText(`${NS}:transcriptLabel`) as HTMLTextAreaElement;
}

function titleInput() {
  return screen.getByLabelText(`${NS}:meetingTitle`) as HTMLInputElement;
}

function generateButton() {
  return screen.getByText(`${NS}:generate`).closest("button") as HTMLButtonElement;
}

/** 填写转写并完成一次生成（纪要标题出现） */
async function generated() {
  mocks.api.mockResolvedValueOnce(summaryResult());
  const { container } = renderPanel({ initialTranscript: " 会议开场讨论了排期 " });
  fireEvent.change(transcriptBox(), { target: { value: " 会议开场讨论了排期 " } });
  fireEvent.click(generateButton());
  await waitFor(() => expect(screen.getByText("周会纪要")).toBeTruthy());
  return { container };
}

/** 头部按钮（导出/编辑/保存/取消图标按钮无文本，需按位置取） */
function headerButtons(container: HTMLElement) {
  return Array.from(container.querySelector("header")!.querySelectorAll("button"));
}

beforeEach(() => {
  mocks.api.mockReset();
  mocks.toast.mockReset();
});
afterEach(() => cleanup());

describe("MeetingSummaryPanel", () => {
  it("初始 props 填入输入框；未生成时空态 emptySummary", () => {
    renderPanel({ initialTranscript: "已有转写", initialMeetingTitle: "站会" });

    expect(transcriptBox().value).toBe("已有转写");
    expect(titleInput().value).toBe("站会");
    expect(screen.getByText(`${NS}:emptySummary`)).toBeInTheDocument();
    expect(screen.queryByText(`${NS}:actionItems`)).toBeFalsy();
  });

  it("transcript 为空时生成按钮 disabled 且有 noTranscript 提示；输入后启用", () => {
    renderPanel();

    expect(generateButton()).toBeDisabled();
    expect(screen.getByText(`${NS}:noTranscript`)).toBeInTheDocument();
    fireEvent.change(transcriptBox(), { target: { value: "有内容了" } });
    expect(generateButton()).not.toBeDisabled();
    expect(screen.queryByText(`${NS}:noTranscript`)).toBeFalsy();
  });

  it("生成请求：transcript/meetingTitle 均 trim，空标题传 undefined；生成中文案变 generating", async () => {
    let resolveApi!: (v: unknown) => void;
    mocks.api.mockReturnValueOnce(
      new Promise((res) => {
        resolveApi = res;
      }),
    );
    renderPanel();

    fireEvent.change(transcriptBox(), { target: { value: "  讨论内容  " } });
    fireEvent.change(titleInput(), { target: { value: "  周会  " } });
    const btn = generateButton();
    fireEvent.click(btn);

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    expect(mocks.api).toHaveBeenCalledWith("/api/v1/ai/meeting-summary", {
      method: "POST",
      body: JSON.stringify({
        wid: WID,
        transcript: "讨论内容",
        meetingTitle: "周会",
      }),
    });
    expect(btn).toBeDisabled();
    expect(screen.getAllByText(`${NS}:generating`).length).toBeGreaterThan(0);
    resolveApi(summaryResult());
    await waitFor(() => expect(screen.getByText("周会纪要")).toBeTruthy());
  });

  it("成功渲染：参与者标签、关键点、决策卡片、待办列表与优先级徽标", async () => {
    await generated();

    expect(screen.getByText(`${NS}:participants`)).toBeInTheDocument();
    expect(screen.getAllByText("Alice").length).toBe(2); // 参与者标签 + 待办负责人
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText(`${NS}:keyPoints`)).toBeInTheDocument();
    expect(screen.getByText("确认了排期")).toBeInTheDocument();
    expect(screen.getByText(`${NS}:decisions`)).toBeInTheDocument();
    expect(screen.getByText("采用方案 A")).toBeInTheDocument();
    expect(screen.getByText("成本更低")).toBeInTheDocument();
    expect(screen.getByText(`${NS}:actionItems`)).toBeInTheDocument();
    expect(screen.getByText("发送会议纪要")).toBeInTheDocument();
    expect(screen.getByText("2026-03-05")).toBeInTheDocument();
    expect(screen.getByText("high")).toBeInTheDocument();
    expect(screen.getByTitle(`${NS}:exportMarkdown`)).toBeTruthy();
    expect(screen.getByText(`${NS}:edit`)).toBeTruthy();
  });

  it("全空结果 → toast warning noResults，canExport=false 时无导出按钮", async () => {
    mocks.api.mockResolvedValueOnce({
      title: "",
      keyPoints: [],
      decisions: [],
      actionItems: [],
      participants: [],
    });
    renderPanel({ initialTranscript: "内容" });
    fireEvent.click(generateButton());

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("warning", `${NS}:noResults`));
    expect(screen.queryByTitle(`${NS}:exportMarkdown`)).toBeFalsy();
    // 编辑按钮只依赖 summary 存在，不受 canExport 控制
    expect(screen.getByTitle(`${NS}:edit`)).toBeTruthy();
  });

  it("生成失败 → generateFailed 错误条", async () => {
    mocks.api.mockRejectedValueOnce(new Error("boom"));
    renderPanel({ initialTranscript: "内容" });
    fireEvent.click(generateButton());

    await waitFor(() => expect(screen.getByText(`${NS}:generateFailed`)).toBeTruthy());
  });

  it("待办入库：dueDate 转 ISO、负责人写进 description；成功后按钮变 added disabled + toast success", async () => {
    const { container } = await generated();

    fireEvent.click(screen.getAllByText(`${NS}:addToTodos`)[0]!);
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    expect(mocks.api).toHaveBeenNthCalledWith(2, `/api/v1/workspaces/${WID}/tasks`, {
      method: "POST",
      body: JSON.stringify({
        title: "发送会议纪要",
        description: `${NS}:assigneePrefix:${JSON.stringify({ name: "Alice" })}`,
        priority: "high",
        dueDate: "2026-03-05T00:00:00.000Z",
      }),
    });
    await waitFor(
      () => expect(headerButtons(container).length).toBeGreaterThan(0), // 占位等待后续断言稳定
    );
    const addedBtn = screen.getAllByText(`${NS}:added`).at(-1)!.closest("button")!;
    expect(addedBtn).toBeDisabled();
    expect(mocks.toast).toHaveBeenCalledWith("success", `${NS}:added`);
    // 第二条待办仍可入库
    expect(screen.getAllByText(`${NS}:addToTodos`)).toHaveLength(1);
  });

  it("无负责人/无截止日的待办入库：description 与 dueDate 均为 undefined", async () => {
    await generated();

    fireEvent.click(screen.getAllByText(`${NS}:addToTodos`)[1]!);
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    expect(mocks.api).toHaveBeenNthCalledWith(2, `/api/v1/workspaces/${WID}/tasks`, {
      method: "POST",
      body: JSON.stringify({
        title: "更新项目文档",
        description: undefined,
        priority: "low",
        dueDate: undefined,
      }),
    });
  });

  it("入库失败（ApiError）→ toast error 透传 e.message，按钮恢复可点", async () => {
    mocks.api
      .mockResolvedValueOnce(summaryResult())
      .mockRejectedValueOnce(new ApiError("配额不足", 429, 1001));
    renderPanel({ initialTranscript: "内容" });
    fireEvent.click(generateButton());
    await waitFor(() => expect(screen.getByText("周会纪要")).toBeTruthy());

    fireEvent.click(screen.getAllByText(`${NS}:addToTodos`)[0]!);
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("error", "配额不足"));
    expect(screen.getAllByText(`${NS}:addToTodos`)).toHaveLength(2);
    expect(screen.queryByText(`${NS}:addFailed`)).toBeFalsy();
  });

  it("编辑模式：editBuffer 深拷贝，修改后取消不落盘", async () => {
    const { container } = await generated();

    fireEvent.click(screen.getByText(`${NS}:edit`));
    const pointInput = screen.getByLabelText(`${NS}:keyPoints 1`) as HTMLInputElement;
    expect(pointInput.value).toBe("确认了排期");
    fireEvent.change(pointInput, { target: { value: "改掉的要点" } });
    // 头部按钮：保存（有文本）、取消（X 图标无文本）
    const cancelBtn = headerButtons(container).at(-1)!;
    expect(cancelBtn.textContent).not.toContain(NS);
    fireEvent.click(cancelBtn);

    expect(screen.getByText("确认了排期")).toBeInTheDocument();
    expect(screen.queryByLabelText(`${NS}:keyPoints 1`)).toBeFalsy();
  });

  it("编辑保存：修改关键点后保存生效并回到展示态", async () => {
    await generated();

    fireEvent.click(screen.getByText(`${NS}:edit`));
    fireEvent.change(screen.getByLabelText(`${NS}:keyPoints 1`), {
      target: { value: "排期已确认到周五" },
    });
    fireEvent.click(screen.getByText(`${NS}:save`));

    expect(screen.getByText("排期已确认到周五")).toBeInTheDocument();
    expect(screen.queryByLabelText(`${NS}:keyPoints 1`)).toBeFalsy();
    expect(screen.getByText("讨论了上线风险")).toBeInTheDocument();
  });

  it("导出 Markdown：Blob 下载链路（createObjectURL → 锚点 click → revokeObjectURL）", async () => {
    const createObjectURL = vi.fn(() => "blob:mock-url");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const { container } = await generated();

    fireEvent.click(screen.getByTitle(`${NS}:exportMarkdown`));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
    expect(container.querySelector("a[download]")).toBeFalsy(); // 临时锚点已移除
    clickSpy.mockRestore();
  });
});
