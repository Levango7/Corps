// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const h = vi.hoisted(() => ({
  locale: "en",
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
  return { useTranslations, useLocale: () => h.locale };
});

import { CalendarWeek } from "@/components/calendar/CalendarWeek";
import type { CalendarEvent } from "@/components/calendar/CalendarEventDialog";

/** 本地时间构造事件（组件按本地日线段归属判断），时区无关 */
function makeEvent(
  id: string,
  day: number,
  hour: number,
  extra: Partial<CalendarEvent> = {},
  month = 9,
) {
  const start = new Date(2026, month, day, hour, 0);
  const end = new Date(2026, month, day, hour + 1, 0);
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

/** 周视图固定测试周：2026-09-27（周日）～ 2026-10-03（周六），currentDate 取 10-01（周四） */
const CURRENT = new Date(2026, 9, 1);

function renderWeek(events: CalendarEvent[], overrides: { currentDate?: Date } = {}) {
  const onPrev = vi.fn();
  const onNext = vi.fn();
  const onToday = vi.fn();
  const onEventClick = vi.fn();
  const { container } = render(
    <CalendarWeek
      events={events}
      currentDate={overrides.currentDate ?? CURRENT}
      onPrev={onPrev}
      onNext={onNext}
      onToday={onToday}
      onEventClick={onEventClick}
    />,
  );
  const desktopGrid = container.querySelector('[class*="grid-cols-7"]') as HTMLElement;
  const mobilePane = container.querySelector('[class*="sm:hidden"]') as HTMLElement;
  return { container, desktopGrid, mobilePane, onPrev, onNext, onToday, onEventClick };
}

afterEach(() => {
  cleanup();
  h.locale = "en";
  vi.restoreAllMocks();
});

describe("CalendarWeek", () => {
  it("en-US 下标题为完整周区间，并按 locale 切换 zh-CN 格式", () => {
    const { desktopGrid } = renderWeek([]);
    const title = desktopGrid.parentElement?.querySelector("h2");
    expect(title?.textContent).toBe("September 27, 2026 - October 3");
    cleanup();
    h.locale = "zh";
    const second = renderWeek([]);
    const zhTitle = second.desktopGrid.parentElement?.querySelector("h2");
    expect(zhTitle?.textContent).toBe("2026年9月27日 - 10月3日");
  });

  it("桌面 7 列：星期标题有序、日期数字正确（周日为一周起点）", () => {
    const { desktopGrid } = renderWeek([]);
    const columns = Array.from(desktopGrid.children);
    expect(columns.length).toBe(7);
    const headers = columns.map(
      (col) => (col.firstElementChild as HTMLElement)?.firstElementChild?.textContent,
    );
    expect(headers).toEqual([
      "calendar:sunday",
      "calendar:monday",
      "calendar:tuesday",
      "calendar:wednesday",
      "calendar:thursday",
      "calendar:friday",
      "calendar:saturday",
    ]);
    const dates = columns.map(
      (col) => (col.firstElementChild as HTMLElement)?.children[1]?.textContent,
    );
    expect(dates).toEqual(["27", "28", "29", "30", "1", "2", "3"]);
  });

  it("导航按钮回调：prevWeek/nextWeek aria-label 与 today 文案均触发回调", () => {
    const { onPrev, onNext, onToday } = renderWeek([]);
    fireEvent.click(screen.getByLabelText("calendar:prevWeek"));
    fireEvent.click(screen.getByLabelText("calendar:nextWeek"));
    fireEvent.click(screen.getByText("calendar:today"));
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onToday).toHaveBeenCalledTimes(1);
  });

  it("事件落在正确的列，且空列显示 noEvents", () => {
    const { desktopGrid } = renderWeek([makeEvent("e1", 1, 9)]);
    const columns = Array.from(desktopGrid.children);
    const thursday = columns[4] as HTMLElement;
    expect(within(thursday).getByText("事件e1")).toBeTruthy();
    const sunday = columns[0] as HTMLElement;
    expect(within(sunday).getByText("calendar:noEvents")).toBeTruthy();
  });

  it("同一天多条事件按开始时间升序排列", () => {
    const events = [makeEvent("late", 2, 10), makeEvent("early", 2, 7), makeEvent("mid", 2, 8)];
    const { desktopGrid } = renderWeek(events);
    // 固定周列序：0=周日 9/27 … 4=周四 10/1、5=周五 10/2、6=周六 10/3
    const friday = Array.from(desktopGrid.children)[5] as HTMLElement;
    const eventList = friday.children[1] as HTMLElement; // 列内第二个子 div = 事件列表
    const chipTexts = Array.from(eventList.children).map((el) => el.textContent ?? "");
    // 排序后 DOM 顺序应为 07:00 early、08:00 mid、10:00 late
    expect(chipTexts[0]).toMatch(/^事件early/);
    expect(chipTexts[1]).toMatch(/^事件mid/);
    expect(chipTexts[2]).toMatch(/^事件late/);
  });

  it("事件片显示时间区间（HH:mm - HH:mm），全天事件不显示时间", () => {
    const events = [
      makeEvent("timed", 1, 9, { allDay: false }),
      makeEvent("allday", 2, 0, { allDay: true }),
    ];
    const { desktopGrid } = renderWeek(events);
    const columns = Array.from(desktopGrid.children);
    const timedChip = within(columns[4] as HTMLElement)
      .getByText("事件timed")
      .closest("div")?.parentElement as HTMLElement;
    expect(timedChip.textContent).toContain("09:00 - 10:00");
    const alldayChip = within(columns[5] as HTMLElement)
      .getByText("事件allday")
      .closest("div")?.parentElement as HTMLElement;
    expect(alldayChip.textContent).toBe("事件allday");
  });

  it("任务 deadline 事件渲染 CheckCircle2 图标与告警色左边框", () => {
    const taskEvent = makeEvent("task-1", 1, 9, { source: "task", taskId: "t-1" });
    const { desktopGrid } = renderWeek([taskEvent]);
    const thursday = Array.from(desktopGrid.children)[4] as HTMLElement;
    const titleDiv = within(thursday).getByText("事件task-1").closest("div") as HTMLElement;
    const chip = titleDiv.parentElement as HTMLElement;
    expect(titleDiv.querySelector("svg")).toBeTruthy();
    expect(chip.getAttribute("style")).toContain("border-left: 3px solid var(--warn)");
    expect(chip.getAttribute("style")).toContain(
      "color-mix(in srgb, var(--warn) 15%, var(--surface))",
    );
  });

  it("手机端默认定位到今天（本周内），否则回退首日；标签为 星期·M/D", () => {
    const today = new Date();
    const { mobilePane } = renderWeek([], { currentDate: today });
    const label = mobilePane.querySelector("span")?.textContent ?? "";
    const expectedIdx = today.getDay();
    const weekHeaders = [
      "calendar:sunday",
      "calendar:monday",
      "calendar:tuesday",
      "calendar:wednesday",
      "calendar:thursday",
      "calendar:friday",
      "calendar:saturday",
    ];
    expect(label).toContain(weekHeaders[expectedIdx]);
    expect(label).toContain(`${today.getMonth() + 1}/${today.getDate()}`);
    cleanup();
  });

  it("手机端固定周（不含今天）默认显示周日，prev 禁用；next 切到下一天，到周六后 next 禁用", () => {
    const { mobilePane, desktopGrid } = renderWeek([]);
    const prevBtn = screen.getByLabelText("calendar:prevDayInWeek");
    const nextBtn = screen.getByLabelText("calendar:nextDayInWeek");
    expect(prevBtn).toHaveProperty("disabled", true);
    expect(nextBtn).toHaveProperty("disabled", false);
    expect(mobilePane.querySelector("span")?.textContent).toContain("calendar:sunday · 9/27");
    fireEvent.click(nextBtn);
    expect(
      desktopGrid.parentElement?.querySelector('[class*="sm:hidden"] span')?.textContent,
    ).toContain("calendar:monday · 9/28");
    // 快进到周六
    for (let i = 0; i < 5; i++) fireEvent.click(nextBtn);
    const nextBtnAfter = screen.getByLabelText("calendar:nextDayInWeek") as HTMLButtonElement;
    expect(nextBtnAfter.disabled).toBe(true);
  });

  it("手机端当天事件列表：渲染该日事件且点击触发 onEventClick", () => {
    const { mobilePane, onEventClick } = renderWeek([makeEvent("m1", 28, 9, {}, 8)]);
    // 默认周日（9/27）无事件 → noEvents
    expect(within(mobilePane).getByText("calendar:noEvents")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("calendar:nextDayInWeek"));
    const chip = within(mobilePane).getByText("事件m1").closest("div") as HTMLElement;
    fireEvent.click(chip);
    expect(onEventClick).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }));
  });

  it("今天所在列日期数字带强调色背景（currentDate 为今天所在周）", () => {
    const today = new Date();
    const { desktopGrid } = renderWeek([], { currentDate: today });
    const highlighted = desktopGrid.querySelector("div[style*='background: var(--accent)']");
    expect(highlighted).toBeTruthy();
    expect(highlighted?.textContent).toBe(String(today.getDate()));
  });
});
