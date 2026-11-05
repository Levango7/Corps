// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * ActionItemPanel 契约（components/ActionItemPanel.tsx，named 导出）：
 *  1. initialItems 提供时不发首次请求；未提供时 GET .../decisions/{did}/action-items
 *     （响应兼容数组或 {items}），loading 期骨架 aria-busy
 *  2. 404/not found 错误静默置空（端点可能尚不存在）；其他错误显示 e.message
 *  3. 头部：标题、环形进度（svg aria-label "50%"）+ completed/total 文本、同步按钮
 *  4. 同步：POST .../sync-actions → toast 按 created/updated 组合；
 *     响应带 items 就地替换否则重拉；失败 toast error + 错误条；syncing 中禁用
 *  5. 勾选：乐观翻转 + PATCH .../action-items/{id} body {completed:!}；失败回滚 + toast
 *  6. 行：taskId → 任务链接（aria-label "open task"）；负责人头像；过期日标红
 *  7. 模板（提供 onInsertTemplate 才显示）：下拉列 ACTION_TEMPLATES，
 *     插入时 {dueDate} 替换为今天+7 天（YYYY-MM-DD）；Escape/遮罩关闭菜单
 *  8. refreshSignal>0 变化 → 重拉
 */

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  toast: vi.fn(),
  onInsertTemplate: vi.fn(),
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
vi.mock("@/components/Toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/lib/i18n-navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/decision-action-parser", () => ({
  ACTION_TEMPLATES: [
    {
      id: "tpl-1",
      name: "模板甲",
      description: "三步拆解",
      markdown: "- 行动一 {dueDate}\n- 行动二",
    },
    { id: "tpl-2", name: "模板乙", description: "单条", markdown: "- 唯一行动" },
  ],
}));

import { ActionItemPanel } from "@/components/ActionItemPanel";

const WID = "ws-aip-1";
const TASK = "task-1";
const DID = "dec-1";
const ENDPOINT = `/api/v1/workspaces/${WID}/tasks/${TASK}/decisions/${DID}/action-items`;
const SYNC_ENDPOINT = `/api/v1/workspaces/${WID}/tasks/${TASK}/decisions/${DID}/sync-actions`;

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: "act-1",
    title: "产出评审纪要",
    completed: false,
    assignee: { id: "u-1", name: "Alice", email: "alice@example.com" },
    dueDate: null,
    priority: "high",
    taskId: null,
    ...overrides,
  };
}

function renderPanel(props: Record<string, unknown> = {}) {
  return render(
    <ActionItemPanel decisionId={DID} workspaceId={WID} taskId={TASK} locale="zh" {...props} />,
  );
}

beforeEach(() => {
  mocks.api.mockReset();
  mocks.toast.mockReset();
  mocks.onInsertTemplate.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ActionItemPanel", () => {
  it("提供 initialItems → 不发首次请求，直接渲染行与完成率", () => {
    renderPanel({
      initialItems: [item(), item({ id: "act-2", completed: true, title: "已完成项" })],
    });
    expect(mocks.api).not.toHaveBeenCalled();
    expect(screen.getByText("产出评审纪要")).toBeInTheDocument();
    // 1/2 → 环形 aria-label 50% + 文本 1/2
    expect(screen.getByRole("img", { name: "50%" })).toBeInTheDocument();
    expect(screen.getByText("1/2")).toBeInTheDocument();
  });

  it("无 initialItems → GET 端点（兼容 {items} 形态），loading 骨架先显示", async () => {
    mocks.api.mockResolvedValueOnce({ items: [item()] });
    renderPanel();
    expect(screen.getByLabelText("decision:actionItems")).toHaveAttribute("aria-busy", "true");

    await waitFor(() => expect(screen.getByText("产出评审纪要")).toBeInTheDocument());
    expect(mocks.api).toHaveBeenCalledWith(ENDPOINT);
  });

  it("响应为数组形态也接受", async () => {
    mocks.api.mockResolvedValueOnce([item()]);
    renderPanel();
    await waitFor(() => expect(screen.getByText("产出评审纪要")).toBeInTheDocument());
  });

  it("404/not found 错误 → 静默置空（noActions，无错误条）", async () => {
    mocks.api.mockRejectedValueOnce(new Error("Request failed with status code 404"));
    renderPanel();
    await waitFor(() => expect(screen.getByText("decision:noActions")).toBeInTheDocument());
    expect(screen.queryByText(/404/)).toBeFalsy();
  });

  it("其他错误 → 错误条显示 e.message", async () => {
    mocks.api.mockRejectedValueOnce(new Error("数据库连不上"));
    renderPanel();
    await waitFor(() => expect(screen.getByText("数据库连不上")).toBeInTheDocument());
  });

  it("空列表 → noActions 空态且不渲染环形进度", async () => {
    mocks.api.mockResolvedValueOnce([]);
    renderPanel();
    await waitFor(() => expect(screen.getByText("decision:noActions")).toBeInTheDocument());
    expect(screen.queryByRole("img")).toBeFalsy();
  });

  it("勾选：乐观翻转 + PATCH body {completed:!}，失败回滚 + toast error", async () => {
    renderPanel({ initialItems: [item()] });
    const box = screen.getByLabelText("产出评审纪要") as HTMLInputElement;
    expect(box.checked).toBe(false);

    mocks.api.mockRejectedValueOnce(new Error("patch 炸了"));
    fireEvent.click(box);

    // 乐观翻转后回滚
    await waitFor(() =>
      expect(mocks.api).toHaveBeenLastCalledWith(`${ENDPOINT}/act-1`, {
        method: "PATCH",
        body: JSON.stringify({ completed: true }),
      }),
    );
    await waitFor(() =>
      expect((screen.getByLabelText("产出评审纪要") as HTMLInputElement).checked).toBe(false),
    );
    expect(mocks.toast).toHaveBeenCalledWith("error", "patch 炸了");
  });

  it("勾选成功：就地翻转（标题划线）且不重拉", async () => {
    renderPanel({ initialItems: [item()] });
    mocks.api.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByLabelText("产出评审纪要"));

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    const { container } = renderPanel({ initialItems: [item({ completed: true })] });
    expect(container.innerHTML).toContain("line-through");
  });

  it("同步：POST sync-actions，created/updated 组合 toast", async () => {
    renderPanel({ initialItems: [item()] });
    mocks.api.mockResolvedValueOnce({ created: 2, updated: 1 });

    fireEvent.click(screen.getByLabelText("decision:syncActions"));

    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith(SYNC_ENDPOINT, { method: "POST" }));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        "success",
        'decision:actionCreated:{"count":2} · decision:actionUpdated:{"count":1}',
      ),
    );
  });

  it("同步响应无 items → 重新拉取列表", async () => {
    renderPanel({ initialItems: [item()] });
    mocks.api.mockResolvedValueOnce({ created: 0, updated: 0 });
    mocks.api.mockResolvedValueOnce([item({ id: "act-9", title: "重拉后的行" })]);

    fireEvent.click(screen.getByLabelText("decision:syncActions"));

    await waitFor(() => expect(screen.getByText("重拉后的行")).toBeInTheDocument());
    expect(mocks.toast).toHaveBeenCalledWith("info", "decision:actionItems");
  });

  it("同步失败 → toast error + 错误条", async () => {
    renderPanel({ initialItems: [item()] });
    mocks.api.mockRejectedValueOnce(new Error("同步炸了"));

    fireEvent.click(screen.getByLabelText("decision:syncActions"));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("error", "同步炸了"));
    expect(screen.getByText("同步炸了")).toBeInTheDocument();
  });

  it("taskId → 任务链接指向 /w/{wid}/task/{taskId}", () => {
    renderPanel({ initialItems: [item({ taskId: "t-77" })] });
    const link = screen.getByLabelText("open task");
    expect(link).toHaveAttribute("href", `/w/${WID}/task/t-77`);
  });

  it("过期未完成项截止日标红；已完成不标红", () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const first = renderPanel({ initialItems: [item({ dueDate: past })] });
    expect(first.container.innerHTML).toContain("text-[var(--danger-fg)]");
    first.unmount();

    const second = renderPanel({
      initialItems: [item({ dueDate: past, completed: true })],
    });
    expect(second.container.innerHTML).not.toContain("text-[var(--danger-fg)]");
  });

  it("模板菜单：打开列出模板，插入时 {dueDate} 替换为今天+7 天，菜单收起", async () => {
    renderPanel({ initialItems: [item()], onInsertTemplate: mocks.onInsertTemplate });

    fireEvent.click(screen.getByLabelText("decision:insertTemplate"));
    expect(screen.getByText("模板甲")).toBeInTheDocument();

    const expectedDue = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    fireEvent.click(screen.getByText("模板甲"));
    expect(mocks.onInsertTemplate).toHaveBeenCalledWith(`- 行动一 ${expectedDue}\n- 行动二`);
    await waitFor(() => expect(screen.queryByText("模板甲")).toBeFalsy());
  });

  it("模板菜单：Escape 关闭；未提供 onInsertTemplate 时按钮不渲染", () => {
    renderPanel({ initialItems: [item()], onInsertTemplate: mocks.onInsertTemplate });
    fireEvent.click(screen.getByLabelText("decision:insertTemplate"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("模板甲")).toBeFalsy();

    cleanup();
    renderPanel({ initialItems: [item()] });
    expect(screen.queryByLabelText("decision:insertTemplate")).toBeFalsy();
  });

  it("refreshSignal 变化（>0）→ 重拉", async () => {
    mocks.api.mockResolvedValueOnce([item({ title: "第一版" })]);
    const { rerender } = renderPanel();
    await waitFor(() => expect(screen.getByText("第一版")).toBeInTheDocument());

    mocks.api.mockResolvedValueOnce([item({ title: "第二版" })]);
    rerender(
      <ActionItemPanel
        decisionId={DID}
        workspaceId={WID}
        taskId={TASK}
        locale="zh"
        refreshSignal={1}
      />,
    );
    await waitFor(() => expect(screen.getByText("第二版")).toBeInTheDocument());
  });

  it("负责人无 name 时回退 assigneeName / email", () => {
    renderPanel({
      initialItems: [
        item({ id: "a", assignee: null, assigneeName: "草稿人" }),
        item({ id: "b", assignee: null, assigneeName: null, priority: "low" }),
      ],
    });
    expect(screen.getByLabelText("草稿人")).toBeInTheDocument();
    // 全空 → 不渲染头像（display "?" 也不会出现，因为 assigneeDisplay 为 null）
    expect(screen.queryByLabelText("?")).toBeFalsy();
  });
});
