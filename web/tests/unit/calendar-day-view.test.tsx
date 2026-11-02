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

import { CalendarDay } from "@/components/calendar/CalendarDay";
import type { CalendarEvent } from "@/components/calendar/CalendarEventDialog";

/** 本地时间构造事件（组件按本地小时槽归属判断），时区无关 */
function makeEvent(id: string, hour: number, minute = 0, extra: Partial<CalendarEvent> = {}) {
  const start = new Date(2026, 9, 1, hour, minute);
  const end = new Date(2026, 9, 1, hour + 1, minute);
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

const CURRENT = new Date(2026, 9, 1);

function renderDay(events: CalendarEvent[], overrides: { currentDate?: Date } = {}) {
  const onPrev = vi.fn();
  const onNext = vi.fn();
  const onToday = vi.fn();
  const onEventClick = vi.fn();
  const { container } = render(
    <CalendarDay
      events={events}
      currentDate={overrides.currentDate ?? CURRENT}
      onPrev={onPrev}
      onNext={onNext}
      onToday={onToday}
      onEventClick={onEventClick}
    />,
  );
  const rows = Array.from(container.querySelectorAll('[class*="min-h-[48px]"]'));
  return { container, rows, onPrev, onNext, onToday, onEventClick };
}

afterEach(() => {
  cleanup();
  h.locale = "en";
  vi.restoreAllMocks();
});

describe("CalendarDay", () => {
  it("en-US 下标题为长格式日期，并按 locale 切换 zh-CN 格式", () => {
    const { container } = renderDay([]);
    expect(container.querySelector("h2")?.textContent).toBe("October 1, 2026");
    cleanup();
    h.locale = "zh";
    const second = renderDay([]);
    expect(second.container.querySelector("h2")?.textContent).toBe("2026年10月1日");
  });

  it("渲染 24 小时时间轴：00:00～23:00 整点标签", () => {
    const { rows } = renderDay([]);
    expect(rows.length).toBe(24);
    const labels = rows.map((row) => (row.firstElementChild as HTMLElement).textContent);
    expect(labels[0]).toBe("00:00");
    expect(labels[9]).toBe("09:00");
    expect(labels[23]).toBe("23:00");
  });

  it("导航按钮回调：previous/next day aria-label 与 today 文案均触发回调", () => {
    const { onPrev, onNext, onToday } = renderDay([]);
    fireEvent.click(screen.getByLabelText("previous day"));
    fireEvent.click(screen.getByLabelText("next day"));
    fireEvent.click(screen.getByText("calendar:today"));
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onToday).toHaveBeenCalledTimes(1);
  });

  it("事件按开始小时落入对应行（09:30 事件在 09:00 行）", () => {
    const { rows } = renderDay([makeEvent("e1", 9, 30)]);
    const hour9Slot = rows[9].children[1] as HTMLElement;
    expect(within(hour9Slot).getByText("事件e1")).toBeTruthy();
    const hour10Slot = rows[10].children[1] as HTMLElement;
    expect(within(hour10Slot).queryByText("事件e1")).toBeNull();
  });

  it("事件片显示时间区间，且有地点时追加 · 地点", () => {
    const { rows } = renderDay([
      makeEvent("plain", 9, 0),
      makeEvent("loc", 10, 0, { location: "会议室A" }),
    ]);
    const chip0 = within(rows[9].children[1] as HTMLElement)
      .getByText("事件plain")
      .closest("div")?.parentElement as HTMLElement;
    expect(chip0.textContent).toContain("09:00 - 10:00");
    expect(chip0.textContent).not.toContain("·");
    const chip1 = within(rows[10].children[1] as HTMLElement)
      .getByText("事件loc")
      .closest("div")?.parentElement as HTMLElement;
    expect(chip1.textContent).toContain("10:00 - 11:00 · 会议室A");
  });

  it("全天事件不显示时间行", () => {
    const { rows } = renderDay([makeEvent("allday", 9, 0, { allDay: true })]);
    const chip = within(rows[9].children[1] as HTMLElement)
      .getByText("事件allday")
      .closest("div")?.parentElement as HTMLElement;
    expect(chip.textContent).toBe("事件allday");
  });

  it("任务 deadline 事件渲染 CheckCircle2 图标与告警色左边框", () => {
    const { rows } = renderDay([makeEvent("task-1", 9, 0, { source: "task", taskId: "t-1" })]);
    const slot = rows[9].children[1] as HTMLElement;
    const titleDiv = within(slot).getByText("事件task-1").closest("div") as HTMLElement;
    const chip = titleDiv.parentElement as HTMLElement;
    expect(titleDiv.querySelector("svg")).toBeTruthy();
    expect(chip.getAttribute("style")).toContain("border-left: 3px solid var(--warn)");
    expect(chip.getAttribute("style")).toContain(
      "color-mix(in srgb, var(--warn) 15%, var(--surface))",
    );
  });

  it("普通事件无 color 字段时回退强调色边框", () => {
    const { rows } = renderDay([makeEvent("c1", 9, 0)]);
    const chip = within(rows[9].children[1] as HTMLElement)
      .getByText("事件c1")
      .closest("div")?.parentElement as HTMLElement;
    expect(chip.getAttribute("style")).toContain("border-left: 3px solid var(--accent)");
  });

  it("无事件时显示 noEvents 居中提示，且不渲染任何事件片", () => {
    const { container, rows } = renderDay([]);
    expect(container.textContent).toContain("calendar:noEvents");
    const chips = rows.filter((row) => (row.children[1] as HTMLElement).children.length > 0);
    expect(chips.length).toBe(0);
  });

  it("点击事件片触发 onEventClick（携带事件对象）", () => {
    const { rows, onEventClick } = renderDay([makeEvent("e1", 9, 0)]);
    const chip = within(rows[9].children[1] as HTMLElement)
      .getByText("事件e1")
      .closest("div")?.parentElement as HTMLElement;
    fireEvent.click(chip);
    expect(onEventClick).toHaveBeenCalledWith(expect.objectContaining({ id: "e1" }));
  });

  it("今天是当前日期时标题用强调色，否则用前景色", () => {
    const { container } = renderDay([]);
    expect(container.querySelector("h2")?.getAttribute("style")).toContain("color: var(--fg)");
    cleanup();
    const today = renderDay([], { currentDate: new Date() });
    expect(today.container.querySelector("h2")?.getAttribute("style")).toContain(
      "color: var(--accent)",
    );
  });
});
