// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * TodoExtractDialog 契约（components/ai/TodoExtractDialog.tsx）：
 *  1. props {wid, onClose, onCreated?}；外层 presentation + 内层 dialog 双 role
 *  2. 三个来源 tab（message 默认 / document / email，aria-pressed）；内容必填（空白时提取 disabled）
 *  3. 提取 → POST /api/v1/ai/todo-extract {wid, source, content}（content 原样不 trim）
 *  4. 失败：ApiError → 显示 e.message；其他 Error → t("extractFailed")
 *  5. 成功渲染可编辑待办（标题/负责人/截止日期/优先级/置信度），默认全选；selectAll 全选切换
 *  6. reasoning 可折叠（aria-expanded）
 *  7. 批量入库 → 对勾选且标题非空者逐条 POST /api/v1/workspaces/{wid}/tasks
 *     全成功 toast success added{count}；部分失败 warning partialAdded；全失败 error addFailed 不关闭
 *  8. 勾选但标题全空白 → toast error noTodos，不发 POST；空结果 → t("noTodos") 文案且无底部操作栏
 */

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  toast: vi.fn(),
  onClose: vi.fn(),
  onCreated: vi.fn(),
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
vi.mock("@/components/Toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

import TodoExtractDialog from "@/components/ai/TodoExtractDialog";
import { ApiError } from "@/lib/api";

const WID = "ws-ted-1";
const NS = "ai.todoExtract";
const CONTENT = "客户要求周五前交付报价单，并安排一次评审会议";

const EXTRACT_RESULT = {
  todos: [
    {
      title: "回复客户邮件 ",
      description: " 附上报价单 ",
      assignee: "Alice",
      dueDate: "2026-11-10",
      priority: "high",
      confidence: 0.92,
    },
    {
      title: "整理会议纪要",
      description: "",
      assignee: null,
      dueDate: null,
      priority: "low",
      confidence: 0.5,
    },
  ],
  reasoning: "从消息中识别出两条待办",
};

function renderDialog() {
  return render(
    <TodoExtractDialog wid={WID} onClose={mocks.onClose} onCreated={mocks.onCreated} />,
  );
}

function contentArea() {
  return screen.getByLabelText(`${NS}:contentLabel`) as HTMLTextAreaElement;
}
function extractButton() {
  return screen.getByText(`${NS}:extract`).closest("button") as HTMLButtonElement;
}
/** 完成一次提取（点击提取按钮并等待结果列表出现） */
async function extracted() {
  fireEvent.click(extractButton());
  await waitFor(() => expect(screen.getAllByLabelText(`${NS}:todoTitle`).length).toBe(2));
}

/** 全选 checkbox（aria-label 随 allSelected 在 selectAll/deselectAll 间翻转） */
function selectAllBox() {
  const el =
    screen.queryByLabelText(`${NS}:deselectAll`) ?? screen.getByLabelText(`${NS}:selectAll`);
  return el as HTMLInputElement;
}

beforeEach(() => {
  mocks.api.mockReset();
  mocks.toast.mockReset();
  mocks.onClose.mockReset();
  mocks.onCreated.mockReset();
});
afterEach(() => cleanup());

describe("TodoExtractDialog", () => {
  it("对话框骨架：presentation+dialog 双 role、标题、三个来源 tab（message 默认激活）", () => {
    renderDialog();
    expect(screen.getByRole("presentation")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(`${NS}:title`)).toBeInTheDocument();
    for (const [key, pressed] of [
      ["sourceMessage", "true"],
      ["sourceDocument", "false"],
      ["sourceEmail", "false"],
    ] as const) {
      const tab = screen.getByText(`${NS}:${key}`).closest("button")!;
      expect(tab.getAttribute("aria-pressed")).toBe(pressed);
    }
    expect(screen.getByLabelText("button:close")).toBeInTheDocument();
  });

  it("空内容时提取按钮 disabled；输入后可用且字数计数渲染", () => {
    renderDialog();
    expect(extractButton()).toBeDisabled();
    fireEvent.change(contentArea(), { target: { value: CONTENT } });
    expect(extractButton()).toBeEnabled();
    expect(screen.getByText(`${CONTENT.length}/10000`)).toBeInTheDocument();
  });

  it("提取请求：POST /api/v1/ai/todo-extract body {wid, source:'message', content 原样}；loading 态", async () => {
    let resolveApi!: (v: unknown) => void;
    mocks.api.mockReturnValueOnce(
      new Promise((res) => {
        resolveApi = res;
      }),
    );
    renderDialog();
    fireEvent.change(contentArea(), { target: { value: `  ${CONTENT}  ` } });
    fireEvent.click(extractButton());

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    expect(mocks.api).toHaveBeenCalledWith("/api/v1/ai/todo-extract", {
      method: "POST",
      body: JSON.stringify({ wid: WID, source: "message", content: `  ${CONTENT}  ` }),
      signal: expect.any(AbortSignal),
    });
    // extracting 文案同时出现在按钮与 loading 区块
    expect(screen.getAllByText(`${NS}:extracting`).length).toBeGreaterThanOrEqual(2);
    expect(contentArea()).toBeDisabled();
    resolveApi(EXTRACT_RESULT);
    await waitFor(() => expect(screen.getAllByLabelText(`${NS}:todoTitle`).length).toBe(2));
  });

  it("切换来源 tab 后再次提取：aria-pressed 转移且 body.source=document", async () => {
    mocks.api.mockResolvedValueOnce(EXTRACT_RESULT).mockResolvedValueOnce(EXTRACT_RESULT);
    renderDialog();
    fireEvent.change(contentArea(), { target: { value: CONTENT } });
    await extracted();

    fireEvent.click(screen.getByText(`${NS}:sourceDocument`).closest("button")!);
    expect(
      screen.getByText(`${NS}:sourceDocument`).closest("button")!.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByText(`${NS}:sourceMessage`).closest("button")!.getAttribute("aria-pressed"),
    ).toBe("false");
    fireEvent.click(extractButton());

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    expect(mocks.api).toHaveBeenLastCalledWith("/api/v1/ai/todo-extract", {
      method: "POST",
      body: JSON.stringify({ wid: WID, source: "document", content: CONTENT }),
      signal: expect.any(AbortSignal),
    });
  });

  it("成功渲染待办列表：标题/负责人/截止日期截断/优先级/置信度、默认全选 2/2", async () => {
    mocks.api.mockResolvedValueOnce(EXTRACT_RESULT);
    renderDialog();
    fireEvent.change(contentArea(), { target: { value: CONTENT } });
    await extracted();

    const titles = screen.getAllByLabelText(`${NS}:todoTitle`) as HTMLInputElement[];
    expect(titles[0].value).toBe("回复客户邮件 ");
    const assignees = screen.getAllByLabelText(`${NS}:todoAssignee`) as HTMLInputElement[];
    expect(assignees[0].value).toBe("Alice");
    expect(assignees[1].value).toBe("");
    const dues = screen.getAllByLabelText(`${NS}:todoDueDate`) as HTMLInputElement[];
    expect(dues[0].value).toBe("2026-11-10");
    expect(dues[1].value).toBe("");
    const prios = screen.getAllByLabelText(`${NS}:todoPriority`) as HTMLSelectElement[];
    expect(prios[0].value).toBe("high");
    expect(prios[1].value).toBe("low");
    expect(screen.getByText("92%")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("2/2")).toBeInTheDocument();
    expect(selectAllBox()).toBeChecked();
    expect(screen.getByText(`${NS}:addToTodos`).closest("button")).toBeInTheDocument();
    expect(screen.getByText("button:cancel")).toBeInTheDocument();
  });

  it("编辑标题与优先级回写表单状态", async () => {
    mocks.api.mockResolvedValueOnce(EXTRACT_RESULT);
    renderDialog();
    fireEvent.change(contentArea(), { target: { value: CONTENT } });
    await extracted();

    fireEvent.change(screen.getAllByLabelText(`${NS}:todoTitle`)[0], {
      target: { value: "改后标题" },
    });
    expect((screen.getAllByLabelText(`${NS}:todoTitle`)[0] as HTMLInputElement).value).toBe(
      "改后标题",
    );
    const prio = screen.getAllByLabelText(`${NS}:todoPriority`)[0] as HTMLSelectElement;
    fireEvent.change(prio, { target: { value: "urgent" } });
    expect((screen.getAllByLabelText(`${NS}:todoPriority`)[0] as HTMLSelectElement).value).toBe(
      "urgent",
    );
  });

  it("全选/取消全选：aria-label 翻转、计数 2/2 → 0/2 → 2/2、逐条勾选框联动", async () => {
    mocks.api.mockResolvedValueOnce(EXTRACT_RESULT);
    renderDialog();
    fireEvent.change(contentArea(), { target: { value: CONTENT } });
    await extracted();

    expect(screen.getByText("2/2")).toBeInTheDocument();
    // 当前全选 → aria-label 为 deselectAll，点击取消全部
    fireEvent.click(selectAllBox());
    expect(screen.getByText("0/2")).toBeInTheDocument();
    expect(screen.getByLabelText(`${NS}:selectAll`)).not.toBeChecked();
    expect((screen.getAllByLabelText(`${NS}:selectTodo`)[0] as HTMLInputElement).checked).toBe(
      false,
    );
    expect(screen.getByText(`${NS}:addToTodos`).closest("button")).toBeDisabled();

    // 再点全选恢复
    fireEvent.click(selectAllBox());
    expect(screen.getByText("2/2")).toBeInTheDocument();
    expect(selectAllBox()).toBeChecked();
  });

  it("reasoning 可折叠：默认收起，点击展开显示内容且 aria-expanded=true", async () => {
    mocks.api.mockResolvedValueOnce(EXTRACT_RESULT);
    renderDialog();
    fireEvent.change(contentArea(), { target: { value: CONTENT } });
    await extracted();

    const toggle = screen.getByText(`${NS}:reasoning`).closest("button")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(EXTRACT_RESULT.reasoning)).toBeFalsy();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(EXTRACT_RESULT.reasoning)).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.queryByText(EXTRACT_RESULT.reasoning)).toBeFalsy();
  });

  it("提取失败：普通 Error → extractFailed；ApiError → 显示 e.message", async () => {
    renderDialog();
    fireEvent.change(contentArea(), { target: { value: CONTENT } });

    mocks.api.mockRejectedValueOnce(new Error("boom"));
    fireEvent.click(extractButton());
    await waitFor(() => expect(screen.getByText(`${NS}:extractFailed`)).toBeInTheDocument());
    // dismiss（错误条内的 button:close，DOM 序列在 header X 之后）
    fireEvent.click(screen.getAllByLabelText("button:close")[1]);
    expect(screen.queryByText(`${NS}:extractFailed`)).toBeFalsy();

    mocks.api.mockRejectedValueOnce(new ApiError("服务限流，请稍后重试", 429, 1001));
    fireEvent.click(extractButton());
    await waitFor(() => expect(screen.getByText("服务限流，请稍后重试")).toBeInTheDocument());
    expect(screen.queryByText(`${NS}:extractFailed`)).toBeFalsy();
  });

  it("空结果 todos:[] → noTodos 空态，无底部操作栏与 reasoning", async () => {
    mocks.api.mockResolvedValueOnce({ todos: [], reasoning: "" });
    renderDialog();
    fireEvent.change(contentArea(), { target: { value: CONTENT } });
    fireEvent.click(extractButton());

    await waitFor(() => expect(screen.getByText(`${NS}:noTodos`)).toBeInTheDocument());
    expect(screen.queryByText(`${NS}:addToTodos`)).toBeFalsy();
    expect(screen.queryByText("button:cancel")).toBeFalsy();
    expect(screen.queryByText(`${NS}:reasoning`)).toBeFalsy();
  });

  it("批量入库成功：逐条 POST body 精确（空 description/dueDate 被剔除）+ added{count:2} + onCreated + onClose", async () => {
    mocks.api
      .mockResolvedValueOnce(EXTRACT_RESULT)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    renderDialog();
    fireEvent.change(contentArea(), { target: { value: CONTENT } });
    await extracted();

    fireEvent.click(screen.getByText(`${NS}:addToTodos`).closest("button")!);
    await waitFor(() => expect(mocks.onClose).toHaveBeenCalledTimes(1));
    expect(mocks.api).toHaveBeenNthCalledWith(2, `/api/v1/workspaces/${WID}/tasks`, {
      method: "POST",
      body: JSON.stringify({
        title: "回复客户邮件",
        description: "附上报价单",
        priority: "high",
        dueDate: "2026-11-10",
      }),
    });
    expect(mocks.api).toHaveBeenNthCalledWith(3, `/api/v1/workspaces/${WID}/tasks`, {
      method: "POST",
      body: JSON.stringify({ title: "整理会议纪要", priority: "low" }),
    });
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith("success", `${NS}:added:{"count":2}`),
    );
    expect(mocks.onCreated).toHaveBeenCalledTimes(1);
  });

  it("批量入库部分失败：第 1 条成功第 2 条失败 → warning partialAdded{created:1,failed:1} 仍关闭", async () => {
    mocks.api
      .mockResolvedValueOnce(EXTRACT_RESULT)
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("boom"));
    renderDialog();
    fireEvent.change(contentArea(), { target: { value: CONTENT } });
    await extracted();

    fireEvent.click(screen.getByText(`${NS}:addToTodos`).closest("button")!);
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        "warning",
        `${NS}:partialAdded:{"created":1,"failed":1}`,
      ),
    );
    expect(mocks.onCreated).toHaveBeenCalledTimes(1);
    expect(mocks.onClose).toHaveBeenCalledTimes(1);
  });

  it("全失败 → error addFailed 不关闭；勾选但标题全空白 → toast noTodos 且不发 tasks POST", async () => {
    mocks.api
      .mockResolvedValueOnce(EXTRACT_RESULT)
      .mockRejectedValueOnce(new Error("boom"))
      .mockRejectedValueOnce(new Error("boom"));
    renderDialog();
    fireEvent.change(contentArea(), { target: { value: CONTENT } });
    await extracted();

    fireEvent.click(screen.getByText(`${NS}:addToTodos`).closest("button")!);
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("error", `${NS}:addFailed`));
    expect(mocks.onClose).not.toHaveBeenCalled();

    // 第二段：勾选保留但标题全空白 → valid=0 → noTodos toast，无 tasks POST
    mocks.api.mockClear();
    fireEvent.change(screen.getAllByLabelText(`${NS}:todoTitle`)[0], { target: { value: "  " } });
    fireEvent.change(screen.getAllByLabelText(`${NS}:todoTitle`)[1], { target: { value: "  " } });
    fireEvent.click(screen.getByText(`${NS}:addToTodos`).closest("button")!);
    await waitFor(() => expect(mocks.toast).toHaveBeenLastCalledWith("error", `${NS}:noTodos`));
    expect(mocks.api).not.toHaveBeenCalled();
    expect(mocks.onClose).not.toHaveBeenCalled();
  });
});
