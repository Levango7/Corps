// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

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

const mocks = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(
      message: string,
      public status = 0,
      public code = 0,
    ) {
      super(message);
      this.name = "ApiError";
    }
  }
  return { api: vi.fn(), ApiErrorClass: ApiError, push: vi.fn(), toast: vi.fn() };
});
vi.mock("@/lib/api", () => ({ api: mocks.api, ApiError: mocks.ApiErrorClass }));
vi.mock("@/lib/i18n-navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/components/Toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));

import { MinutesEditor } from "@/components/minutes/MinutesEditor";

const PATCH_PATH = "/api/v1/workspaces/ws-1/meeting-minutes/m-1";
/** AI 相关 key 不在 messages 里 ⇒ 组件走 tf() 的中文回退文案 */
const AI_BTN = "AI 生成摘要";
const AI_TRANSCRIPT = "会议转写";

const initial = {
  title: "Weekly sync",
  content: "# Agenda\nbody",
  attendees: [
    { name: "Alice", role: "host" },
    { name: "Bob", role: "" },
  ],
  actionItems: [
    { title: "Ship it", assigneeId: "u-2", dueDate: "2026-11-20T00:00:00Z", done: true },
    { title: "Follow up", done: false },
  ],
};

function bodyOf(call: unknown[]): Record<string, unknown> {
  return JSON.parse((call[1] as { body: string }).body);
}

function renderEditor(overrides: Partial<typeof initial> = {}) {
  const utils = render(
    <MinutesEditor wid="ws-1" mid="m-1" initial={{ ...initial, ...overrides }} />,
  );
  return utils;
}

function defaultApi() {
  mocks.api.mockImplementation(async () => ({}));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mocks.push.mockClear();
  mocks.toast.mockClear();
});

describe("MinutesEditor", () => {
  it("渲染初值：标题、内容、参会人、行动项", () => {
    defaultApi();
    renderEditor();

    expect(screen.getByLabelText("minutes:title")).toHaveValue("Weekly sync");
    expect(screen.getByLabelText("minutes:content")).toHaveValue("# Agenda\nbody");
    expect(screen.getByLabelText("minutes:attendeeName 1")).toHaveValue("Alice");
    expect(screen.getByLabelText("minutes:attendeeRole 1")).toHaveValue("host");
    expect(screen.getByLabelText("minutes:actionTitle 1")).toHaveValue("Ship it");
    expect(screen.getByLabelText("minutes:actionAssignee 1")).toHaveValue("u-2");
    expect(screen.getByLabelText("minutes:actionDueDate 1")).toHaveValue("2026-11-20");
    // 完成态切换按钮的 aria-label 不带序号（同名多枚，按顺序取）
    const doneToggles = screen.getAllByLabelText("minutes:actionDone");
    expect(doneToggles[0]).toHaveAttribute("aria-pressed", "true");
    expect(doneToggles[1]).toHaveAttribute("aria-pressed", "false");
  });

  it("标题为空时保存禁用", () => {
    defaultApi();
    renderEditor();
    expect(screen.getByRole("button", { name: "minutes:save" })).toBeEnabled();

    fireEvent.change(screen.getByLabelText("minutes:title"), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "minutes:save" })).toBeDisabled();
  });

  it("保存：PATCH 过滤空姓名/空标题并 trim，成功后跳详情", async () => {
    defaultApi();
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "minutes:addAttendee" }));
    fireEvent.change(screen.getByLabelText("minutes:attendeeName 3"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "minutes:addAction" }));
    fireEvent.change(screen.getByLabelText("minutes:actionTitle 3"), { target: { value: "  " } });

    fireEvent.change(screen.getByLabelText("minutes:title"), {
      target: { value: "  Weekly sync v2  " },
    });
    fireEvent.change(screen.getByLabelText("minutes:attendeeRole 1"), {
      target: { value: "  chair  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "minutes:save" }));

    await waitFor(() => expect(mocks.push).toHaveBeenCalledTimes(1));
    expect(mocks.push).toHaveBeenCalledWith("/w/ws-1/meeting-minutes/m-1");

    const patch = mocks.api.mock.calls.find(([, o]) => o?.method === "PATCH");
    expect(patch?.[0]).toBe(PATCH_PATH);
    expect(bodyOf(patch ?? [])).toEqual({
      title: "Weekly sync v2",
      content: "# Agenda\nbody",
      attendees: [{ name: "Alice", role: "chair" }, { name: "Bob" }],
      actionItems: [
        { title: "Ship it", assigneeId: "u-2", dueDate: "2026-11-20T00:00:00Z", done: true },
        { title: "Follow up", done: false },
      ],
    });
  });

  it("参会人与行动项的增删", () => {
    defaultApi();
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "minutes:addAttendee" }));
    expect(screen.getAllByLabelText("minutes:delete")).toHaveLength(5);
    fireEvent.click(screen.getAllByLabelText("minutes:delete")[2]);
    expect(screen.queryByLabelText("minutes:attendeeName 3")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "minutes:addAction" }));
    expect(screen.queryByLabelText("minutes:actionTitle 3")).toBeInTheDocument();
    fireEvent.click(screen.getAllByLabelText("minutes:delete")[4]);
    expect(screen.queryByLabelText("minutes:actionTitle 3")).not.toBeInTheDocument();
  });

  it("行动项勾选翻转与截止日期写入 ISO", () => {
    defaultApi();
    renderEditor();

    fireEvent.click(screen.getAllByLabelText("minutes:actionDone")[1]);
    expect(screen.getAllByLabelText("minutes:actionDone")[1]).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    const due = screen.getByLabelText("minutes:actionDueDate 2");
    fireEvent.change(due, { target: { value: "2026-12-01" } });
    expect(due).toHaveValue("2026-12-01");
  });

  it("空参会人/空行动项时显示空态并可添加", () => {
    defaultApi();
    renderEditor({ attendees: [], actionItems: [] });

    expect(screen.getByText("minutes:noAttendees")).toBeInTheDocument();
    expect(screen.getByText("minutes:noActions")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "minutes:addAttendee" }));
    expect(screen.getByLabelText("minutes:attendeeName 1")).toHaveValue("");
  });

  it("预览切换：显示原文或空占位，再切回编辑态", () => {
    defaultApi();
    const { container } = renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "minutes:preview" }));
    expect(screen.queryByLabelText("minutes:content")).not.toBeInTheDocument();
    expect(container.querySelector("div.whitespace-pre-wrap")?.textContent).toContain("# Agenda");

    fireEvent.click(screen.getByRole("button", { name: "minutes:edit" }));
    expect(screen.getByLabelText("minutes:content")).toBeInTheDocument();
  });

  it("预览空内容显示占位文案", () => {
    defaultApi();
    renderEditor({ content: "" });
    fireEvent.click(screen.getByRole("button", { name: "minutes:preview" }));
    expect(screen.getByText("minutes:contentEmpty")).toBeInTheDocument();
  });

  it("保存失败：ApiError 原文并留在编辑页", async () => {
    mocks.api.mockImplementation(async () => {
      throw new mocks.ApiErrorClass("save-boom");
    });
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "minutes:save" }));

    await waitFor(() => expect(screen.getByText("save-boom")).toBeInTheDocument());
    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "minutes:save" })).toBeEnabled();
  });

  it("保存失败：非 ApiError 回退 saveFailed", async () => {
    mocks.api.mockImplementation(async () => {
      throw { weird: true };
    });
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "minutes:save" }));
    await waitFor(() => expect(screen.getByText("minutes:saveFailed")).toBeInTheDocument());
  });

  it("AI 面板：展开、空转写禁用生成、取消关闭", () => {
    defaultApi();
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: AI_BTN }));
    const generate = screen.getByRole("button", { name: "生成" });
    expect(generate).toBeDisabled();
    expect(screen.getByText("请先输入转写文本")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(AI_TRANSCRIPT), { target: { value: "Alice: hi" } });
    expect(generate).toBeEnabled();

    // 面板里的 X（aria-label=取消）与底栏取消按钮同名，取底栏那个
    const cancelButtons = screen.getAllByRole("button", { name: "取消" });
    fireEvent.click(cancelButtons[cancelButtons.length - 1]);
    expect(screen.queryByLabelText(AI_TRANSCRIPT)).not.toBeInTheDocument();
  });

  it("AI 生成成功：POST 载荷、摘要合并进表单并提示", async () => {
    mocks.api.mockImplementation(async (path: string) => {
      if (path === "/api/v1/ai/meeting-summary") {
        return {
          title: "AI 标题",
          keyPoints: ["点1", "点2"],
          decisions: [{ title: "决策A", description: "说明A" }],
          actionItems: [
            { title: "AI 待办", assignee: "u-9", dueDate: "2026-12-31", priority: "high" },
            { title: "无日期待办", assignee: null, dueDate: null, priority: "low" },
          ],
          participants: ["Alice", "  Carol  "],
        };
      }
      return {};
    });
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: AI_BTN }));
    fireEvent.change(screen.getByLabelText(AI_TRANSCRIPT), {
      target: { value: "  Alice: hi  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成" }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("success", "已应用 AI 摘要"));

    const post = mocks.api.mock.calls.find(
      ([p, o]) => p === "/api/v1/ai/meeting-summary" && o?.method === "POST",
    );
    expect(bodyOf(post ?? [])).toEqual({
      wid: "ws-1",
      transcript: "Alice: hi",
      meetingTitle: "Weekly sync",
    });

    // 标题被覆盖；内容按 keyPoints + decisions 拼接
    expect(screen.getByLabelText("minutes:title")).toHaveValue("AI 标题");
    const content = screen.getByLabelText("minutes:content") as HTMLTextAreaElement;
    expect(content.value).toBe("## 关键讨论点\n- 点1\n- 点2\n\n## 决策项\n### 决策A\n说明A\n");
    // 参会人：Alice 已存在不重复，Carol 追加并 trim
    expect(screen.getByLabelText("minutes:attendeeName 3")).toHaveValue("Carol");
    expect(screen.queryByLabelText("minutes:attendeeName 4")).not.toBeInTheDocument();
    // 行动项：追加两条，日期转 ISO，空日期不写
    expect(screen.getByLabelText("minutes:actionTitle 3")).toHaveValue("AI 待办");
    expect(screen.getByLabelText("minutes:actionAssignee 3")).toHaveValue("u-9");
    expect(screen.getByLabelText("minutes:actionDueDate 3")).toHaveValue("2026-12-31");
    expect(screen.getByLabelText("minutes:actionTitle 4")).toHaveValue("无日期待办");
    expect(screen.getByLabelText("minutes:actionDueDate 4")).toHaveValue("");
    // 面板收起、转写清空
    expect(screen.queryByLabelText(AI_TRANSCRIPT)).not.toBeInTheDocument();
  });

  it("AI 503：禁用入口并提示未配置", async () => {
    mocks.api.mockImplementation(async (path: string) => {
      if (path === "/api/v1/ai/meeting-summary") {
        throw new mocks.ApiErrorClass("ai off", 503, 503);
      }
      return {};
    });
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: AI_BTN }));
    fireEvent.change(screen.getByLabelText(AI_TRANSCRIPT), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "生成" }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("error", "AI 未配置"));
    expect(screen.getByRole("button", { name: AI_BTN })).toBeDisabled();
    expect(screen.queryByLabelText(AI_TRANSCRIPT)).not.toBeInTheDocument();
  });

  it("AI 其他失败：ApiError 原文与非 ApiError 回退文案", async () => {
    mocks.api.mockImplementation(async (path: string) => {
      if (path === "/api/v1/ai/meeting-summary") throw new mocks.ApiErrorClass("ai-boom", 500, 500);
      return {};
    });
    const first = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: AI_BTN }));
    fireEvent.change(screen.getByLabelText(AI_TRANSCRIPT), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "生成" }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("error", "ai-boom"));
    first.unmount();

    mocks.toast.mockClear();
    mocks.api.mockImplementation(async (path: string) => {
      if (path === "/api/v1/ai/meeting-summary") throw { weird: true };
      return {};
    });
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: AI_BTN }));
    fireEvent.change(screen.getByLabelText(AI_TRANSCRIPT), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "生成" }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("error", "生成失败，请重试"));
    // 面板保持打开、按钮恢复可用
    expect(screen.getByLabelText(AI_TRANSCRIPT)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "生成" })).toBeEnabled();
  });
});
