// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";

/**
 * MultiAgentPanel 契约（components/ai/MultiAgentPanel.tsx）：
 *  1. GET /api/v1/ai/agents?wid=<encoded> 加载列表，默认选中第一个；失败 → loadFailed
 *  2. 创建表单：name/role select/capabilities 多选 chips/systemPrompt/model select/enabled switch
 *     name 或 systemPrompt 为空 → 保存 disabled
 *  3. 创建 POST /api/v1/ai/agents（body 全字段）→ toast success create + 列表新增；
 *     编辑 PATCH /api/v1/ai/agents/{id}?wid= → toast success edit
 *  4. 删除走 window.confirm（确认才 DELETE）；取消编辑恢复表单原值
 *  5. 协调任务 POST /api/v1/ai/agents/coordinate {wid, task} → assignments/responses 渲染；
 *     空 assignments → toast warning noAgents；输入为空 → 执行 disabled
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

import MultiAgentPanel from "@/components/ai/MultiAgentPanel";

const WID = "ws-ma-1";

function agentFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "ag-1",
    name: "拆解员",
    role: "task_breaker",
    capabilities: ["task_breakdown", "analysis"],
    systemPrompt: "你是任务拆解专家",
    model: "deepseek-chat",
    enabled: true,
    metadata: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** 详情区的编辑按钮（无图标、可访问名 = t("edit")） */
function detailEditButton() {
  const btns = screen.getAllByRole("button", { name: "ai.aiAgent:edit" });
  const noIcon = btns.find((b) => !b.querySelector("svg"));
  expect(noIcon).toBeTruthy();
  return noIcon!;
}

/** 表单里的保存按钮（Save 图标；创建态可访问名 t("create")，编辑态 t("edit")） */
function saveButton() {
  const bySaveIcon = [...screen.getAllByRole("button")].find((b) =>
    b.querySelector("svg.lucide-save"),
  );
  expect(bySaveIcon).toBeTruthy();
  return bySaveIcon!;
}

async function loadedOne() {
  mocks.api.mockResolvedValueOnce([agentFixture()]);
  render(<MultiAgentPanel wid={WID} />);
  // 名字同时出现在列表项与详情 h3，断言取复数
  await waitFor(() => expect(screen.getAllByText("拆解员").length).toBeGreaterThan(0));
  // 关键：等「选中 Agent → 表单」同步 effect 跑完再返回。
  // 不 flush 的话，那个 effect 可能在测试点了「创建」之后才落地，
  // 把 startCreate() 清空的表单重新填回 Agent 数据（capabilities 尤其明显），
  // 于是「点 chip 切换」会变成「取消已选中项」，断言随渲染时机翻转 —— 本文件
  // 历史上两次 flaky（保存按钮 disabled / capabilities 数组）都是同一个竞态。
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  mocks.api.mockReset();
  mocks.toast.mockReset();
});
afterEach(() => cleanup());

describe("MultiAgentPanel", () => {
  it("空态：noAgents 文案 + 空态创建按钮可用", async () => {
    mocks.api.mockResolvedValueOnce([]);
    render(<MultiAgentPanel wid={WID} />);

    await waitFor(() =>
      expect(screen.getAllByText("ai.aiAgent:noAgents").length).toBeGreaterThan(0),
    );
    expect(screen.getAllByRole("button", { name: "ai.aiAgent:create" }).length).toBeGreaterThan(0);
  });

  it("加载失败 → loadFailed 错误条", async () => {
    mocks.api.mockRejectedValueOnce(new Error("boom"));
    render(<MultiAgentPanel wid={WID} />);

    await waitFor(() => expect(screen.getByText("ai.aiAgent:loadFailed")).toBeInTheDocument());
  });

  it("加载后默认选中第一条：详情显示 name/role i18n 标签/model/systemPrompt/capabilities", async () => {
    await loadedOne();

    expect(screen.getByText("ai.aiAgent:roleTaskBreaker")).toBeInTheDocument();
    expect(screen.getByText("deepseek-chat")).toBeInTheDocument();
    expect(screen.getByText("你是任务拆解专家")).toBeInTheDocument();
    expect(screen.getByText("task_breakdown")).toBeInTheDocument();
    expect(screen.getByText("analysis")).toBeInTheDocument();
    expect(screen.getAllByText("ai.aiAgent:enabled").length).toBeGreaterThan(0);
  });

  it("创建表单：点创建进入编辑态，字段可填，switch 可切换", async () => {
    await loadedOne();
    fireEvent.click(screen.getByRole("button", { name: "ai.aiAgent:create" }));

    const name = screen.getByLabelText("ai.aiAgent:name") as HTMLInputElement;
    const role = screen.getByLabelText("ai.aiAgent:role") as HTMLSelectElement;
    const prompt = screen.getByLabelText("ai.aiAgent:systemPrompt") as HTMLTextAreaElement;
    const model = screen.getByLabelText("ai.aiAgent:model") as HTMLSelectElement;
    expect(name.value).toBe("");
    expect(role.value).toBe("task_breaker");
    expect(prompt.value).toBe("");
    expect(model.value).toBe("deepseek-chat");
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");

    fireEvent.change(name, { target: { value: "新助手" } });
    fireEvent.change(prompt, { target: { value: "新的提示词" } });
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });

  it("capabilities chip 点击切换选中，保存 body 带上勾选数组", async () => {
    await loadedOne();
    fireEvent.click(screen.getByRole("button", { name: "ai.aiAgent:create" }));
    fireEvent.change(screen.getByLabelText("ai.aiAgent:name"), { target: { value: "新助手" } });
    fireEvent.change(screen.getByLabelText("ai.aiAgent:systemPrompt"), {
      target: { value: "提示词" },
    });
    fireEvent.click(screen.getByRole("button", { name: "task_breakdown" }));
    // POST 响应必须给完整 Agent——组件会把创建结果追加进列表并渲染
    mocks.api.mockResolvedValueOnce(agentFixture({ id: "ag-2", name: "新助手" }));
    fireEvent.click(saveButton());

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2)); // 1 GET + 1 POST
    expect(mocks.api).toHaveBeenLastCalledWith("/api/v1/ai/agents", {
      method: "POST",
      body: JSON.stringify({
        wid: WID,
        name: "新助手",
        role: "task_breaker",
        capabilities: ["task_breakdown"],
        systemPrompt: "提示词",
        model: "deepseek-chat",
        enabled: true,
      }),
    });
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("success", "ai.aiAgent:create"));
  });

  it("name 或 systemPrompt 为空时保存按钮 disabled", async () => {
    await loadedOne();
    fireEvent.click(screen.getByRole("button", { name: "ai.aiAgent:create" }));
    fireEvent.change(screen.getByLabelText("ai.aiAgent:name"), { target: { value: "只有名字" } });
    expect(saveButton()).toBeDisabled();

    fireEvent.change(screen.getByLabelText("ai.aiAgent:name"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("ai.aiAgent:systemPrompt"), {
      target: { value: "只有提示词" },
    });
    expect(saveButton()).toBeDisabled();
  });

  it("编辑：表单回填当前值；PATCH /api/v1/ai/agents/{id}?wid= → toast success edit", async () => {
    await loadedOne();
    fireEvent.click(detailEditButton());

    expect((screen.getByLabelText("ai.aiAgent:name") as HTMLInputElement).value).toBe("拆解员");
    expect((screen.getByLabelText("ai.aiAgent:systemPrompt") as HTMLTextAreaElement).value).toBe(
      "你是任务拆解专家",
    );
    fireEvent.change(screen.getByLabelText("ai.aiAgent:name"), { target: { value: "改名后" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    expect(mocks.api).toHaveBeenLastCalledWith(`/api/v1/ai/agents/ag-1?wid=${WID}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: "改名后",
        role: "task_breaker",
        capabilities: ["task_breakdown", "analysis"],
        systemPrompt: "你是任务拆解专家",
        model: "deepseek-chat",
        enabled: true,
      }),
    });
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("success", "ai.aiAgent:edit"));
  });

  it("取消编辑恢复表单原值", async () => {
    await loadedOne();
    fireEvent.click(detailEditButton());
    fireEvent.change(screen.getByLabelText("ai.aiAgent:name"), { target: { value: "临时名" } });
    fireEvent.click(screen.getByRole("button", { name: "ai.aiAgent:cancel" }));

    fireEvent.click(detailEditButton());
    expect((screen.getByLabelText("ai.aiAgent:name") as HTMLInputElement).value).toBe("拆解员");
  });

  it("删除：window.confirm 确认才 DELETE 并移出列表；拒绝则不调 DELETE", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    await loadedOne();
    fireEvent.click(detailEditButton());
    // 表单操作区的删除按钮（Trash2 图标、可访问名同为 t("edit")）
    const deleteBtn = [...screen.getAllByRole("button", { name: "ai.aiAgent:edit" })].find((b) =>
      b.querySelector("svg.lucide-trash-2"),
    )!;

    // 拒绝分支：confirm 返回 false，不发生 DELETE
    fireEvent.click(deleteBtn);
    expect(confirmSpy).toHaveBeenCalledWith('ai.aiAgent:confirmDelete:{"name":"拆解员"}');
    expect(mocks.api).toHaveBeenCalledTimes(1); // 仅初始 GET

    // 确认分支：DELETE + toast，列表移除后回到空态
    confirmSpy.mockReturnValue(true);
    fireEvent.click(deleteBtn);
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    expect(mocks.api).toHaveBeenLastCalledWith(`/api/v1/ai/agents/ag-1?wid=${WID}`, {
      method: "DELETE",
    });
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("success", "ai.aiAgent:edit"));
  });

  it("协调任务：POST /api/v1/ai/agents/coordinate {wid, task} → assignments+responses 渲染 + toast", async () => {
    await loadedOne();
    mocks.api.mockResolvedValueOnce({
      assignments: [
        {
          agentName: "拆解员",
          subtask: "拆解需求文档",
          reason: "与任务拆解能力匹配",
        },
      ],
      responses: [
        {
          agentId: "ag-1",
          agentName: "拆解员",
          response: "已拆解为 3 个子任务",
          handoff: "写作员",
        },
      ],
      messageIds: ["m-1"],
    });
    fireEvent.change(screen.getByLabelText("ai.aiAgent:task"), { target: { value: "拆解需求" } });
    fireEvent.click(screen.getByRole("button", { name: "ai.aiAgent:coordinate" }));

    await waitFor(() =>
      expect(mocks.api).toHaveBeenLastCalledWith("/api/v1/ai/agents/coordinate", {
        method: "POST",
        body: JSON.stringify({ wid: WID, task: "拆解需求" }),
      }),
    );
    expect(screen.getAllByText("拆解员").length).toBeGreaterThan(0);
    expect(screen.getByText("拆解需求文档")).toBeInTheDocument();
    expect(screen.getByText("与任务拆解能力匹配")).toBeInTheDocument();
    expect(screen.getByText("已拆解为 3 个子任务")).toBeInTheDocument();
    expect(screen.getByText(/ai\.aiAgent:handoff/)).toBeInTheDocument();
    expect(mocks.toast).toHaveBeenCalledWith("success", "ai.aiAgent:coordinate");
  });

  it("协调结果 assignments 为空 → toast warning noAgents；输入为空时执行 disabled", async () => {
    await loadedOne();
    mocks.api.mockResolvedValueOnce({ assignments: [], responses: [], messageIds: [] });
    fireEvent.change(screen.getByLabelText("ai.aiAgent:task"), { target: { value: "随便" } });
    fireEvent.click(screen.getByRole("button", { name: "ai.aiAgent:coordinate" }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("warning", "ai.aiAgent:noAgents"));

    fireEvent.change(screen.getByLabelText("ai.aiAgent:task"), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "ai.aiAgent:coordinate" })).toBeDisabled();
  });
});
