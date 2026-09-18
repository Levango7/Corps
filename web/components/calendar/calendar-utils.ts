import type { CalendarEvent } from "./CalendarEventDialog";

/**
 * 任务摘要（仅包含日历联动所需字段，与 GET /tasks 返回的 item 子集对齐）。
 * dueDate 为 null 时不生成虚拟事件。
 */
export interface TaskSummary {
  id: string;
  title: string;
  dueDate: string | null;
  status: string;
}

/** 任务截止日期在日历上的标识色（警告色，区别于普通事件的强调色） */
export const TASK_DEADLINE_COLOR = "var(--warn)";

/** 任务 deadline 虚拟事件 ID 前缀（避免与真实事件 UUID 冲突） */
export const TASK_EVENT_ID_PREFIX = "task:";

/** 判断一个事件是否为任务 deadline 虚拟事件 */
export function isTaskDeadline(event: CalendarEvent): boolean {
  return event.source === "task";
}

/**
 * 将带截止日期的任务转换为日历虚拟事件。
 * - 起止时间：dueDate 当天 09:00-10:00（占位时段，便于在时间轴上显示）
 * - color：用 --warn 警告色，区别于普通事件
 * - source/taskId：标记为任务联动，子视图据此跳转任务详情页
 * dueDate 为 null 时返回 null（不生成虚拟事件）。
 */
export function taskToCalendarEvent(task: TaskSummary): CalendarEvent | null {
  if (!task.dueDate) return null;
  const due = new Date(task.dueDate);
  const startAt = new Date(due.getFullYear(), due.getMonth(), due.getDate(), 9, 0, 0);
  const endAt = new Date(due.getFullYear(), due.getMonth(), due.getDate(), 10, 0, 0);
  return {
    id: `${TASK_EVENT_ID_PREFIX}${task.id}`,
    title: task.title,
    description: null,
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    allDay: false,
    location: null,
    color: TASK_DEADLINE_COLOR,
    createdBy: "",
    createdAt: startAt.toISOString(),
    updatedAt: startAt.toISOString(),
    source: "task",
    taskId: task.id,
  };
}

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

/** 获取事件颜色样式：任务 deadline 用警告色，否则优先用事件 color 字段，兜底 var(--accent) */
export function getEventColor(event: CalendarEvent): string {
  if (isTaskDeadline(event)) return TASK_DEADLINE_COLOR;
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