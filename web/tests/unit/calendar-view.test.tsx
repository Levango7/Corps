// @vitest-environment jsdom

/**
 * CalendarView 契约（components/database/CalendarView.tsx）：
 * 月/周/日三粒度日历——月视图固定 42 格（周一起算，跨月格弱化），
 * 周视图 7 格，日视图为记录行列表。记录按 dateField 值放入对应日期格（本地日期键），
 * 每格最多 3 条，超出显示 more{count}。无 dateField / dateFieldId 失效时回退 noDateField；
 * 日视图无记录时显示 noDayRecords。导航按钮按粒度 ±1 月 / ±7 天 / ±1 天；
 * today 按钮回到真实当前日期。标题字段取第一个 text 字段（空值显示 untitled）。
 */
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { vi, beforeEach, afterEach, describe, it, expect } from "vitest";
import { CalendarView } from "@/components/database/CalendarView";
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
    name: "日历",
    type: "calendar",
    config: (config ?? {}) as unknown as DatabaseView["config"],
    sortOrder: 0,
    createdAt: new Date("2026-10-01T00:00:00Z"),
  } as unknown as DatabaseView;
}

const TITLE = makeField({ id: "f-title", name: "标题", type: "text" });
const DATE = makeField({ id: "f-date", name: "日期", type: "date" });

const WEEKDAY_LABELS = [
  "database.calendarView:weekdayMon",
  "database.calendarView:weekdayTue",
  "database.calendarView:weekdayWed",
  "database.calendarView:weekdayThu",
  "database.calendarView:weekdayFri",
  "database.calendarView:weekdaySat",
  "database.calendarView:weekdaySun",
];

/** 本地日期时间戳，避免时区漂移 */
const ts = (day: number) => new Date(2026, 9, day, 3).getTime();

function calendarProps(overrides?: {
  records?: DatabaseRecord[];
  fields?: DatabaseField[];
  view?: DatabaseView;
  granularity?: "month" | "week" | "day";
}) {
  return {
    database: DB,
    fields: overrides?.fields ?? [TITLE, DATE],
    records: overrides?.records ?? [],
    view: overrides?.view ?? makeView({ dateField: "f-date" }),
    granularity: overrides?.granularity,
  };
}

// ─── helpers ────────────────────────────────────────────────

function headerTitle(container: HTMLElement): string | null {
  return container.querySelector('[class*="min-w-[140px]"]')?.textContent ?? null;
}

/** 按格内日期数字找日格（2026-10 月视图/周视图中 15/12/16 等均唯一） */
function dayCell(container: HTMLElement, dayNumber: number): HTMLElement {
  const cells = Array.from(container.querySelectorAll('[class*="min-h-[100px]"]'));
  const cell = cells.find(
    (el) => el.querySelector('[class*="w-6 h-6"]')?.textContent === String(dayNumber),
  );
  if (!cell) throw new Error(`day cell ${dayNumber} not found`);
  return cell as HTMLElement;
}

function chipsIn(cell: HTMLElement): Element[] {
  const list = cell.querySelector(".space-y-1");
  if (!list) return [];
  return Array.from(list.querySelectorAll('[class*="bg-[var(--accent)]"]'));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 15, 9, 0, 0)); // 2026-10-15 周四
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─── tests ──────────────────────────────────────────────────

describe("CalendarView", () => {
  it("config 无 dateField 时回退 noDateField 提示", () => {
    render(<CalendarView {...calendarProps({ view: makeView({}) })} />);
    expect(screen.getByText("database.calendarView:noDateField")).toBeInTheDocument();
  });

  it("dateField 指向已删除字段时同样回退 noDateField 提示", () => {
    render(<CalendarView {...calendarProps({ view: makeView({ dateField: "f-gone" }) })} />);
    expect(screen.getByText("database.calendarView:noDateField")).toBeInTheDocument();
  });

  it("月视图渲染 7 个周几表头（周一起）与 42 个日格", () => {
    const { container } = render(<CalendarView {...calendarProps()} />);
    const weekdays = Array.from(container.querySelectorAll(".text-center.py-2"));
    expect(weekdays.map((el) => el.textContent)).toEqual(WEEKDAY_LABELS);
    expect(container.querySelectorAll('[class*="min-h-[100px]"]')).toHaveLength(42);
  });

  it("今天格高亮、其他月格弱化（2026-10 月视图跨月 11 格）", () => {
    const { container } = render(<CalendarView {...calendarProps()} />);
    const todayBadge = Array.from(container.querySelectorAll('[class*="w-6 h-6"]')).find(
      (el) => el.textContent === "15",
    );
    expect(todayBadge?.className).toContain("bg-[var(--accent)]");
    expect(todayBadge?.className).toContain("text-[var(--accent-fg)]");
    const otherMonthCells = container.querySelectorAll(
      '[class*="min-h-[100px]"][class*="bg-[var(--surface-2)]"]',
    );
    expect(otherMonthCells).toHaveLength(11); // Sep 28-30 + Nov 1-8
  });

  it("记录按 dateField 值放入对应日期格并显示标题", () => {
    const records = [makeRecord({ id: "rec-1", data: { "f-title": "里程碑", "f-date": ts(15) } })];
    const { container } = render(<CalendarView {...calendarProps({ records })} />);
    const chip = screen.getByText("里程碑");
    expect(chip.className).toContain("bg-[var(--accent)]");
    expect(chipsIn(dayCell(container, 15))).toHaveLength(1);
    expect(chipsIn(dayCell(container, 16))).toHaveLength(0);
  });

  it("同一日期超过 3 条时只渲染 3 条并显示 more 计数", () => {
    const records = [1, 2, 3, 4, 5].map((i) =>
      makeRecord({ id: `rec-${i}`, data: { "f-title": `事项${i}`, "f-date": ts(15) } }),
    );
    const { container } = render(<CalendarView {...calendarProps({ records })} />);
    expect(chipsIn(dayCell(container, 15))).toHaveLength(3);
    expect(screen.getByText('database.calendarView:more:{"count":2}')).toBeInTheDocument();
  });

  it("无效日期值的记录不放入任何格", () => {
    const records = [
      makeRecord({ id: "rec-1", data: { "f-title": "坏日期", "f-date": "不是日期" } }),
    ];
    render(<CalendarView {...calendarProps({ records })} />);
    expect(screen.queryByText("坏日期")).toBeNull();
  });

  it("标题字段值为空时显示 untitled 占位", () => {
    const records = [makeRecord({ id: "rec-1", data: { "f-title": "", "f-date": ts(16) } })];
    const { container } = render(<CalendarView {...calendarProps({ records })} />);
    expect(chipsIn(dayCell(container, 16))[0]).toHaveTextContent("database.calendarView:untitled");
  });

  it("无 text 字段时标题回退第一个字段（date 值本身的字符串）", () => {
    const records = [makeRecord({ id: "rec-1", data: { "f-date": ts(16) } })];
    const { container } = render(<CalendarView {...calendarProps({ records, fields: [DATE] })} />);
    expect(chipsIn(dayCell(container, 16))[0]).toHaveTextContent(String(ts(16)));
  });

  it("切换到日粒度且当天无记录时显示 noDayRecords", () => {
    render(<CalendarView {...calendarProps()} />);
    fireEvent.click(screen.getByText("database.calendarView:granularityDay"));
    expect(screen.getByText("database.calendarView:noDayRecords")).toBeInTheDocument();
  });

  it("日粒度渲染当天记录行（含 accent 色条与标题）", () => {
    const records = [makeRecord({ id: "rec-1", data: { "f-title": "里程碑", "f-date": ts(15) } })];
    const { container } = render(<CalendarView {...calendarProps({ records })} />);
    fireEvent.click(screen.getByText("database.calendarView:granularityDay"));
    expect(screen.getByText("里程碑")).toBeInTheDocument();
    expect(container.querySelectorAll('[class*="w-1 h-8"]')).toHaveLength(1);
  });

  it("日粒度标题为 dayTitle，翻页 ±1 天", () => {
    const { container } = render(<CalendarView {...calendarProps()} />);
    fireEvent.click(screen.getByText("database.calendarView:granularityDay"));
    expect(headerTitle(container)).toBe(
      'database.calendarView:dayTitle:{"year":2026,"month":10,"day":15}',
    );
    fireEvent.click(screen.getByRole("button", { name: "database.calendarView:nextPageAria" }));
    expect(headerTitle(container)).toBe(
      'database.calendarView:dayTitle:{"year":2026,"month":10,"day":16}',
    );
    fireEvent.click(screen.getByRole("button", { name: "database.calendarView:prevPageAria" }));
    expect(headerTitle(container)).toBe(
      'database.calendarView:dayTitle:{"year":2026,"month":10,"day":15}',
    );
  });

  it("granularity 初始 prop 为 day 时直接进入日视图", () => {
    const { container } = render(<CalendarView {...calendarProps({ granularity: "day" })} />);
    expect(headerTitle(container)).toBe(
      'database.calendarView:dayTitle:{"year":2026,"month":10,"day":15}',
    );
    expect(screen.getByText("database.calendarView:noDayRecords")).toBeInTheDocument();
  });

  it("切换到周粒度：7 个日格与 weekTitle（2026-10-15 所在周为 10/12~10/18）", () => {
    const { container } = render(<CalendarView {...calendarProps()} />);
    fireEvent.click(screen.getByText("database.calendarView:granularityWeek"));
    expect(headerTitle(container)).toBe(
      'database.calendarView:weekTitle:{"year":2026,"startMonth":10,"startDay":12,"endMonth":10,"endDay":18}',
    );
    expect(container.querySelectorAll('[class*="min-h-[100px]"]')).toHaveLength(7);
  });

  it("周粒度翻页 ±7 天", () => {
    const { container } = render(<CalendarView {...calendarProps()} />);
    fireEvent.click(screen.getByText("database.calendarView:granularityWeek"));
    fireEvent.click(screen.getByRole("button", { name: "database.calendarView:nextPageAria" }));
    expect(headerTitle(container)).toContain('"startDay":19');
    expect(headerTitle(container)).toContain('"endDay":25');
    fireEvent.click(screen.getByRole("button", { name: "database.calendarView:prevPageAria" }));
    expect(headerTitle(container)).toContain('"startDay":12');
  });

  it("月粒度翻页 ±1 月，today 按钮回到本月", () => {
    const { container } = render(<CalendarView {...calendarProps()} />);
    expect(headerTitle(container)).toBe(
      'database.calendarView:monthTitle:{"year":2026,"month":10}',
    );
    fireEvent.click(screen.getByRole("button", { name: "database.calendarView:nextPageAria" }));
    expect(headerTitle(container)).toBe(
      'database.calendarView:monthTitle:{"year":2026,"month":11}',
    );
    fireEvent.click(screen.getByRole("button", { name: "database.calendarView:prevPageAria" }));
    expect(headerTitle(container)).toBe(
      'database.calendarView:monthTitle:{"year":2026,"month":10}',
    );
    // 下一页后点 today 回到本月
    fireEvent.click(screen.getByRole("button", { name: "database.calendarView:nextPageAria" }));
    fireEvent.click(screen.getByRole("button", { name: "database.calendarView:today" }));
    expect(headerTitle(container)).toBe(
      'database.calendarView:monthTitle:{"year":2026,"month":10}',
    );
  });
});
