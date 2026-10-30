// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  createOutlookEvent,
  deleteOutlookEvent,
  getPrimaryCalendarId,
  updateOutlookEvent,
} from "@/lib/calendar/outlook-client";

/**
 * Outlook (Microsoft Graph) 日历客户端契约（lib/calendar/outlook-client.ts）：
 *  - 全天事件：isAllDay:true + start/end 为 UTC 当日 00:00 与次日 00:00（UTC 时区显式）
 *  - **单个 reminderMinutesBeforeStart**：多提醒取最小值（最早），不传默认 1440（提前 1 天）
 *  - body.content 含任务链接、text 类型
 *  - 删除：404 视为已删除不抛（幂等）
 */
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("getPrimaryCalendarId", () => {
  it("GET /me/calendar + Bearer，返回 json.id", async () => {
    fetchMock.mockResolvedValue(jsonRes({ id: "outlook-primary" }));
    await expect(getPrimaryCalendarId("tok")).resolves.toBe("outlook-primary");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://graph.microsoft.com/v1.0/me/calendar");
    expect((init as RequestInit).headers).toEqual({ Authorization: "Bearer tok" });
  });

  it("非 2xx 抛含状态码的错", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 403 }));
    await expect(getPrimaryCalendarId("tok")).rejects.toThrow(/获取 Outlook 主日历失败 \(403\)/);
  });
});

describe("createOutlookEvent：全天事件请求体", () => {
  const opts = {
    title: "评审会",
    dueDate: "2026-11-05T18:45:00.000Z", // 任意时刻 → 归一到 UTC 当日 00:00
    taskUrl: "https://app.corps.test/t/2",
    reminderMinutes: [1440, 60],
  };

  it("isAllDay + UTC 00:00 起、次日 00:00 止；多提醒取最小（最早）；text 类型正文", async () => {
    fetchMock.mockResolvedValue(jsonRes({ id: "oev-1" }));
    const id = await createOutlookEvent("tok", "cal-9", opts);
    expect(id).toBe("oev-1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://graph.microsoft.com/v1.0/me/calendars/cal-9/events");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.subject).toBe("评审会");
    expect(body.body).toEqual({
      contentType: "text",
      content: expect.stringContaining("https://app.corps.test/t/2"),
    });
    expect(body.isAllDay).toBe(true);
    expect(body.start).toEqual({ dateTime: "2026-11-05T00:00:00.000Z", timeZone: "UTC" });
    expect(body.end).toEqual({ dateTime: "2026-11-06T00:00:00.000Z", timeZone: "UTC" });
    expect(body.reminderMinutesBeforeStart).toBe(60); // min(1440, 60)
  });

  it("不传 reminderMinutes：默认 1440（提前 1 天）", async () => {
    fetchMock.mockResolvedValue(jsonRes({ id: "oev-2" }));
    await createOutlookEvent("tok", "c", { ...opts, reminderMinutes: undefined });
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.reminderMinutesBeforeStart).toBe(1440);
  });
});

describe("updateOutlookEvent / deleteOutlookEvent", () => {
  const opts = { title: "T", dueDate: "2026-11-05T00:00:00.000Z", taskUrl: "u" };

  it("update：PATCH 到事件 URL", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    await updateOutlookEvent("tok", "cal-9", "oev-1", opts);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://graph.microsoft.com/v1.0/me/calendars/cal-9/events/oev-1");
    expect((init as RequestInit).method).toBe("PATCH");
  });

  it("delete：DELETE；404 视为已删除不抛；500 抛", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(deleteOutlookEvent("tok", "c", "e")).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    await expect(deleteOutlookEvent("tok", "c", "e")).rejects.toThrow(
      /删除 Outlook 事件失败 \(500\): boom/,
    );
  });
});
