// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * 会议提取物组件契约（components/ai/MeetingDecisions.tsx +
 * MeetingActionItems.tsx）：
 *
 * MeetingDecisions：
 *  1. GET /api/v1/ai/meetings/sessions/{sid}/decisions?wid=<url 编码>
 *  2. 加载中 → Loader2 + t("loading")；失败 → AlertCircle + t("loadFailed")；
 *     空列表 → Gavel + t("noDecisions")
 *  3. proposed → 显示 confirm/reject 两个按钮；confirmed/rejected 只显示状态图标
 *     （li 边框类随之切换：confirmed→border-success、rejected→opacity-40）
 *  4. 确认/拒绝走 PATCH 同一 URL，请求体 {wid, decisionId, status}；
 *     成功后本地切换状态（乐观更新）；更新中两个按钮都 disabled 且确认按钮换 Loader2
 *  5. PATCH 失败 → 整面换成 t("error") 提示（错误分支在列表之前 return）
 *  6. 参与者只保留字符串成员再 join ", "；非数组不渲染该行
 *
 * MeetingActionItems：
 *  7. GET 同一前缀的 /actions 端点；loading/error/empty 三态同款
 *  8. 完成按钮只有 pending 可点（completed/skipped 均 disabled），图标三态
 *     （pending→Square / completed→CheckSquare / 更新中→Loader2）
 *  9. skip 按钮仅 pending 渲染；completed → line-through + opacity-60，
 *     skipped → opacity-40
 *  10. PATCH 请求体 {wid, actionId, status}；元信息行渲染负责人、
 *      toLocaleDateString 截止日、`confidence: Math.round(c*100)%`
 */

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
}));

// 注意：这两个组件把 t 放进了 useCallback/useEffect 依赖，mock 必须按 ns 缓存
// 返回函数，否则每次渲染都是新闭包 → effect 无限重跑、once 队列被抽干
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

import { MeetingDecisions } from "@/components/ai/MeetingDecisions";
import { MeetingActionItems } from "@/components/ai/MeetingActionItems";

const WID = "ws-1";
const SID = "sess-1";

/** 一条 proposed 决策 + 一条 confirmed 决策的常用夹具 */
function decisionsFixture() {
  return [
    {
      id: "d1",
      content: "决定使用 Postgres",
      context: "讨论了存储选型",
      participants: ["Alice", "Bob", 42, null],
      status: "proposed",
      createdAt: "2026-10-01T00:00:00Z",
    },
    {
      id: "d2",
      content: "已确认的事项",
      context: null,
      participants: "not-an-array",
      status: "confirmed",
      createdAt: "2026-10-01T00:00:00Z",
    },
  ];
}

/** 一条 pending + 一条 completed + 一条 skipped 的行动项夹具 */
function actionsFixture() {
  return [
    {
      id: "a1",
      content: "写技术方案",
      assigneeId: "alice",
      dueDate: "2026-10-05",
      status: "pending",
      extractedBy: "gpt",
      confidence: 0.876,
      createdAt: "2026-10-01T00:00:00Z",
    },
    {
      id: "a2",
      content: "已完成的需求",
      assigneeId: null,
      dueDate: null,
      status: "completed",
      extractedBy: "gpt",
      confidence: 0.5,
      createdAt: "2026-10-01T00:00:00Z",
    },
    {
      id: "a3",
      content: "被跳过的需求",
      assigneeId: "bob",
      dueDate: null,
      status: "skipped",
      extractedBy: "gpt",
      confidence: 1,
      createdAt: "2026-10-01T00:00:00Z",
    },
  ];
}

beforeEach(() => {
  mocks.api.mockReset();
});

afterEach(() => {
  cleanup();
});

// ───────────────────────── MeetingDecisions ─────────────────────────

describe("MeetingDecisions", () => {
  it("挂载即 GET 决策列表，URL 带 sessionId 与 url 编码的 wid", async () => {
    mocks.api.mockResolvedValueOnce([]);
    render(<MeetingDecisions wid="ws 1" sessionId={SID} />);
    await waitFor(() => expect(screen.getByText("ai.aiMeeting:noDecisions")).toBeTruthy());
    expect(mocks.api).toHaveBeenCalledWith(
      `/api/v1/ai/meetings/sessions/${SID}/decisions?wid=${encodeURIComponent("ws 1")}`,
    );
  });

  it('加载中显示 spinner + t("loading")，此时不发第二次请求', () => {
    mocks.api.mockImplementationOnce(() => new Promise(() => {}));
    const { container } = render(<MeetingDecisions wid={WID} sessionId={SID} />);
    expect(container.querySelector(".lucide-loader-2")).toBeTruthy();
    expect(screen.getByText("ai.aiMeeting:loading")).toBeTruthy();
    expect(mocks.api).toHaveBeenCalledTimes(1);
  });

  it('GET 失败 → AlertCircle + t("loadFailed")，列表不渲染', async () => {
    mocks.api.mockRejectedValueOnce(new Error("boom"));
    const { container } = render(<MeetingDecisions wid={WID} sessionId={SID} />);
    await waitFor(() => expect(screen.getByText("ai.aiMeeting:loadFailed")).toBeTruthy());
    expect(container.querySelector(".lucide-alert-circle")).toBeTruthy();
    expect(screen.queryByText("决定使用 Postgres")).toBeNull();
  });

  it('空列表 → Gavel + t("noDecisions")', async () => {
    mocks.api.mockResolvedValueOnce([]);
    const { container } = render(<MeetingDecisions wid={WID} sessionId={SID} />);
    await waitFor(() => expect(screen.getByText("ai.aiMeeting:noDecisions")).toBeTruthy());
    expect(container.querySelector(".lucide-gavel")).toBeTruthy();
  });

  it('列表渲染：内容/上下文；参与者只留字符串成员 join", "；非数组不渲染', async () => {
    mocks.api.mockResolvedValueOnce(decisionsFixture());
    const { container } = render(<MeetingDecisions wid={WID} sessionId={SID} />);
    await waitFor(() => expect(screen.getByText("决定使用 Postgres")).toBeTruthy());
    expect(screen.getByText("讨论了存储选型")).toBeTruthy();
    // participants:["Alice","Bob",42,null] → "Alice, Bob"
    expect(screen.getByText("Alice, Bob")).toBeTruthy();
    expect(container.querySelector(".lucide-users")).toBeTruthy();
    // d2:participants 是字符串（非数组）→ 不渲染参与者行
    expect(screen.queryByText("not-an-array")).toBeNull();
  });

  it("proposed → 渲染 confirm/reject 按钮，confirmed 只渲染状态图标", async () => {
    mocks.api.mockResolvedValueOnce(decisionsFixture());
    const { container } = render(<MeetingDecisions wid={WID} sessionId={SID} />);
    await waitFor(() => expect(screen.getByText("ai.aiMeeting:confirm")).toBeTruthy());
    expect(screen.getByText("ai.aiMeeting:reject")).toBeTruthy();
    // d1(proposed)→Circle，d2(confirmed)→CheckCircle2
    expect(container.querySelectorAll(".lucide-circle").length).toBeGreaterThanOrEqual(1);
    expect(container.querySelector(".lucide-check-circle-2")).toBeTruthy();
    // d2 已确认 → 没有操作按钮（页面里只有 d1 那对）
    expect(screen.getAllByText("ai.aiMeeting:confirm").length).toBe(1);
  });

  it("状态边框：rejected → opacity-40，confirmed → border-success", async () => {
    mocks.api.mockResolvedValueOnce([
      {
        id: "d1",
        content: "c1",
        context: null,
        participants: [],
        status: "rejected",
        createdAt: "",
      },
      {
        id: "d2",
        content: "c2",
        context: null,
        participants: [],
        status: "confirmed",
        createdAt: "",
      },
    ]);
    const { container } = render(<MeetingDecisions wid={WID} sessionId={SID} />);
    await waitFor(() => expect(screen.getByText("c1")).toBeTruthy());
    const items = container.querySelectorAll("li");
    expect(items[0].className).toContain("opacity-40");
    expect(items[1].className).toContain("border-[var(--success)]");
    expect(container.querySelector(".lucide-x-circle")).toBeTruthy();
  });

  it("点确认 → PATCH {wid,decisionId,status:confirmed}，成功后本地切到 confirmed", async () => {
    mocks.api.mockResolvedValueOnce(decisionsFixture());
    mocks.api.mockResolvedValueOnce(undefined);
    const { container } = render(<MeetingDecisions wid={WID} sessionId={SID} />);
    await waitFor(() => expect(screen.getByText("ai.aiMeeting:confirm")).toBeTruthy());
    fireEvent.click(screen.getByText("ai.aiMeeting:confirm"));
    expect(mocks.api).toHaveBeenLastCalledWith(`/api/v1/ai/meetings/sessions/${SID}/decisions`, {
      method: "PATCH",
      body: JSON.stringify({ wid: WID, decisionId: "d1", status: "confirmed" }),
    });
    await waitFor(() => expect(screen.queryByText("ai.aiMeeting:confirm")).toBeNull());
    // 操作按钮消失 = 已非 proposed
    expect(container.querySelectorAll(".lucide-circle").length).toBe(0);
    expect(container.querySelectorAll(".lucide-check-circle-2").length).toBe(2);
  });

  it("更新中：两个按钮都 disabled，确认按钮内容换 Loader2", async () => {
    mocks.api.mockResolvedValueOnce(decisionsFixture());
    let resolvePatch: (v: unknown) => void = () => {};
    mocks.api.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolvePatch = r;
        }),
    );
    const { container } = render(<MeetingDecisions wid={WID} sessionId={SID} />);
    await waitFor(() => expect(screen.getByText("ai.aiMeeting:confirm")).toBeTruthy());
    fireEvent.click(screen.getByText("ai.aiMeeting:confirm"));
    await waitFor(() => expect(container.querySelectorAll(".lucide-loader-2").length).toBe(1));
    const buttons = screen.getAllByRole("button");
    expect(buttons.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    resolvePatch(undefined);
    await waitFor(() => expect(screen.queryByText("ai.aiMeeting:confirm")).toBeNull());
  });

  it('PATCH 失败 → 整面换成 t("error")，列表消失', async () => {
    mocks.api.mockResolvedValueOnce(decisionsFixture());
    mocks.api.mockRejectedValueOnce(new Error("boom"));
    render(<MeetingDecisions wid={WID} sessionId={SID} />);
    await waitFor(() => expect(screen.getByText("ai.aiMeeting:confirm")).toBeTruthy());
    fireEvent.click(screen.getByText("ai.aiMeeting:confirm"));
    await waitFor(() => expect(screen.getByText("ai.aiMeeting:error")).toBeTruthy());
    expect(screen.queryByText("决定使用 Postgres")).toBeNull();
  });
});

// ───────────────────────── MeetingActionItems ─────────────────────────

describe("MeetingActionItems", () => {
  it("挂载即 GET 行动项，URL 前缀为 /actions", async () => {
    mocks.api.mockResolvedValueOnce([]);
    render(<MeetingActionItems wid={WID} sessionId={SID} />);
    await waitFor(() => expect(screen.getByText("ai.aiMeeting:noActions")).toBeTruthy());
    expect(mocks.api).toHaveBeenCalledWith(
      `/api/v1/ai/meetings/sessions/${SID}/actions?wid=${encodeURIComponent(WID)}`,
    );
  });

  it("加载中/失败/空 三态：spinner+loading、AlertCircle+loadFailed、ListChecks+noActions", async () => {
    mocks.api.mockImplementationOnce(() => new Promise(() => {}));
    const { container, rerender } = render(<MeetingActionItems wid={WID} sessionId={SID} />);
    expect(container.querySelector(".lucide-loader-2")).toBeTruthy();
    expect(screen.getByText("ai.aiMeeting:loading")).toBeTruthy();

    mocks.api.mockReset();
    mocks.api.mockRejectedValueOnce(new Error("boom"));
    rerender(<MeetingActionItems wid={WID} sessionId="sess-2" />);
    await waitFor(() => expect(screen.getByText("ai.aiMeeting:loadFailed")).toBeTruthy());
    expect(container.querySelector(".lucide-alert-circle")).toBeTruthy();

    mocks.api.mockReset();
    mocks.api.mockResolvedValueOnce([]);
    rerender(<MeetingActionItems wid={WID} sessionId="sess-3" />);
    await waitFor(() => expect(screen.getByText("ai.aiMeeting:noActions")).toBeTruthy());
    expect(container.querySelector(".lucide-list-checks")).toBeTruthy();
  });

  it("元信息行：assignee、toLocaleDateString 截止日、confidence 百分比", async () => {
    mocks.api.mockResolvedValueOnce(actionsFixture());
    render(<MeetingActionItems wid={WID} sessionId={SID} />);
    await waitFor(() => expect(screen.getByText("写技术方案")).toBeTruthy());
    expect(screen.getByText("alice")).toBeTruthy();
    expect(screen.getByText(new Date("2026-10-05").toLocaleDateString())).toBeTruthy();
    // 0.876 → Math.round(87.6) = 88
    const confidences = screen.getAllByText(/confidence/);
    expect(confidences.length).toBe(3);
    expect(confidences[0].textContent).toContain("88%");
    expect(confidences[0].textContent).toContain("ai.aiMeeting:confidence");
    // a2 无 assignee/dueDate → 不渲染
    expect(screen.queryByText("已完成的需求")).toBeTruthy();
    expect(screen.getAllByText(/confidence/).length).toBe(3);
  });

  it("完成按钮仅 pending 可点；completed/skipped 禁用且无 skip 按钮", async () => {
    mocks.api.mockResolvedValueOnce(actionsFixture());
    const { container } = render(<MeetingActionItems wid={WID} sessionId={SID} />);
    await waitFor(() => expect(screen.getByText("写技术方案")).toBeTruthy());
    const buttons = container.querySelectorAll<HTMLButtonElement>("button[title]");
    // 三条行动项各有一个 title 按钮（markComplete），skip 按钮只有 pending 有一条
    const completeButtons = Array.from(buttons).filter(
      (b) => b.title === "ai.aiMeeting:markComplete",
    );
    expect(completeButtons.length).toBe(3);
    expect(completeButtons[0].disabled).toBe(false);
    expect(completeButtons[1].disabled).toBe(true);
    expect(completeButtons[2].disabled).toBe(true);
    expect(screen.getAllByText("ai.aiMeeting:skip").length).toBe(1);
    // 图标三态：pending→Square / completed→CheckSquare / skipped→Square（无 pending 语义）
    expect(container.querySelector(".lucide-check-square")).toBeTruthy();
    expect(container.querySelectorAll(".lucide-square").length).toBe(2);
    expect(container.querySelector(".lucide-skip-forward")).toBeTruthy();
  });

  it("完成态排版：completed → line-through + opacity-60；skipped → opacity-40", async () => {
    mocks.api.mockResolvedValueOnce(actionsFixture());
    const { container } = render(<MeetingActionItems wid={WID} sessionId={SID} />);
    await waitFor(() => expect(screen.getByText("写技术方案")).toBeTruthy());
    const items = container.querySelectorAll("li");
    expect(items[0].className).not.toContain("opacity");
    expect(items[1].className).toContain("opacity-60");
    expect(items[2].className).toContain("opacity-40");
    const contents = container.querySelectorAll("p");
    expect(contents[1].className).toContain("line-through");
    expect(contents[0].className).not.toContain("line-through");
  });

  it("点完成 → PATCH {wid,actionId,status:completed}，成功后切 completed 且按钮禁用", async () => {
    mocks.api.mockResolvedValueOnce(actionsFixture());
    mocks.api.mockResolvedValueOnce(undefined);
    const { container } = render(<MeetingActionItems wid={WID} sessionId={SID} />);
    await waitFor(() => expect(screen.getByText("写技术方案")).toBeTruthy());
    const completeBtn = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button[title]"),
    ).find((b) => b.title === "ai.aiMeeting:markComplete" && !b.disabled)!;
    fireEvent.click(completeBtn);
    expect(mocks.api).toHaveBeenLastCalledWith(`/api/v1/ai/meetings/sessions/${SID}/actions`, {
      method: "PATCH",
      body: JSON.stringify({ wid: WID, actionId: "a1", status: "completed" }),
    });
    await waitFor(() => expect(container.querySelectorAll(".lucide-check-square").length).toBe(2));
    // skip 按钮随状态消失
    expect(screen.queryByText("ai.aiMeeting:skip")).toBeNull();
    // 内容加删除线
    expect(container.querySelector("p.line-through")).toBeTruthy();
  });

  it("点 skip → PATCH status:skipped，成功后 opacity-40", async () => {
    mocks.api.mockResolvedValueOnce(actionsFixture());
    mocks.api.mockResolvedValueOnce(undefined);
    const { container } = render(<MeetingActionItems wid={WID} sessionId={SID} />);
    await waitFor(() => expect(screen.getByText("写技术方案")).toBeTruthy());
    fireEvent.click(screen.getByText("ai.aiMeeting:skip"));
    expect(mocks.api).toHaveBeenLastCalledWith(`/api/v1/ai/meetings/sessions/${SID}/actions`, {
      method: "PATCH",
      body: JSON.stringify({ wid: WID, actionId: "a1", status: "skipped" }),
    });
    await waitFor(() =>
      expect(container.querySelectorAll("li")[0].className).toContain("opacity-40"),
    );
  });

  it("更新中：完成按钮内换 Loader2，skip 按钮 disabled", async () => {
    mocks.api.mockResolvedValueOnce(actionsFixture());
    let resolvePatch: (v: unknown) => void = () => {};
    mocks.api.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolvePatch = r;
        }),
    );
    const { container } = render(<MeetingActionItems wid={WID} sessionId={SID} />);
    await waitFor(() => expect(screen.getByText("写技术方案")).toBeTruthy());
    fireEvent.click(screen.getByText("ai.aiMeeting:skip"));
    await waitFor(() => expect(container.querySelectorAll(".lucide-loader-2").length).toBe(1));
    const skipBtn = screen.getByText("ai.aiMeeting:skip").closest("button")!;
    expect(skipBtn.disabled).toBe(true);
    resolvePatch(undefined);
    await waitFor(() => expect(screen.queryByText("ai.aiMeeting:skip")).toBeNull());
  });

  it('PATCH 失败 → 整面换成 t("error")', async () => {
    mocks.api.mockResolvedValueOnce(actionsFixture());
    mocks.api.mockRejectedValueOnce(new Error("boom"));
    render(<MeetingActionItems wid={WID} sessionId={SID} />);
    await waitFor(() => expect(screen.getByText("写技术方案")).toBeTruthy());
    fireEvent.click(screen.getByText("ai.aiMeeting:skip"));
    await waitFor(() => expect(screen.getByText("ai.aiMeeting:error")).toBeTruthy());
    expect(screen.queryByText("写技术方案")).toBeNull();
  });
});
