// @vitest-environment jsdom

/**
 * GanttView 契约（components/database/GanttView.tsx）：
 * 甘特图按天渲染——时间轴范围由记录日期与今天共同决定（min 至少为今天，过去记录会把轴向左扩展），
 * 记录有至少一个可解析日期才成条。
 * 未配 startDateField/endDateField（或字段不存在）时回退 noDateFields；
 * 有字段但无任何可日期化记录时回退 noDatedRecords。条样式 left/width 由 offset 与
 * span（夹在 totalDays 内）推算；条颜色由 colorField 的值映射（var(--*) 直通、
 * 语义名 success/warning/error 等转 token、其余回退 var(--accent)）；行标题取第一个
 * text 字段（无 text 字段时取 fields[0]），值缺失时回退 record.id 前 8 位；
 * 条标签取自 labelField。
 */
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { vi, beforeEach, afterEach, describe, it, expect } from "vitest";
import { GanttView } from "@/components/database/GanttView";
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
    name: "甘特",
    type: "gantt",
    config: (config ?? {}) as unknown as DatabaseView["config"],
    sortOrder: 0,
    createdAt: new Date("2026-10-01T00:00:00Z"),
  } as unknown as DatabaseView;
}

const TEXT = makeField({ id: "f-title", name: "标题", type: "text" });
const START = makeField({ id: "f-start", name: "开始", type: "date" });
const END = makeField({ id: "f-end", name: "结束", type: "date" });
const LABEL = makeField({ id: "f-label", name: "条标签", type: "text" });
const COLOR = makeField({
  id: "f-color",
  name: "颜色",
  type: "select",
  options: { choices: [] },
});
const NUM = makeField({ id: "f-num", name: "数量", type: "number" });

/** 本地日期时间戳，避免时区漂移 */
const ts = (day: number) => new Date(2026, 9, day, 3).getTime();

function ganttProps(overrides?: {
  records?: DatabaseRecord[];
  fields?: DatabaseField[];
  view?: DatabaseView;
}) {
  return {
    database: DB,
    fields: overrides?.fields ?? [TEXT, START, END],
    records: overrides?.records ?? [],
    view: overrides?.view ?? makeView({ startDateField: "f-start", endDateField: "f-end" }),
  };
}

// ─── helpers ────────────────────────────────────────────────

function bars(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('[class*="-translate-y-1/2"]'));
}

function rowTitles(container: HTMLElement): string[] {
  // 每行的标题列宽 200px（表头 recordLabel 列同样 200px，过滤掉）
  return Array.from(container.querySelectorAll('[style*="width: 200px"]'))
    .map((el) => el.textContent ?? "")
    .filter((text) => text !== "database.ganttView:recordLabel");
}

function dayHeaders(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[style*="width: 48px"]')).map(
    (el) => el.textContent ?? "",
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 1, 9, 0, 0)); // 2026-10-01
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─── tests ──────────────────────────────────────────────────

describe("GanttView", () => {
  it("未配日期字段（或字段不存在）时回退 noDateFields 提示", () => {
    const { container } = render(<GanttView {...ganttProps({ view: makeView({}), fields: [] })} />);
    expect(screen.getByText("database.ganttView:noDateFields")).toBeInTheDocument();
    expect(bars(container)).toHaveLength(0);

    // startDateField 指向已删字段同样回退
    render(
      <GanttView {...ganttProps({ view: makeView({ startDateField: "f-gone" }), fields: [] })} />,
    );
    expect(screen.getAllByText("database.ganttView:noDateFields")).toHaveLength(2);
  });

  it("配了日期字段但记录无任何可解析日期时回退 noDatedRecords", () => {
    const records = [makeRecord({ id: "rec-1", data: {} })];
    render(<GanttView {...ganttProps({ records })} />);
    expect(screen.getByText("database.ganttView:noDatedRecords")).toBeInTheDocument();
  });

  it("记录 data 为 null 时安全回退且不生成条", () => {
    const records = [makeRecord({ id: "rec-1", data: null })];
    render(<GanttView {...ganttProps({ records })} />);
    expect(screen.getByText("database.ganttView:noDatedRecords")).toBeInTheDocument();
  });

  it("双日期记录：时间轴含今天、条 left/width/height 按天推算、行标题与 recordLabel 表头", () => {
    const records = [
      makeRecord({
        id: "rec-1",
        data: { "f-title": "任务甲", "f-start": ts(10), "f-end": ts(12) },
      }),
    ];
    const { container } = render(<GanttView {...ganttProps({ records })} />);

    expect(screen.getByText("database.ganttView:recordLabel")).toBeInTheDocument();
    // min=今天(10/1)，max=结束日+1(10/13) → 时间轴 10/1..10/13
    expect(dayHeaders(container).at(0)).toBe("10/1");
    expect(dayHeaders(container).at(-1)).toBe("10/13");

    const bar = bars(container)[0];
    expect(bar.style.left).toBe("432px"); // 9 天 × 48
    expect(bar.style.width).toBe("140px"); // 3 天 × 48 - 4
    expect(bar.style.height).toBe("28px"); // 行高 36 - 8
    expect(bar.style.background).toBe("var(--accent)");
    expect(rowTitles(container)).toEqual(["任务甲"]);
    // 未配 labelField → 条标签为空
    expect(bar.textContent).toBe("");
  });

  it("起止同天时条宽为 1 天（44px）", () => {
    const records = [
      makeRecord({ id: "rec-1", data: { "f-title": "单天", "f-start": ts(11), "f-end": ts(11) } }),
    ];
    const { container } = render(<GanttView {...ganttProps({ records })} />);
    expect(bars(container)[0].style.width).toBe("44px");
  });

  it("只有开始日期时按单天条渲染", () => {
    const records = [makeRecord({ id: "rec-1", data: { "f-title": "仅开始", "f-start": ts(12) } })];
    const { container } = render(<GanttView {...ganttProps({ records })} />);
    const bar = bars(container)[0];
    expect(bar.style.left).toBe("528px"); // 11 天 × 48
    expect(bar.style.width).toBe("44px");
  });

  it("只有结束日期时按单天条渲染", () => {
    const records = [makeRecord({ id: "rec-1", data: { "f-title": "仅结束", "f-end": ts(12) } })];
    const { container } = render(<GanttView {...ganttProps({ records })} />);
    const bar = bars(container)[0];
    expect(bar.style.left).toBe("528px");
    expect(bar.style.width).toBe("44px");
  });

  it("过去日期的记录把时间轴向左扩展（min 取记录开始日，今天仍在轴内）", () => {
    const records = [
      makeRecord({
        id: "rec-1",
        data: { "f-title": "旧任务", "f-start": ts(-8), "f-end": ts(-6) },
      }),
    ];
    const { container } = render(<GanttView {...ganttProps({ records })} />);
    // min=9/22，max=今天+1(10/2) → 时间轴 9/22..10/2 共 11 天，今天 10/1 在其中
    expect(dayHeaders(container)).toHaveLength(11);
    expect(dayHeaders(container).at(0)).toBe("9/22");
    expect(dayHeaders(container).at(-1)).toBe("10/2");
    expect(dayHeaders(container)).toContain("10/1");
    const bar = bars(container)[0];
    expect(bar.style.left).toBe("0px");
    expect(bar.style.width).toBe("140px"); // span 3 天
  });

  it("labelField 提供条标签，值缺失时为空", () => {
    const records = [
      makeRecord({
        id: "rec-1",
        data: { "f-title": "任务甲", "f-label": "实施中", "f-start": ts(10), "f-end": ts(12) },
      }),
      makeRecord({
        id: "rec-2",
        data: { "f-title": "任务乙", "f-start": ts(10), "f-end": ts(11) },
      }),
    ];
    const { container } = render(
      <GanttView
        {...ganttProps({
          records,
          fields: [TEXT, START, END, LABEL],
          view: makeView({
            startDateField: "f-start",
            endDateField: "f-end",
            labelField: "f-label",
          }),
        })}
      />,
    );
    const rendered = bars(container);
    expect(rendered[0].textContent).toBe("实施中");
    expect(rendered[1].textContent).toBe("");
  });

  it("标题字段值缺失时回退 record.id 前 8 位（无 text 字段时取 fields[0]）", () => {
    const records = [
      // f-num 无值 → getFieldValue 为 null → 回退 id 前 8 位
      makeRecord({ id: "gantt-r1-sha", data: { "f-start": ts(5), "f-end": ts(6) } }),
    ];
    const { container } = render(
      <GanttView {...ganttProps({ records, fields: [NUM, START, END] })} />,
    );
    expect(rowTitles(container)).toEqual(["gantt-r1"]);
  });

  it("colorField 值映射：var(--*) 直通、语义名转 token、未知值回退 accent", () => {
    const records = [
      makeRecord({
        id: "rec-a",
        data: { "f-title": "A", "f-color": "success", "f-start": ts(10), "f-end": ts(10) },
      }),
      makeRecord({
        id: "rec-b",
        data: { "f-title": "B", "f-color": "warning", "f-start": ts(11), "f-end": ts(11) },
      }),
      makeRecord({
        id: "rec-c",
        data: { "f-title": "C", "f-color": "error", "f-start": ts(12), "f-end": ts(12) },
      }),
      makeRecord({
        id: "rec-d",
        data: { "f-title": "D", "f-color": "var(--custom-x)", "f-start": ts(13), "f-end": ts(13) },
      }),
      makeRecord({
        id: "rec-e",
        data: { "f-title": "E", "f-color": "banana", "f-start": ts(14), "f-end": ts(14) },
      }),
    ];
    const { container } = render(
      <GanttView
        {...ganttProps({
          records,
          fields: [TEXT, START, END, COLOR],
          view: makeView({
            startDateField: "f-start",
            endDateField: "f-end",
            colorField: "f-color",
          }),
        })}
      />,
    );
    const rendered = bars(container);
    expect(rendered[0].style.background).toBe("var(--success)");
    expect(rendered[1].style.background).toBe("var(--warn)");
    expect(rendered[2].style.background).toBe("var(--danger)");
    expect(rendered[3].style.background).toBe("var(--custom-x)");
    expect(rendered[4].style.background).toBe("var(--accent)");
  });

  it("日期值为 Date 实例时可解析成条", () => {
    const records = [
      makeRecord({
        id: "rec-1",
        data: { "f-title": "实例日期", "f-start": new Date(2026, 9, 11, 3) },
      }),
    ];
    const { container } = render(<GanttView {...ganttProps({ records })} />);
    expect(bars(container)).toHaveLength(1);
    expect(rowTitles(container)).toEqual(["实例日期"]);
  });

  it("无效日期字符串的记录被跳过并回退 noDatedRecords", () => {
    const records = [
      makeRecord({ id: "rec-1", data: { "f-title": "坏日期", "f-start": "不是日期" } }),
    ];
    render(<GanttView {...ganttProps({ records })} />);
    expect(screen.getByText("database.ganttView:noDatedRecords")).toBeInTheDocument();
  });
});
