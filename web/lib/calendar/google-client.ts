/**
 * Google Calendar API 客户端：创建/更新/删除事件 + 获取默认日历。
 *
 * 设计：
 *  - 事件标题 = 任务标题
 *  - 事件时间 = 任务截止日期（全天事件，避免时区歧义）
 *  - 事件描述 = 任务链接（不含任务正文，遵循数据隐私约束）
 *  - 提醒：默认 1 天 + 1 小时（由调用方传入）
 */

import { getProviderConfig } from "./config";

/** Google Calendar 事件创建/更新请求体 */
interface GoogleCalendarEvent {
  summary: string;
  description?: string;
  start: { date?: string; dateTime?: string; timeZone?: string };
  end: { date?: string; dateTime?: string; timeZone?: string };
  reminders?: {
    useDefault: boolean;
    overrides?: Array<{ method: "popup" | "email"; minutes: number }>;
  };
}

/** 创建事件选项 */
export interface CreateEventOptions {
  /** 任务标题 */
  title: string;
  /** 任务截止日期（ISO 字符串） */
  dueDate: string;
  /** 任务链接（描述中包含） */
  taskUrl: string;
  /** 提醒分钟数列表（如 [1440, 60] 表示提前 1 天 + 1 小时） */
  reminderMinutes?: number[];
}

/** Google Calendar 事件响应 */
interface GoogleCalendarEventResponse {
  id: string;
  htmlLink?: string;
}

/** 获取用户的默认（primary）日历 ID */
export async function getPrimaryCalendarId(accessToken: string): Promise<string> {
  const cfg = getProviderConfig("google");
  const res = await fetch(`${cfg.apiBaseUrl}/calendars/primary`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`获取 Google 主日历失败 (${res.status})`);
  }
  const json = (await res.json()) as { id: string };
  return json.id;
}

/** 构造 Google Calendar 事件请求体（全天事件） */
function buildEventBody(opts: CreateEventOptions): GoogleCalendarEvent {
  // 截止日期转 YYYY-MM-DD（全天事件，避免时区歧义）
  const due = new Date(opts.dueDate);
  const dateStr = due.toISOString().slice(0, 10);
  // 次日作为结束日期（Google 全天事件 end 是排他日期）
  const endDate = new Date(due.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const reminders =
    opts.reminderMinutes && opts.reminderMinutes.length > 0
      ? {
          useDefault: false,
          overrides: opts.reminderMinutes.map((m) => ({ method: "popup" as const, minutes: m })),
        }
      : { useDefault: true };

  return {
    summary: opts.title,
    description: `任务截止日期 · ${opts.taskUrl}`,
    start: { date: dateStr },
    end: { date: endDate },
    reminders,
  };
}

/** 在指定日历创建事件，返回事件 ID */
export async function createGoogleEvent(
  accessToken: string,
  calendarId: string,
  opts: CreateEventOptions,
): Promise<string> {
  const cfg = getProviderConfig("google");
  const body = buildEventBody(opts);
  const res = await fetch(`${cfg.apiBaseUrl}/calendars/${calendarId}/events`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`创建 Google 事件失败 (${res.status}): ${errText}`);
  }
  const json = (await res.json()) as GoogleCalendarEventResponse;
  return json.id;
}

/** 更新指定事件 */
export async function updateGoogleEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  opts: CreateEventOptions,
): Promise<void> {
  const cfg = getProviderConfig("google");
  const body = buildEventBody(opts);
  const res = await fetch(`${cfg.apiBaseUrl}/calendars/${calendarId}/events/${eventId}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`更新 Google 事件失败 (${res.status}): ${errText}`);
  }
}

/** 删除指定事件 */
export async function deleteGoogleEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  const cfg = getProviderConfig("google");
  const res = await fetch(`${cfg.apiBaseUrl}/calendars/${calendarId}/events/${eventId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  // 404 视为已删除，不抛错
  if (!res.ok && res.status !== 404) {
    const errText = await res.text().catch(() => "");
    throw new Error(`删除 Google 事件失败 (${res.status}): ${errText}`);
  }
}
