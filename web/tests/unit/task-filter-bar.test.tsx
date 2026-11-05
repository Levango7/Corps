// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

/**
 * TaskFilterBar 契约（components/TaskFilterBar.tsx）：
 *  - 标题 + 活跃条件数徽标；清空按钮仅在筛选非空时出现
 *  - 状态/负责人下拉 free 可用；优先级/标签/关键词 Pro 门控（locked → disabled + proLockLabel）
 *  - 变更即上抛 onChange({...value, 字段})
 *  - 标签 chips 多选切换（aria-pressed），>8 个显示 +N 溢出
 *  - 保存视图（Pro + 非空筛选）：命名保存到 localStorage（corps:views:{userId}:{wid}），
 *    chip 可应用（onChange 视图筛选）/删除
 *  - 非空筛选组合变更打 track("filter_applied")
 */

const mocks = vi.hoisted(() => ({
  track: vi.fn(),
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

vi.mock("@/lib/analytics", () => ({ track: mocks.track }));

import { TaskFilterBar, EMPTY_FILTER, type TaskFilter } from "@/components/TaskFilterBar";

const MEMBERS = [
  { id: "u2", name: "李四", email: "lisi@corp.io" },
  { id: "u3", name: null, email: "wang@corp.io" },
];
const LABELS = [
  { id: "l1", name: "前端", color: "var(--danger)" },
  { id: "l2", name: "紧急", color: "var(--success)" },
];
const VIEW_KEY = "corps:views:u1:w1";

type BarProps = Parameters<typeof TaskFilterBar>[0];

function renderBar(overrides: Partial<BarProps> = {}) {
  const props: BarProps = {
    value: { ...EMPTY_FILTER },
    onChange: vi.fn(),
    isPro: true,
    members: MEMBERS,
    labels: LABELS,
    userId: "u1",
    wid: "w1",
    ...overrides,
  };
  return render(<TaskFilterBar {...props} />);
}

// 本仓 vitest jsdom 不提供 localStorage（theme-toggle.test.tsx 同坑）：装最小内存实现
let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
  mocks.track.mockReset();
});
afterEach(() => cleanup());

describe("TaskFilterBar", () => {
  it("渲染标题与状态/负责人/优先级下拉、关键词输入框（aria-label 可命中）", () => {
    renderBar();
    expect(screen.getByText("task.filter:title")).toBeInTheDocument();
    expect(screen.getByLabelText("task.filter:status")).toBeInTheDocument();
    expect(screen.getByLabelText("task.filter:assignee")).toBeInTheDocument();
    expect(screen.getByLabelText("task.filter:priority")).toBeInTheDocument();
    expect(screen.getByLabelText("task.filter:keyword")).toBeInTheDocument();
  });

  it("状态下拉与负责人下拉的选项结构（status 5 项；assignee=all/me/成员，name 空用 email）", () => {
    renderBar();
    const status = screen.getByLabelText("task.filter:status") as HTMLSelectElement;
    expect(Array.from(status.options).map((o) => o.value)).toEqual([
      "all",
      "todo",
      "in_progress",
      "review",
      "done",
    ]);
    expect(status.value).toBe("all");
    const assignee = screen.getByLabelText("task.filter:assignee") as HTMLSelectElement;
    expect(Array.from(assignee.options).map((o) => o.value)).toEqual(["all", "me", "u2", "u3"]);
    const names = Array.from(assignee.options).map((o) => o.textContent);
    expect(names).toContain("李四");
    expect(names).toContain("wang@corp.io");
  });

  it("Pro 门控：free 时优先级/关键词/标签 disabled + proLockLabel，Pro 时可用且无提示", () => {
    const { rerender } = renderBar({ isPro: false });
    expect(screen.getByLabelText("task.filter:priority")).toBeDisabled();
    expect(screen.getByLabelText("task.filter:keyword")).toBeDisabled();
    expect(screen.getByRole("button", { name: "前端" })).toBeDisabled();
    expect(screen.getByText("task.filter:proLockLabel")).toBeInTheDocument();

    rerender(
      <TaskFilterBar
        value={{ ...EMPTY_FILTER }}
        onChange={vi.fn()}
        isPro
        members={MEMBERS}
        labels={LABELS}
        userId="u1"
        wid="w1"
      />,
    );
    expect(screen.getByLabelText("task.filter:priority")).toBeEnabled();
    expect(screen.getByLabelText("task.filter:keyword")).toBeEnabled();
    expect(screen.getByRole("button", { name: "前端" })).toBeEnabled();
    expect(screen.queryByText("task.filter:proLockLabel")).not.toBeInTheDocument();
  });

  it("状态变更 → onChange({...value, status})", () => {
    const onChange = vi.fn();
    renderBar({ onChange, value: { ...EMPTY_FILTER, assignee: "u2" } });
    fireEvent.change(screen.getByLabelText("task.filter:status"), { target: { value: "todo" } });
    expect(onChange).toHaveBeenCalledWith({
      status: "todo",
      assignee: "u2",
      priority: "all",
      labels: [],
      q: "",
    });
  });

  it("负责人变更 → onChange({...value, assignee})", () => {
    const onChange = vi.fn();
    renderBar({ onChange });
    fireEvent.change(screen.getByLabelText("task.filter:assignee"), { target: { value: "u3" } });
    expect(onChange).toHaveBeenCalledWith({
      status: "all",
      assignee: "u3",
      priority: "all",
      labels: [],
      q: "",
    });
  });

  it("优先级变更（Pro）→ onChange({...value, priority})", () => {
    const onChange = vi.fn();
    renderBar({ onChange });
    fireEvent.change(screen.getByLabelText("task.filter:priority"), { target: { value: "high" } });
    expect(onChange).toHaveBeenCalledWith({
      status: "all",
      assignee: "all",
      priority: "high",
      labels: [],
      q: "",
    });
  });

  it("关键词输入 → onChange({...value, q})", () => {
    const onChange = vi.fn();
    renderBar({ onChange });
    fireEvent.change(screen.getByLabelText("task.filter:keyword"), { target: { value: "bug" } });
    expect(onChange).toHaveBeenCalledWith({
      status: "all",
      assignee: "all",
      priority: "all",
      labels: [],
      q: "bug",
    });
  });

  it("标签 chip 切换：未选点击 → 加入 labels；已选点击 → 移除（aria-pressed 同步）", () => {
    const onChange = vi.fn();
    const { rerender } = renderBar({ onChange, value: { ...EMPTY_FILTER } });
    const chip = screen.getByRole("button", { name: "前端" });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(chip);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ labels: ["l1"] }));

    onChange.mockClear();
    rerender(
      <TaskFilterBar
        value={{ status: "all", assignee: "all", priority: "all", labels: ["l1"], q: "" }}
        onChange={onChange}
        isPro
        members={MEMBERS}
        labels={LABELS}
        userId="u1"
        wid="w1"
      />,
    );
    const selected = screen.getByRole("button", { name: "前端" });
    expect(selected).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(selected);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ labels: [] }));
  });

  it("活跃筛选：条件数徽标 + 清空按钮 → onChange(EMPTY_FILTER)；空筛选无清空", () => {
    const onChange = vi.fn();
    const value: TaskFilter = {
      status: "todo",
      assignee: "u2",
      priority: "all",
      labels: [],
      q: "",
    };
    const { rerender } = renderBar({ onChange, value });
    expect(screen.getByText("2")).toBeInTheDocument(); // status + assignee 两个维度
    fireEvent.click(screen.getByRole("button", { name: "task.filter:clear" }));
    expect(onChange).toHaveBeenCalledWith(EMPTY_FILTER);

    onChange.mockClear();
    rerender(
      <TaskFilterBar
        value={{ ...EMPTY_FILTER }}
        onChange={onChange}
        isPro
        members={MEMBERS}
        labels={LABELS}
        userId="u1"
        wid="w1"
      />,
    );
    expect(screen.queryByText("2")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "task.filter:clear" })).not.toBeInTheDocument();
  });

  it("保存视图（Pro + 非空筛选）：命名确认后写入 localStorage 并出现可应用 chip", () => {
    const onChange = vi.fn();
    renderBar({ onChange, value: { ...EMPTY_FILTER, status: "todo" } });
    fireEvent.click(screen.getByRole("button", { name: "task.filter:saveView" }));
    const nameInput = screen.getByPlaceholderText("task.filter:viewNamePlaceholder");
    fireEvent.change(nameInput, { target: { value: "我的视图" } });
    fireEvent.click(screen.getByRole("button", { name: "task.filter:saveConfirm" }));

    const saved = JSON.parse(localStorage.getItem(VIEW_KEY)!) as Array<{
      name: string;
      filter: TaskFilter;
    }>;
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe("我的视图");
    expect(saved[0].filter.status).toBe("todo");
    expect(
      screen.getByRole("button", {
        name: `task.filter:applyView:${JSON.stringify({ name: "我的视图" })}`,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText("task.filter:viewNamePlaceholder"),
    ).not.toBeInTheDocument();
  });

  it("保存视图门控：空筛选或 free 时 saveView 按钮 disabled", () => {
    const { rerender } = renderBar({ isPro: true, value: { ...EMPTY_FILTER } });
    expect(screen.getByRole("button", { name: "task.filter:saveView" })).toBeDisabled();
    rerender(
      <TaskFilterBar
        value={{ ...EMPTY_FILTER, q: "x" }}
        onChange={vi.fn()}
        isPro={false}
        members={MEMBERS}
        labels={LABELS}
        userId="u1"
        wid="w1"
      />,
    );
    expect(screen.getByRole("button", { name: "task.filter:saveView" })).toBeDisabled();
  });

  it("已存视图：点击 chip → onChange 视图筛选；点击删除 → localStorage 移除", () => {
    const onChange = vi.fn();
    localStorage.setItem(
      VIEW_KEY,
      JSON.stringify([{ name: "V1", filter: { ...EMPTY_FILTER, priority: "high" } }]),
    );
    renderBar({ onChange });
    fireEvent.click(
      screen.getByRole("button", {
        name: `task.filter:applyView:${JSON.stringify({ name: "V1" })}`,
      }),
    );
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTER, priority: "high" });

    fireEvent.click(
      screen.getByRole("button", {
        name: `task.filter:deleteView:${JSON.stringify({ name: "V1" })}`,
      }),
    );
    expect(JSON.parse(localStorage.getItem(VIEW_KEY)!)).toEqual([]);
    expect(screen.queryByText("V1")).not.toBeInTheDocument();
  });

  it("labels 超过 8 个：只渲染 8 个 chip + 溢出计数 +N", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      id: `l${i}`,
      name: `标签${i}`,
      color: "var(--meta)",
    }));
    renderBar({ labels: many });
    expect(screen.getByRole("button", { name: "标签7" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "标签8" })).not.toBeInTheDocument();
    expect(screen.getByText("+2")).toBeInTheDocument();
  });

  it("非空筛选挂载时打 filter_applied 埋点（维度数 + isPro）；空筛选不打", () => {
    renderBar({ value: { ...EMPTY_FILTER, status: "todo", labels: ["l1"] }, isPro: true });
    expect(mocks.track).toHaveBeenCalledWith("filter_applied", { dimensions: 2, isPro: true });
  });
});
