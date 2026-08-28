/**
 * Outlook (Microsoft Graph) Calendar API 客户端：创建/更新/删除事件 + 获取默认日历。
 *
 * 设计：
 *  - 使用 Microsoft Graph v1.0 端点
 *  - 事件标题 = 任务标题
 *  - 事件时间 = 任务截止日期（全天事件）
 *  - 事件描述 = 任务链接（不含任务正文，遵循数据隐私约束）
 *  - 提醒：默认 1 天 + 1 小时（由调用方传入）
 */

import { getProviderConfig } from "./config";

/** Microsoft Graph 事件请求体 */
interface OutlookCalendarEvent {
  subject: string;
  body?: { contentType: "text" | "HTML"; content: string };
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  isAllDay: boolean;
  reminderMinutesBeforeStart?: number;
}

/** 创建事件选项（与 google-client 对齐） */
export interface CreateEventOptions {
  title: string;
  dueDate: string;
  taskUrl: string;
  reminderMinutes?: number[];
}

/** Microsoft Graph 事件响应 */
interface OutlookEventResponse {
  id: string;
}

/** 获取用户的默认日历（Graph /me/calendar） */
export async function getPrimaryCalendarId(accessToken: string): Promise<string> {
  const cfg = getProviderConfig("outlook");
  const res = await fetch(`${cfg.apiBaseUrl}/me/calendar`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`获取 Outlook 主日历失败 (${res.status})`);
  }
  const json = (await res.json()) as { id: string };
  return json.id;
}

/** 构造 Outlook 事件请求体（全天事件，UTC 时区避免歧义） */
function buildEventBody(opts: CreateEventOptions): OutlookCalendarEvent {
  const due = new Date(opts.dueDate);
  // 全天事件：start = 当天 00:00 UTC，end = 次日 00:00 UTC
  const startIso = new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate())).toISOString();
  const endIso = new Date(
    Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate() + 1),
  ).toISOString();

  // Outlook 单事件只支持一个 reminderMinutesBeforeStart；取最早的提醒
  const reminder = opts.reminderMinutes && opts.reminderMinutes.length > 0
    ? Math.min(...opts.reminderMinutes)
    : 1440; // 默认提前 1 天

  return {
    subject: opts.title,
    body: { contentType: "text", content: `任务截止日期 · ${opts.taskUrl}` },
    start: { dateTime: startIso, timeZone: "UTC" },
    end: { dateTime: endIso, timeZone: "UTC" },
    isAllDay: true,
    reminderMinutesBeforeStart: reminder,
  };
}

/** 在指定日历创建事件，返回事件 ID */
export async function createOutlookEvent(
  accessToken: string,
  calendarId: string,
  opts: CreateEventOptions,
): Promise<string> {
  const cfg = getProviderConfig("outlook");
  const body = buildEventBody(opts);
  const res = await fetch(`${cfg.apiBaseUrl}/me/calendars/${calendarId}/events`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`创建 Outlook 事件失败 (${res.status}): ${errText}`);
  }
  const json = (await res.json()) as OutlookEventResponse;
  return json.id;
}

/** 更新指定事件 */
export async function updateOutlookEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  opts: CreateEventOptions,
): Promise<void> {
  const cfg = getProviderConfig("outlook");
  const body = buildEventBody(opts);
  const res = await fetch(`${cfg.apiBaseUrl}/me/calendars/${calendarId}/events/${eventId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`更新 Outlook 事件失败 (${res.status}): ${errText}`);
  }
}

/** 删除指定事件 */
export async function deleteOutlookEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  const cfg = getProviderConfig("outlook");
  const res = await fetch(`${cfg.apiBaseUrl}/me/calendars/${calendarId}/events/${eventId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  // 404 视为已删除
  if (!res.ok && res.status !== 404) {
    const errText = await res.text().catch(() => "");
    throw new Error(`删除 Outlook 事件失败 (${res.status}): ${errText}`);
  }
}