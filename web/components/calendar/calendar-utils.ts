import type { CalendarEvent } from "./CalendarEventDialog";

/** 判断事件是否在某一天（与该天有交集） */
export function isEventOnDate(event: CalendarEvent, date: Date): boolean {
  const eventStart = new Date(event.startAt);
  const eventEnd = new Date(event.endAt);
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  return eventStart < dayEnd && eventEnd > dayStart;
}

/** 获取某一天的所有事件，按 startAt 升序 */
export function getEventsOnDate(events: CalendarEvent[], date: Date): CalendarEvent[] {
  return events
    .filter((e) => isEventOnDate(e, date))
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
}

/** 获取事件颜色样式：优先用事件 color 字段，否则用 var(--accent) */
export function getEventColor(event: CalendarEvent): string {
  return event.color || "var(--accent)";
}

/** 格式化时间为 HH:mm */
export function formatTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 判断两个日期是否同一天 */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** 获取某周的 7 天（周日开始） */
export function getWeekDays(date: Date): Date[] {
  const dayOfWeek = date.getDay();
  const sunday = new Date(date);
  sunday.setDate(date.getDate() - dayOfWeek);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i);
    return d;
  });
}

/** 月份导航 */
export function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, date.getDate());
}

/** 周导航 */
export function addWeeks(date: Date, weeks: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + weeks * 7);
  return d;
}

/** 日导航 */
export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** 格式化日期范围用于 API 查询 */
export function toISOString(date: Date): string {
  return date.toISOString();
}