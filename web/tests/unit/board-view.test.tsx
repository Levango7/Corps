// @vitest-environment jsdom

/**
 * BoardView 契约（components/database/BoardView.tsx）：
 * 按 select/multiselect 字段分组看板——列由分组字段的 choices 决定（默认 token 色循环，
 * choice 自带 color 则覆盖），外加固定"未分组"列；空配置或 groupFieldId 指向已删字段时
 * 回退 noGroupField 提示。卡片标题取第一个 text 字段（无则取 fields[0]，空值显示 untitled），
 * 次要字段取另一字段（select 显示选项名、date 显示 M/D、无效日期回退原字符串）。
 * 拖拽为原生 HTML5 D&D：dragStart 写入 recordId 并置拖拽态、drop 调 onRecordUpdate
 * （拖入未分组列写 null），dragOver/dragLeave/dragEnd 维护列高亮与拖拽态。
 */
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { vi, afterEach, describe, it, expect } from "vitest";
import { BoardView } from "@/components/database/BoardView";
import type { Database, DatabaseField, DatabaseRecord, DatabaseView } from "@prisma/client";

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

// ─── fixtures ───────────────────────────────────────────────

const DB = {} as unknown as Database;

function makeField(overrides: {
  id: string;
  name: string;
  type: string;
  options?: Record<string, unknown>;
}): DatabaseField {
  return {
    id: overrides.id,
    databaseId: "db-1",
    name: overrides.name,
    type: overrides.type as DatabaseField["type"],
    options: (overrides.options ?? {}) as unknown as DatabaseField["options"],
    sortOrder: 0,
    createdAt: new Date("2026-10-01T00:00:00Z"),
  } as unknown as DatabaseField;
}

function makeRecord(overrides: {
  id: string;
  data?: Record<string, unknown> | null;
}): DatabaseRecord {
  return {
    id: overrides.id,
    databaseId: "db-1",
    data: (overrides.data ?? {}) as unknown as DatabaseRecord["data"],
    sortOrder: 0,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    updatedAt: new Date("2026-10-01T00:00:00Z"),
  } as unknown as DatabaseRecord;
}

function makeView(config?: Record<string, unknown>): DatabaseView {
  return {
    id: "v-1",
    databaseId: "db-1",
    name: "看板",
    type: "board",
    config: (config ?? {}) as unknown as DatabaseView["config"],
    sortOrder: 0,
    createdAt: new Date("2026-10-01T00:00:00Z"),
  } as unknown as DatabaseView;
}

const TITLE = makeField({ id: "f-title", name: "标题", type: "text" });
const STATUS = makeField({
  id: "f-status",
  name: "状态",
  type: "select",
  options: {
    choices: [
      { id: "c-todo", name: "待办" },
      { id: "c-done", name: "已完成", color: "var(--success)" },
    ],
  },
});
const TAGS = makeField({
  id: "f-tags",
  name: "标签",
  type: "multiselect",
  options: {
    choices: [
      { id: "c-a", name: "标签A" },
      { id: "c-b", name: "标签B" },
    ],
  },
});
const WHEN = makeField({ id: "f-when", name: "日期", type: "date" });
const NUM = makeField({ id: "f-num", name: "数量", type: "number" });

// ─── helpers ────────────────────────────────────────────────

function column(container: HTMLElement, key: string): HTMLElement {
  const el = container.querySelector(`[data-column="${key}"]`);
  if (!el) throw new Error(`column ${key} not found`);
  return el as HTMLElement;
}

function boardProps(overrides?: {
  records?: DatabaseRecord[];
  fields?: DatabaseField[];
  view?: DatabaseView;
  onRecordUpdate?: (id: string, data: Record<string, unknown>) => void;
}) {
  return {
    database: DB,
    fields: overrides?.fields ?? [TITLE, STATUS],
    records: overrides?.records ?? [],
    view: overrides?.view ?? makeView({ groupFieldId: "f-status" }),
    onRecordUpdate: overrides?.onRecordUpdate,
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─── tests ──────────────────────────────────────────────────

describe("BoardView", () => {
  it("config 无 groupFieldId 时回退 noGroupField 提示且不渲染列", () => {
    const { container } = render(<BoardView {...boardProps({ view: makeView({}) })} />);
    expect(screen.getByText("database.boardView:noGroupField")).toBeInTheDocument();
    expect(container.querySelector("[data-column]")).toBeNull();
  });

  it("groupFieldId 指向已删除字段时同样回退 noGroupField 提示", () => {
    const { container } = render(
      <BoardView {...boardProps({ view: makeView({ groupFieldId: "f-gone" }) })} />,
    );
    expect(screen.getByText("database.boardView:noGroupField")).toBeInTheDocument();
    expect(container.querySelector("[data-column]")).toBeNull();
  });

  it("按 select 选项建列：列名、可访问角色、choice 自带 color 覆盖默认色循环、计数", () => {
    const records = [
      makeRecord({ id: "rec-1", data: { "f-title": "任务一", "f-status": "c-todo" } }),
      makeRecord({ id: "rec-2", data: { "f-title": "任务二", "f-status": "c-todo" } }),
      makeRecord({ id: "rec-3", data: { "f-title": "任务三", "f-status": "c-done" } }),
    ];
    const { container } = render(<BoardView {...boardProps({ records })} />);

    const todo = column(container, "c-todo");
    expect(todo).toHaveAttribute("role", "group");
    expect(todo).toHaveAttribute("aria-label", "待办");
    expect(todo.querySelector(".tabular-nums")).toHaveTextContent("2");

    const done = column(container, "c-done");
    expect(done).toHaveAttribute("aria-label", "已完成");
    expect(done.querySelector(".tabular-nums")).toHaveTextContent("1");

    // 未带 color 的 choice 落入默认色循环第 1 档（var(--muted)），带 color 的用 choice 值
    expect(todo.querySelector('[class*="w-2 h-2"]')?.getAttribute("style")).toContain(
      "background: var(--muted)",
    );
    expect(done.querySelector('[class*="w-2 h-2"]')?.getAttribute("style")).toContain(
      "background: var(--success)",
    );
    // 未分组列固定 var(--meta)
    const ungrouped = column(container, "__ungrouped__");
    expect(ungrouped).toHaveAttribute("aria-label", "database.boardView:ungrouped");
    expect(ungrouped.querySelector(".tabular-nums")).toHaveTextContent("0");
  });

  it("空列显示 dropHere 占位", () => {
    const { container } = render(<BoardView {...boardProps()} />);
    expect(column(container, "c-todo")).toHaveTextContent("database.boardView:dropHere");
  });

  it("select 值为 null 或空字符串时落入未分组列", () => {
    const records = [
      makeRecord({ id: "rec-1", data: { "f-title": "空值A", "f-status": null } }),
      makeRecord({ id: "rec-2", data: { "f-title": "空值B", "f-status": "" } }),
    ];
    const { container } = render(<BoardView {...boardProps({ records })} />);
    expect(column(container, "__ungrouped__").querySelectorAll('[draggable="true"]')).toHaveLength(
      2,
    );
    expect(column(container, "c-todo").querySelectorAll('[draggable="true"]')).toHaveLength(0);
  });

  it("select 值不在选项内时落入未分组列", () => {
    const records = [
      makeRecord({ id: "rec-1", data: { "f-title": "游离", "f-status": "c-legacy" } }),
    ];
    const { container } = render(<BoardView {...boardProps({ records })} />);
    expect(column(container, "__ungrouped__")).toHaveTextContent("游离");
  });

  it("记录 data 为 null 时安全回退并落入未分组列", () => {
    const records = [makeRecord({ id: "rec-1", data: null })];
    const { container } = render(<BoardView {...boardProps({ records })} />);
    expect(column(container, "__ungrouped__").querySelectorAll('[draggable="true"]')).toHaveLength(
      1,
    );
  });

  it("multiselect 一条记录同时出现在多个匹配列", () => {
    const records = [
      makeRecord({ id: "rec-1", data: { "f-title": "多标签", "f-tags": ["c-a", "c-b"] } }),
    ];
    const { container } = render(
      <BoardView
        {...boardProps({
          records,
          fields: [TITLE, TAGS],
          view: makeView({ groupFieldId: "f-tags" }),
        })}
      />,
    );
    expect(column(container, "c-a")).toHaveTextContent("多标签");
    expect(column(container, "c-b")).toHaveTextContent("多标签");
  });

  it("multiselect 空数组或全部未知值时落入未分组列", () => {
    const records = [
      makeRecord({ id: "rec-1", data: { "f-title": "空标签", "f-tags": [] } }),
      makeRecord({ id: "rec-2", data: { "f-title": "野值", "f-tags": ["c-x"] } }),
    ];
    const { container } = render(
      <BoardView
        {...boardProps({
          records,
          fields: [TITLE, TAGS],
          view: makeView({ groupFieldId: "f-tags" }),
        })}
      />,
    );
    expect(column(container, "__ungrouped__").querySelectorAll('[draggable="true"]')).toHaveLength(
      2,
    );
  });

  it("卡片次要字段：select 显示选项名", () => {
    const records = [
      makeRecord({ id: "rec-1", data: { "f-title": "任务一", "f-status": "c-done" } }),
    ];
    const { container } = render(<BoardView {...boardProps({ records })} />);
    expect(column(container, "c-done")).toHaveTextContent("已完成");
  });

  it("卡片次要字段：date 显示 M/D（本地日期，避免时区漂移）", () => {
    const records = [
      makeRecord({
        id: "rec-1",
        data: { "f-title": "日程", "f-when": new Date(2026, 9, 12, 3).getTime() },
      }),
    ];
    const { container } = render(
      <BoardView
        {...boardProps({
          records,
          fields: [TITLE, WHEN],
          view: makeView({ groupFieldId: "f-when" }),
        })}
      />,
    );
    // f-when 无 choices → 列表只有未分组列，卡片次要字段即日期
    expect(column(container, "__ungrouped__")).toHaveTextContent("10/12");
  });

  it("卡片次要字段：无效日期回退为原字符串", () => {
    const records = [
      makeRecord({ id: "rec-1", data: { "f-title": "日程", "f-when": "不是日期" } }),
    ];
    const { container } = render(
      <BoardView
        {...boardProps({
          records,
          fields: [TITLE, WHEN],
          view: makeView({ groupFieldId: "f-when" }),
        })}
      />,
    );
    expect(column(container, "__ungrouped__")).toHaveTextContent("不是日期");
  });

  it("卡片次要字段：number 直接显示数值字符串", () => {
    const records = [makeRecord({ id: "rec-1", data: { "f-title": "计数", "f-num": 7 } })];
    const { container } = render(
      <BoardView
        {...boardProps({
          records,
          fields: [TITLE, NUM],
          view: makeView({ groupFieldId: "f-num" }),
        })}
      />,
    );
    expect(column(container, "__ungrouped__")).toHaveTextContent("7");
  });

  it("卡片次要字段：multiselect 用英文逗号连接多个选项名", () => {
    const records = [
      makeRecord({ id: "rec-1", data: { "f-title": "任务一", "f-tags": ["c-a", "c-b"] } }),
    ];
    const { container } = render(
      <BoardView
        {...boardProps({
          records,
          fields: [TITLE, TAGS],
          view: makeView({ groupFieldId: "f-tags" }),
        })}
      />,
    );
    // 记录同时归入 c-a / c-b 两列，卡片次要字段为选项名列表
    expect(column(container, "c-a")).toHaveTextContent("标签A, 标签B");
    expect(column(container, "c-b")).toHaveTextContent("标签A, 标签B");
  });

  it("标题字段值为空时显示 untitled 占位", () => {
    const records = [makeRecord({ id: "rec-1", data: { "f-title": "", "f-status": "c-todo" } })];
    const { container } = render(<BoardView {...boardProps({ records })} />);
    expect(column(container, "c-todo")).toHaveTextContent("database.boardView:untitled");
  });

  it("无 text 字段时标题回退第一个字段、次要字段回退另一个字段", () => {
    const records = [makeRecord({ id: "rec-1", data: { "f-status": "c-done", "f-num": 3 } })];
    const { container } = render(<BoardView {...boardProps({ records, fields: [STATUS, NUM] })} />);
    const done = column(container, "c-done");
    // 标题 = STATUS 的选项名，次要 = NUM 的数值
    expect(done.querySelectorAll("p")[0]).toHaveTextContent("已完成");
    expect(done.querySelectorAll("p")[1]).toHaveTextContent("3");
  });

  it("拖起卡片置拖拽态、拖放到目标列触发 onRecordUpdate 并清除拖拽态", () => {
    const onRecordUpdate = vi.fn();
    const records = [
      makeRecord({ id: "rec-1", data: { "f-title": "任务一", "f-status": "c-todo" } }),
    ];
    const { container } = render(<BoardView {...boardProps({ records, onRecordUpdate })} />);

    const card = column(container, "c-todo").querySelector('[draggable="true"]') as HTMLElement;
    fireEvent.dragStart(card, { dataTransfer: { setData: vi.fn(), effectAllowed: "" } });
    expect(card.className).toContain("opacity-50");

    fireEvent.drop(column(container, "c-done"), { dataTransfer: { getData: () => "rec-1" } });
    expect(onRecordUpdate).toHaveBeenCalledTimes(1);
    expect(onRecordUpdate).toHaveBeenCalledWith("rec-1", { "f-status": "c-done" });
    expect(card.className).not.toContain("opacity-50");
  });

  it("拖放到未分组列时 onRecordUpdate 写入 null", () => {
    const onRecordUpdate = vi.fn();
    const records = [
      makeRecord({ id: "rec-1", data: { "f-title": "任务一", "f-status": "c-todo" } }),
    ];
    const { container } = render(<BoardView {...boardProps({ records, onRecordUpdate })} />);
    const card = column(container, "c-todo").querySelector('[draggable="true"]') as HTMLElement;
    fireEvent.dragStart(card, { dataTransfer: { setData: vi.fn(), effectAllowed: "" } });
    fireEvent.drop(column(container, "__ungrouped__"), {
      dataTransfer: { getData: () => "rec-1" },
    });
    expect(onRecordUpdate).toHaveBeenCalledWith("rec-1", { "f-status": null });
  });

  it("未提供 onRecordUpdate 时拖放不报错", () => {
    const records = [
      makeRecord({ id: "rec-1", data: { "f-title": "任务一", "f-status": "c-todo" } }),
    ];
    const { container } = render(<BoardView {...boardProps({ records })} />);
    const card = column(container, "c-todo").querySelector('[draggable="true"]') as HTMLElement;
    fireEvent.dragStart(card, { dataTransfer: { setData: vi.fn(), effectAllowed: "" } });
    expect(() =>
      fireEvent.drop(column(container, "c-done"), {
        dataTransfer: { getData: () => "rec-1" },
      }),
    ).not.toThrow();
  });

  it("dragOver 高亮目标列、dragLeave 取消高亮", () => {
    const { container } = render(<BoardView {...boardProps()} />);
    const todo = column(container, "c-todo");
    fireEvent.dragOver(todo);
    expect(todo.className).toContain("ring-2");
    fireEvent.dragLeave(todo);
    expect(todo.className).not.toContain("ring-2");
  });

  it("dragEnd 同时清除拖拽态与列高亮", () => {
    const onRecordUpdate = vi.fn();
    const records = [
      makeRecord({ id: "rec-1", data: { "f-title": "任务一", "f-status": "c-todo" } }),
    ];
    const { container } = render(<BoardView {...boardProps({ records, onRecordUpdate })} />);
    const todo = column(container, "c-todo");
    const card = todo.querySelector('[draggable="true"]') as HTMLElement;
    fireEvent.dragStart(card, { dataTransfer: { setData: vi.fn(), effectAllowed: "" } });
    fireEvent.dragOver(todo);
    expect(card.className).toContain("opacity-50");
    expect(todo.className).toContain("ring-2");
    fireEvent.dragEnd(card);
    expect(card.className).not.toContain("opacity-50");
    expect(todo.className).not.toContain("ring-2");
  });
});
