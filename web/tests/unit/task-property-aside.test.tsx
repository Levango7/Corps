// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import React from "react";

import { TaskPropertyAside } from "@/components/task/TaskPropertyAside";
import type { Person, Task } from "@/components/task/types";
import { localDateToISOString, toLocalDateString } from "@/lib/date";

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

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock("@/components/Toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/components/CalendarSyncBadge", () => ({
  default: ({ wid, taskId }: { wid: string; taskId: string }) => (
    <span data-testid="cal-sync" data-wid={wid} data-task-id={taskId} />
  ),
}));

const writeText = vi.fn();

const MEMBERS: Person[] = [
  { id: "u-1", name: "Alice", email: "alice@x.com" },
  { id: "u-2", name: null, email: "han@x.com" },
];

const relTime = (iso: string) => `rel:${iso}`;

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "t-1",
    title: "任务甲",
    description: null,
    status: "todo",
    priority: "medium",
    dueDate: "2026-10-20T10:00:00Z",
    assignee: MEMBERS[0],
    creator: MEMBERS[0],
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T12:00:00Z",
    blocked: false,
    blockedReason: null,
    shareToken: null,
    children: [],
    ...overrides,
  };
}

function renderAside(options: { task?: Task; members?: Person[] } = {}) {
  const onPatch = vi.fn();
  const task = options.task ?? makeTask();
  const utils = render(
    <TaskPropertyAside
      task={task}
      members={options.members ?? MEMBERS}
      onPatch={onPatch}
      wid="ws-1"
      id="t-1"
      relTime={relTime}
    />,
  );
  return { ...utils, onPatch, task };
}

/** 按字段标签文本定位对应 select（标签 div 与 select 为兄弟节点） */
function selectFor(label: string): HTMLSelectElement {
  const labelEl = screen.getByText(label);
  return labelEl.parentElement!.querySelector("select")!;
}

describe("TaskPropertyAside", () => {
  beforeEach(() => {
    // jsdom 无 Clipboard API，注入可控桩
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    toastMock.mockReset();
    writeText.mockReset();
  });

  it("状态 select：四个选项（status 命名空间），当前值选中", () => {
    renderAside();
    const select = selectFor("task:fieldStatus");
    expect(select.value).toBe("todo");
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "status:todo",
      "status:in_progress",
      "status:review",
      "status:done",
    ]);
  });

  it("切换状态触发 onPatch({ status })", () => {
    const { onPatch } = renderAside();
    fireEvent.change(selectFor("task:fieldStatus"), { target: { value: "review" } });
    expect(onPatch).toHaveBeenCalledWith({ status: "review" });
  });

  it("优先级 select：四个选项（priority 命名空间），切换触发 onPatch", () => {
    const { onPatch } = renderAside();
    const select = selectFor("task:fieldPriority");
    expect(select.value).toBe("medium");
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "priority:low",
      "priority:medium",
      "priority:high",
      "priority:urgent",
    ]);
    fireEvent.change(select, { target: { value: "urgent" } });
    expect(onPatch).toHaveBeenCalledWith({ priority: "urgent" });
  });

  it("指派人 select：未指派选项 + 成员列表（name 为 null 时回退邮箱）", () => {
    renderAside();
    const select = selectFor("task:assignee");
    expect(select.value).toBe("u-1");
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "task:unassigned",
      "Alice",
      "han@x.com",
    ]);
    // aria-label 不起作用，options 即可见文案
  });

  it("切换指派人触发 onPatch；改回未指派传 null", () => {
    const { onPatch } = renderAside();
    fireEvent.change(selectFor("task:assignee"), { target: { value: "u-2" } });
    expect(onPatch).toHaveBeenCalledWith({ assigneeId: "u-2" });
    fireEvent.change(selectFor("task:assignee"), { target: { value: "" } });
    expect(onPatch).toHaveBeenCalledWith({ assigneeId: null });
  });

  it("截止日期：显示本地日期，修改触发 localDateToISOString 转换，清空传 null", () => {
    const { onPatch, task } = renderAside();
    const input = screen.getByDisplayValue(
      toLocalDateString(new Date(task.dueDate!)),
    ) as HTMLInputElement;
    expect(input).toHaveAttribute("type", "date");
    fireEvent.change(input, { target: { value: "2026-11-05" } });
    expect(onPatch).toHaveBeenCalledWith({ dueDate: localDateToISOString("2026-11-05") });
    fireEvent.change(input, { target: { value: "" } });
    expect(onPatch).toHaveBeenCalledWith({ dueDate: null });
  });

  it("有截止日期时渲染 CalendarSyncBadge（透传 wid/taskId）", () => {
    renderAside();
    const badge = screen.getByTestId("cal-sync");
    expect(badge).toHaveAttribute("data-wid", "ws-1");
    expect(badge).toHaveAttribute("data-task-id", "t-1");
  });

  it("无截止日期时不渲染 CalendarSyncBadge", () => {
    renderAside({ task: makeTask({ dueDate: null }) });
    expect(screen.queryByTestId("cal-sync")).not.toBeInTheDocument();
  });

  it("未阻塞时显示标记按钮，点击 onPatch({ blocked: true })", () => {
    const { onPatch } = renderAside();
    const mark = screen.getByRole("button", { name: "task:blockedMark" });
    fireEvent.click(mark);
    expect(onPatch).toHaveBeenCalledWith({ blocked: true });
  });

  it("已阻塞时显示徽标 + 原因输入框，失焦值变化才 patch（trim）", () => {
    const { onPatch } = renderAside({
      task: makeTask({ blocked: true, blockedReason: "旧原因" }),
    });
    expect(screen.getByText("task:blockedBadge")).toBeInTheDocument();
    const input = screen.getByPlaceholderText("task:blockedReasonPlaceholder");
    expect(input).toHaveValue("旧原因");
    // 值未变 → 不 patch
    fireEvent.blur(input);
    expect(onPatch).not.toHaveBeenCalled();
    // 值变化（含两端空白被 trim）
    fireEvent.change(input, { target: { value: "  新原因  " } });
    fireEvent.blur(input);
    expect(onPatch).toHaveBeenCalledWith({ blockedReason: "新原因" });
  });

  it("阻塞原因清成空白时 patch null；原本就为 null 时不 patch", () => {
    const { onPatch } = renderAside({
      task: makeTask({ blocked: true, blockedReason: "旧原因" }),
    });
    const input = screen.getByPlaceholderText("task:blockedReasonPlaceholder");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);
    expect(onPatch).toHaveBeenCalledWith({ blockedReason: null });

    const second = renderAside({
      task: makeTask({ blocked: true, blockedReason: null }),
    });
    const input2 = second.container.querySelector(
      "input[placeholder='task:blockedReasonPlaceholder']",
    )!;
    fireEvent.blur(input2);
    expect(second.onPatch).not.toHaveBeenCalled();
  });

  it("解除阻塞按钮触发 onPatch({ blocked:false, blockedReason:null })", () => {
    const { onPatch } = renderAside({
      task: makeTask({ blocked: true, blockedReason: "卡住了" }),
    });
    fireEvent.click(screen.getByRole("button", { name: "task:blockedClear" }));
    expect(onPatch).toHaveBeenCalledWith({ blocked: false, blockedReason: null });
  });

  it("无 shareToken 时显示生成按钮，点击 onPatch({ shareToken: 'rotate' })", () => {
    const { onPatch } = renderAside();
    fireEvent.click(screen.getByRole("button", { name: "task:shareGenerate" }));
    expect(onPatch).toHaveBeenCalledWith({ shareToken: "rotate" });
  });

  it("有 shareToken 时显示只读 URL、撤销按钮，撤销传 null", () => {
    const { onPatch, rerender } = renderAside({
      task: makeTask({ shareToken: "tok-abc" }),
    });
    const urlInput = screen.getByDisplayValue(
      `${window.location.origin}/tasks/share/tok-abc`,
    ) as HTMLInputElement;
    expect(urlInput).toHaveAttribute("readonly");
    fireEvent.click(screen.getByRole("button", { name: "task:shareRevoke" }));
    expect(onPatch).toHaveBeenCalledWith({ shareToken: null });

    // rerender 撤销令牌后回到生成按钮（effect 依赖 shareToken）
    rerender(
      <TaskPropertyAside
        task={makeTask({ shareToken: null })}
        members={MEMBERS}
        onPatch={onPatch}
        wid="ws-1"
        id="t-1"
        relTime={relTime}
      />,
    );
    expect(screen.getByRole("button", { name: "task:shareGenerate" })).toBeInTheDocument();
  });

  it("复制成功：写入剪贴板、文案切换 2s 后复位", async () => {
    writeText.mockResolvedValue(undefined);
    vi.useFakeTimers();
    renderAside({ task: makeTask({ shareToken: "tok-abc" }) });
    const copy = screen.getByRole("button", { name: "task:shareCopy" });
    await act(async () => {
      fireEvent.click(copy);
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/tasks/share/tok-abc`);
    expect(screen.getByRole("button", { name: "task:shareCopied" })).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole("button", { name: "task:shareCopy" })).toBeInTheDocument();
  });

  it("复制失败（剪贴板权限拒绝）：toast 报错且文案不变", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    renderAside({ task: makeTask({ shareToken: "tok-abc" }) });
    const copy = screen.getByRole("button", { name: "task:shareCopy" });
    await act(async () => {
      fireEvent.click(copy);
    });
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith("error", "error:copyFailed");
    expect(copy).toHaveTextContent("task:shareCopy");
  });

  it("页脚渲染创建人/创建时间/更新时间", () => {
    const { task } = renderAside();
    expect(
      screen.getByText(`task:creator:${JSON.stringify({ name: "Alice" })}`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        `task:createdAt:${JSON.stringify({ date: new Date(task.createdAt).toLocaleString() })}`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText((_, el) => el?.textContent === `task:updatedAt ${relTime(task.updatedAt)}`),
    ).toBeInTheDocument();
  });

  it("创建人为 null 时页脚 name 回退为 —", () => {
    renderAside({ task: makeTask({ creator: null }) });
    expect(screen.getByText(`task:creator:${JSON.stringify({ name: "—" })}`)).toBeInTheDocument();
  });
});
