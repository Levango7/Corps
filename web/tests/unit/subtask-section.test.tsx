// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

/**
 * SubtaskSection 契约（components/SubtaskSection.tsx）：
 *  - 空列表：只有标题（aria-label）与添加输入框，无计数/进度条/列表
 *  - 列表：checkbox（aria-label 含子任务标题）切换完成态；标题按钮 → router.push(`/w/{wid}/task/{id}`)；
 *    done 项 checked + line-through；blocked 项显示徽标（title=blockedReason）
 *  - 计数 done/total；进度条 width=pct%，pct=100 用 --success 否则 --accent
 *  - 添加：Enter（优先取事件里 input 当前值）或按钮提交 → POST /api/v1/workspaces/{wid}/tasks
 *    （body {title, parentId: taskId}）→ 清空输入 + onChanged()；空/空格标题不提交；
 *    busy（含 pending）时按钮 disabled；失败显示 Error.message 或 task:subtaskAddFailed
 *  - 勾选：PATCH /api/v1/workspaces/{wid}/tasks/{id}（body {status: next}）→ onChanged()；
 *    勾选中该项 checkbox 换成 spinner 且其他勾选被忽略（togglingId 防重）；失败 toast("error", ...)
 */

const h = vi.hoisted(() => ({
  api: vi.fn(),
  push: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api: h.api }));

vi.mock("@/lib/i18n-navigation", () => ({
  useRouter: () => ({ push: h.push }),
}));

vi.mock("@/components/Toast", () => ({
  useToast: () => ({ toast: h.toast }),
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

import { SubtaskSection } from "@/components/SubtaskSection";
import type { Subtask } from "@/lib/types";

function makeSubtask(partial: Partial<Subtask> = {}): Subtask {
  return {
    id: "st-1",
    title: "子任务一",
    status: "todo",
    priority: "medium",
    blocked: false,
    blockedReason: null,
    assigneeId: null,
    dueDate: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

const SUBTASKS: Subtask[] = [
  makeSubtask({ id: "st-1", title: "子任务一", status: "todo" }),
  makeSubtask({ id: "st-2", title: "子任务二", status: "done" }),
  makeSubtask({
    id: "st-3",
    title: "子任务三",
    status: "done",
    blocked: true,
    blockedReason: "依赖未完成",
  }),
];

const toggleLabel = (title: string) => `task:subtaskToggle:${JSON.stringify({ title })}`;

function renderSection(subtasks: Subtask[] = SUBTASKS, onChanged = vi.fn()) {
  return render(
    <SubtaskSection wid="ws-1" taskId="task-1" subtasks={subtasks} onChanged={onChanged} />,
  );
}

const PROGRESS_BAR_SEL = ".h-full.rounded-full";

beforeEach(() => {
  h.api.mockReset();
  h.push.mockReset();
  h.toast.mockReset();
  h.api.mockResolvedValue({ id: "new-1" });
});
afterEach(() => {
  cleanup();
});

describe("SubtaskSection 渲染", () => {
  it("空列表：标题与添加输入框存在，无计数/进度条/列表", () => {
    const { container } = renderSection([]);
    expect(screen.getByLabelText("task:subtaskTitle")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("task:subtaskPlaceholder")).toBeInTheDocument();
    expect(container.querySelector("ul")).toBeNull();
    expect(container.querySelector(PROGRESS_BAR_SEL)).toBeNull();
    expect(screen.queryByText(/\d+\/\d+/)).toBeNull();
  });

  it("计数 2/3 与进度条：width 67%、背景 var(--accent)", () => {
    const { container } = renderSection();
    expect(screen.getByText("2/3")).toBeInTheDocument();
    const bar = container.querySelector(PROGRESS_BAR_SEL) as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.style.width).toBe("67%");
    expect(bar.style.background).toBe("var(--accent)");
  });

  it("全部完成：计数 3/3、进度条 width 100%、背景 var(--success)", () => {
    const { container } = renderSection(SUBTASKS.map((s) => ({ ...s, status: "done" as const })));
    expect(screen.getByText("3/3")).toBeInTheDocument();
    const bar = container.querySelector(PROGRESS_BAR_SEL) as HTMLElement;
    expect(bar.style.width).toBe("100%");
    expect(bar.style.background).toBe("var(--success)");
  });

  it("列表项渲染：标题按钮可见、checkbox aria-label 含子任务标题", () => {
    renderSection();
    expect(screen.getByText("子任务一")).toBeInTheDocument();
    expect(screen.getByText("子任务三")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: toggleLabel("子任务一") })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: toggleLabel("子任务三") })).toBeInTheDocument();
  });

  it("完成态：checkbox checked 且标题带 line-through；未完成项未 checked", () => {
    renderSection();
    const doneBox = screen.getByRole("checkbox", { name: toggleLabel("子任务二") });
    expect(doneBox).toBeChecked();
    expect(screen.getByText("子任务二")).toHaveClass("line-through");
    const todoBox = screen.getByRole("checkbox", { name: toggleLabel("子任务一") });
    expect(todoBox).not.toBeChecked();
    expect(screen.getByText("子任务一")).not.toHaveClass("line-through");
  });

  it("blocked 项显示徽标（title=blockedReason），未 blocked 项无徽标", () => {
    renderSection();
    const badge = screen.getByTitle("依赖未完成");
    expect(badge).toHaveTextContent("task:blockedBadge");
    // 仅 1 个徽标（3 项中只有 st-3 blocked）
    expect(screen.getAllByText("task:blockedBadge")).toHaveLength(1);
  });

  it("点击子任务标题 → router.push 到 /w/{wid}/task/{id}", () => {
    renderSection();
    fireEvent.click(screen.getByText("子任务一"));
    expect(h.push).toHaveBeenCalledWith("/w/ws-1/task/st-1");
  });
});

describe("SubtaskSection 添加子任务", () => {
  it("输入标题后 Enter → POST 参数正确、onChanged 调用、输入框清空", async () => {
    const onChanged = vi.fn();
    renderSection(undefined, onChanged);
    const input = screen.getByPlaceholderText("task:subtaskPlaceholder");
    fireEvent.change(input, { target: { value: "新子任务" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(h.api).toHaveBeenCalledTimes(1);
    const [path, opts] = h.api.mock.calls[0];
    expect(path).toBe("/api/v1/workspaces/ws-1/tasks");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({ title: "新子任务", parentId: "task-1" });
    expect(input).toHaveValue("");
  });

  it("空标题 / 纯空格 Enter 不提交", () => {
    renderSection();
    const input = screen.getByPlaceholderText("task:subtaskPlaceholder");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(h.api).not.toHaveBeenCalled();
  });

  it("添加按钮：空 draft disabled，输入后可提交，pending 期间 disabled（busy 防重）", async () => {
    const onChanged = vi.fn();
    renderSection(undefined, onChanged);
    const btn = screen.getByRole("button", { name: "task:subtaskAdd" });
    expect(btn).toBeDisabled();
    const input = screen.getByPlaceholderText("task:subtaskPlaceholder");
    fireEvent.change(input, { target: { value: "点我提交" } });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(JSON.parse(h.api.mock.calls[0][1].body)).toEqual({
      title: "点我提交",
      parentId: "task-1",
    });
    // 第二次提交挂起（busy）→ 按钮 disabled
    h.api.mockImplementation(() => new Promise(() => {}));
    fireEvent.change(input, { target: { value: "慢慢来" } });
    fireEvent.click(screen.getByRole("button", { name: "task:subtaskAdd" }));
    expect(screen.getByRole("button", { name: "task:subtaskAdd" })).toBeDisabled();
  });

  it("添加失败：Error 显示 message，非 Error 回退文案 task:subtaskAddFailed", async () => {
    h.api.mockRejectedValueOnce(new Error("网络异常"));
    renderSection();
    const input = screen.getByPlaceholderText("task:subtaskPlaceholder");
    fireEvent.change(input, { target: { value: "会失败" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("网络异常")).toBeInTheDocument());
    // 第二次失败抛非 Error 值 → 回退到翻译键
    h.api.mockRejectedValueOnce("boom");
    fireEvent.change(input, { target: { value: "再失败" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("task:subtaskAddFailed")).toBeInTheDocument());
    expect(screen.queryByText("网络异常")).not.toBeInTheDocument();
  });
});

describe("SubtaskSection 勾选切换", () => {
  it("勾选切换 → PATCH status 双向（done/todo）并 onChanged", async () => {
    const onChanged = vi.fn();
    renderSection(undefined, onChanged);
    // 未完成 → done
    fireEvent.click(screen.getByRole("checkbox", { name: toggleLabel("子任务一") }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    const [path, opts] = h.api.mock.calls[0];
    expect(path).toBe("/api/v1/workspaces/ws-1/tasks/st-1");
    expect(opts.method).toBe("PATCH");
    expect(JSON.parse(opts.body)).toEqual({ status: "done" });
    // 已完成 → todo
    fireEvent.click(screen.getByRole("checkbox", { name: toggleLabel("子任务二") }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2));
    expect(JSON.parse(h.api.mock.calls[1][1].body)).toEqual({ status: "todo" });
  });

  it('勾选失败 → toast("error", message)', async () => {
    h.api.mockRejectedValueOnce(new Error("更新失败"));
    renderSection();
    fireEvent.click(screen.getByRole("checkbox", { name: toggleLabel("子任务一") }));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith("error", "更新失败"));
  });

  it("勾选中：该项 checkbox 换成 spinner，其他项勾选被忽略（防重）", async () => {
    h.api.mockImplementation(() => new Promise(() => {}));
    renderSection();
    fireEvent.click(screen.getByRole("checkbox", { name: toggleLabel("子任务一") }));
    await waitFor(() =>
      expect(screen.queryByRole("checkbox", { name: toggleLabel("子任务一") })).toBeNull(),
    );
    // spinner 与原 checkbox 同名（aria-label 保留），且另一项仍可交互但被 togglingId 拦截
    expect(screen.getByLabelText(toggleLabel("子任务一"))).not.toBeInstanceOf(HTMLInputElement);
    fireEvent.click(screen.getByRole("checkbox", { name: toggleLabel("子任务二") }));
    expect(h.api).toHaveBeenCalledTimes(1);
  });
});
