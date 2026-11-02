// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

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

import { CalendarMonth } from "@/components/calendar/CalendarMonth";
import type { CalendarEvent } from "@/components/calendar/CalendarEventDialog";

/** 本地时间构造事件（组件按本地日线段归属判断），时区无关 */
function makeEvent(id: string, day: number, hour: number, extra: Partial<CalendarEvent> = {}) {
  const start = new Date(2026, 9, day, hour, 0);
  const end = new Date(2026, 9, day, hour + 1, 0);
  return {
    id,
    title: `事件${id}`,
    description: null,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    allDay: false,
    location: null,
    color: null,
    createdBy: "u1",
    createdAt: start.toISOString(),
    updatedAt: start.toISOString(),
    ...extra,
  } as CalendarEvent;
}

/** 月视图固定测试月：2026-10（1 日=周四，共 31 天 → 前置 4 个空格） */
const CURRENT = new Date(2026, 9, 1);

function renderMonth(events: CalendarEvent[], overrides: { currentDate?: Date } = {}) {
  const onPrev = vi.fn();
  const onNext = vi.fn();
  const onToday = vi.fn();
  const onEventClick = vi.fn();
  const onDayClick = vi.fn();
  const { container } = render(
    <CalendarMonth
      events={events}
      currentDate={overrides.currentDate ?? CURRENT}
      onPrev={onPrev}
      onNext={onNext}
      onToday={onToday}
      onEventClick={onEventClick}
      onDayClick={onDayClick}
    />,
  );
  const desktopGrid = container.querySelector('[class*="grid-rows-6"]') as HTMLElement;
  const mobileList = container.querySelector('[class*="sm:hidden"]') as HTMLElement;
  return { container, desktopGrid, mobileList, onPrev, onNext, onToday, onEventClick, onDayClick };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CalendarMonth", () => {
  it("渲染标题与星期表头：monthYear 词条带年月变量、7 个星期标题有序", () => {
    const { container } = renderMonth([]);
    expect(screen.getByText('calendar:monthYear:{"year":2026,"month":10}')).toBeTruthy();
    const headerRow = container.querySelector('[class*="grid-cols-7 mb-1"]') as HTMLElement;
    const headers = Array.from(headerRow.children).map((el) => el.textContent);
    expect(headers).toEqual([
      "calendar:sunday",
      "calendar:monday",
      "calendar:tuesday",
      "calendar:wednesday",
      "calendar:thursday",
      "calendar:friday",
      "calendar:saturday",
    ]);
  });

  it("桌面网格渲染 42 格：31 天（首格 1、末格 31）+ 前后空格（无 role=button、无日期 span）", () => {
    const { desktopGrid } = renderMonth([]);
    expect(desktopGrid.children.length).toBe(42);
    const daySpans = Array.from(desktopGrid.querySelectorAll("span[class*='rounded-full']"));
    expect(daySpans.length).toBe(31);
    expect(daySpans[0].textContent).toBe("1");
    expect(daySpans[30].textContent).toBe("31");
    const buttonCells = desktopGrid.querySelectorAll('[role="button"]');
    expect(buttonCells.length).toBe(31);
  });

  it("导航按钮回调：previous/next month aria-label 与 today 文案均触发回调", () => {
    const { onPrev, onNext, onToday } = renderMonth([]);
    fireEvent.click(screen.getByLabelText("previous month"));
    fireEvent.click(screen.getByLabelText("next month"));
    fireEvent.click(screen.getByText("calendar:today"));
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onToday).toHaveBeenCalledTimes(1);
  });

  it("点击日期格与 Enter/Space 键均触发 onDayClick（携带该日 Date）", () => {
    const { desktopGrid, onDayClick } = renderMonth([]);
    const daySpans = Array.from(desktopGrid.querySelectorAll("span[class*='rounded-full']"));
    const day5Cell = daySpans[4].closest('[role="button"]') as HTMLElement;
    fireEvent.click(day5Cell);
    expect(onDayClick).toHaveBeenCalledWith(new Date(2026, 9, 5));
    fireEvent.keyDown(day5Cell, { key: "Enter" });
    fireEvent.keyDown(day5Cell, { key: " " });
    expect(onDayClick).toHaveBeenCalledTimes(3);
  });

  it("事件渲染在正确的日期格内（按本地日线段归属）", () => {
    const { desktopGrid } = renderMonth([makeEvent("e1", 5, 9), makeEvent("e2", 20, 14)]);
    const daySpans = Array.from(desktopGrid.querySelectorAll("span[class*='rounded-full']"));
    const day5Cell = daySpans[4].closest('[role="button"]') as HTMLElement;
    const day20Cell = daySpans[19].closest('[role="button"]') as HTMLElement;
    expect(within(day5Cell).getByText("事件e1")).toBeTruthy();
    expect(within(day20Cell).getByText("事件e2")).toBeTruthy();
    expect(within(day20Cell).queryByText("事件e1")).toBeNull();
  });

  it("桌面格超过 3 条事件时截断并显示 +N 溢出标记", () => {
    const events = [1, 2, 3, 4, 5].map((n) => makeEvent(`e${n}`, 5, 8 + n));
    const { desktopGrid } = renderMonth(events);
    const daySpans = Array.from(desktopGrid.querySelectorAll("span[class*='rounded-full']"));
    const day5Cell = daySpans[4].closest('[role="button"]') as HTMLElement;
    expect(day5Cell.querySelectorAll('[role="button"]').length).toBe(3);
    expect(day5Cell.textContent).toContain("+2");
  });

  it("手机端单列列表：31 行有序、无事件日显示 noEvents、超过 4 条显示 +N", () => {
    const events = [1, 2, 3, 4, 5, 6].map((n) => makeEvent(`e${n}`, 5, 8 + n));
    const { mobileList } = renderMonth(events);
    const rows = Array.from(mobileList.children);
    expect(rows.length).toBe(31);
    const day5Row = rows[4] as HTMLElement;
    expect(within(day5Row).getAllByText(/事件e/).length).toBe(4);
    expect(day5Row.textContent).toContain("+2");
    const day6Row = rows[5] as HTMLElement;
    expect(within(day6Row).queryByText("事件e5")).toBeNull();
    expect(within(rows[6] as HTMLElement).getByText("calendar:noEvents")).toBeTruthy();
  });

  it("点击事件片触发 onEventClick 且不冒泡到 onDayClick", () => {
    const { desktopGrid, onEventClick, onDayClick } = renderMonth([makeEvent("e1", 5, 9)]);
    const daySpans = Array.from(desktopGrid.querySelectorAll("span[class*='rounded-full']"));
    const day5Cell = daySpans[4].closest('[role="button"]') as HTMLElement;
    const chip = within(day5Cell).getByText("事件e1").closest('[role="button"]') as HTMLElement;
    fireEvent.click(chip);
    expect(onEventClick).toHaveBeenCalledTimes(1);
    expect(onEventClick).toHaveBeenCalledWith(expect.objectContaining({ id: "e1" }));
    expect(onDayClick).not.toHaveBeenCalled();
  });

  it("任务 deadline 事件渲染告警色与 CheckCircle2 图标（source=task 优先于 color 字段）", () => {
    const taskEvent = makeEvent("task-1", 5, 9, {
      source: "task",
      taskId: "t-1",
      color: "var(--accent)",
    });
    const { desktopGrid } = renderMonth([taskEvent]);
    const chip = desktopGrid.querySelector('[role="button"][class*="truncate"]') as HTMLElement;
    expect(chip).toBeTruthy();
    expect(chip.querySelector("svg")).toBeTruthy();
    expect(chip.getAttribute("style")).toContain("color: var(--warn)");
    expect(chip.getAttribute("style")).toContain(
      "color-mix(in srgb, var(--warn) 20%, var(--surface))",
    );
  });

  it("普通事件颜色取事件 color 字段、缺省回退 var(--accent)", () => {
    const colored = makeEvent("c1", 5, 9, { color: "var(--danger)" });
    const plain = makeEvent("c2", 6, 9);
    const { desktopGrid } = renderMonth([colored, plain]);
    const chips = Array.from(desktopGrid.querySelectorAll('[role="button"][class*="truncate"]'));
    const coloredChip = chips.find((el) => el.textContent?.includes("事件c1")) as HTMLElement;
    const plainChip = chips.find((el) => el.textContent?.includes("事件c2")) as HTMLElement;
    expect(coloredChip.getAttribute("style")).toContain("color: var(--danger)");
    expect(plainChip.getAttribute("style")).toContain("color: var(--accent)");
  });

  it("今天日期数字带强调色背景（currentDate 落在当前月）", () => {
    const today = new Date();
    const { desktopGrid } = renderMonth([], { currentDate: today });
    const highlighted = desktopGrid.querySelector("span[style*='background: var(--accent)']");
    expect(highlighted).toBeTruthy();
    expect(highlighted?.textContent).toBe(String(today.getDate()));
  });
});
