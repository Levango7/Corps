// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  createGoogleEvent,
  deleteGoogleEvent,
  getPrimaryCalendarId,
  updateGoogleEvent,
} from "@/lib/calendar/google-client";

/**
 * Google Calendar 客户端契约（lib/calendar/google-client.ts）：
 *  - 全天事件的日期语义：start.date = 截止日（YYYY-MM-DD），**end.date = 次日**
 *    （Google 全天事件 end 是排他日期；少加一天会变半天事件）
 *  - 提醒：传入 reminderMinutes → useDefault:false + popup overrides；不传 → useDefault:true
 *  - 各端点方法与 URL；非 2xx 抛含状态码的错
 *  - deleteXxx 对 **404 视为已删除不抛**（幂等语义）
 *  - 所有请求带 Bearer 头
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
  it("GET /calendars/primary + Bearer，返回 json.id", async () => {
    fetchMock.mockResolvedValue(jsonRes({ id: "primary-cal" }));
    await expect(getPrimaryCalendarId("tok")).resolves.toBe("primary-cal");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://www.googleapis.com/calendar/v3/calendars/primary");
    expect((init as RequestInit).headers).toEqual({ Authorization: "Bearer tok" });
  });

  it("非 2xx 抛含状态码的错", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 401 }));
    await expect(getPrimaryCalendarId("tok")).rejects.toThrow(/获取 Google 主日历失败 \(401\)/);
  });
});

describe("createGoogleEvent：全天事件请求体", () => {
  const opts = {
    title: "交付 v1",
    dueDate: "2026-11-05T09:30:00.000Z",
    taskUrl: "https://app.corps.test/t/1",
    reminderMinutes: [1440, 60],
  };

  it("POST 到指定日历；start.date=截止日、end.date=次日（排他）；提醒为 popup overrides", async () => {
    fetchMock.mockResolvedValue(jsonRes({ id: "ev-1" }));
    const id = await createGoogleEvent("tok", "cal-1", opts);
    expect(id).toBe("ev-1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://www.googleapis.com/calendar/v3/calendars/cal-1/events");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.summary).toBe("交付 v1");
    expect(body.description).toContain("https://app.corps.test/t/1");
    expect(body.start).toEqual({ date: "2026-11-05" });
    expect(body.end).toEqual({ date: "2026-11-06" }); // 次日（排他）
    expect(body.reminders).toEqual({
      useDefault: false,
      overrides: [
        { method: "popup", minutes: 1440 },
        { method: "popup", minutes: 60 },
      ],
    });
    // 描述不含任务正文（隐私约束）——夹具里本就没有正文，此断言只防将来顺手塞入
    expect(body.description).not.toMatch(/\n/);
  });

  it("不传 reminderMinutes：useDefault:true（沿用用户日历默认提醒）", async () => {
    fetchMock.mockResolvedValue(jsonRes({ id: "ev-2" }));
    await createGoogleEvent("tok", "cal-1", { ...opts, reminderMinutes: undefined });
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.reminders).toEqual({ useDefault: true });
  });

  it("非 2xx：抛错并附响应文本", async () => {
    fetchMock.mockResolvedValue(new Response("rate limited", { status: 429 }));
    await expect(createGoogleEvent("tok", "c", opts)).rejects.toThrow(
      /创建 Google 事件失败 \(429\): rate limited/,
    );
  });
});

describe("updateGoogleEvent / deleteGoogleEvent", () => {
  const opts = {
    title: "T",
    dueDate: "2026-11-05T00:00:00.000Z",
    taskUrl: "u",
  };

  it("update：PUT 到事件 URL", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    await updateGoogleEvent("tok", "cal-1", "ev-1", opts);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://www.googleapis.com/calendar/v3/calendars/cal-1/events/ev-1");
    expect((init as RequestInit).method).toBe("PUT");
  });

  it("delete：DELETE；**404 视为已删除不抛**（幂等）；其他错误抛", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(deleteGoogleEvent("tok", "cal-1", "ev-1")).resolves.toBeUndefined();

    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    await expect(deleteGoogleEvent("tok", "cal-1", "ev-1")).rejects.toThrow(
      /删除 Google 事件失败 \(500\): boom/,
    );
  });
});
