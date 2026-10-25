import { describe, it, expect, beforeAll } from "vitest";
import { BASE, registerUser, authHeader } from "../helpers";

/**
 * 日历事件 API 集成测试（/workspaces/{wid}/calendar/events 与 /{eventId}）
 *
 * 覆盖：
 * 1. 创建事件（POST）— 默认值（allDay=false）、校验 400
 * 2. 查询（GET 列表 / GET 详情）— startAt 升序、时间窗过滤、信封不回显分页参数、404
 * 3. 更新（PATCH）— 局部更新、404
 * 4. 删除（DELETE）— { id, deleted: true }，删除后详情 404
 * 5. 跨工作区隔离 — B 的 token 读 A 的事件 403
 *
 * 契约：api/openapi.yaml 已声明该路由（2026-10-26 第二批），本文件是其行为侧的钉子。
 */

let token: string;
let wid: string;
let otherToken: string;

const uuid = () => crypto.randomUUID();
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

async function createEvent(body: Record<string, unknown>) {
  return fetch(`${BASE}/workspaces/${wid}/calendar/events`, {
    method: "POST",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const owner = await registerUser({
    prefix: "cal-owner",
    workspaceName: "日历测试工作区",
  });
  token = owner.accessToken;
  wid = owner.workspace.id;

  const other = await registerUser({ prefix: "cal-other" });
  otherToken = other.accessToken;
});

describe("创建事件 POST /calendar/events", () => {
  it("只填必填项创建成功，allDay 默认 false", async () => {
    const res = await createEvent({
      title: "周会",
      startAt: iso(3_600_000),
      endAt: iso(7_200_000),
    });
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.data.title).toBe("周会");
    expect(json.data.allDay).toBe(false);
    expect(json.data.createdBy).toBeDefined();
  });

  it("缺 startAt 返回 400", async () => {
    const res = await createEvent({ title: "无开始时间", endAt: iso(3_600_000) });
    expect(res.status).toBe(400);
  });

  it("title 超长返回 400", async () => {
    const res = await createEvent({
      title: "a".repeat(201),
      startAt: iso(0),
      endAt: iso(3_600_000),
    });
    expect(res.status).toBe(400);
  });
});

describe("查询事件 GET /calendar/events", () => {
  it("列表信封只有 items/total/hasMore（不回显分页参数）", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/calendar/events`, {
      headers: authHeader(token),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toMatchObject({ total: expect.any(Number), hasMore: expect.any(Boolean) });
    expect(Array.isArray(json.data.items)).toBe(true);
    expect("page" in json.data).toBe(false);
  });

  it("列表按 startAt 升序", async () => {
    await createEvent({ title: "晚的会", startAt: iso(86_400_000), endAt: iso(90_000_000) });
    await createEvent({ title: "早的会", startAt: iso(1_800_000), endAt: iso(5_400_000) });

    const json = await (
      await fetch(`${BASE}/workspaces/${wid}/calendar/events`, { headers: authHeader(token) })
    ).json();
    const times = json.data.items.map((e: { startAt: string }) => new Date(e.startAt).getTime());
    const sorted = [...times].sort((a, b) => a - b);
    expect(times).toEqual(sorted);
  });

  it("时间窗过滤只返回 startAt/endAt 都落在窗口内的事件", async () => {
    // 过滤语义：startAt >= start AND endAt <= end。造一条完整落在
    // [查询时 now, now+1h] 窗口内的事件，再混一条 endAt 出窗的对照。
    const now = Date.now();
    await createEvent({
      title: "窗内会",
      startAt: new Date(now + 10 * 60_000).toISOString(),
      endAt: new Date(now + 40 * 60_000).toISOString(),
    });
    await createEvent({
      title: "出窗会",
      startAt: new Date(now + 10 * 60_000).toISOString(),
      endAt: new Date(now + 90 * 60_000).toISOString(),
    });

    const json = await (
      await fetch(
        `${BASE}/workspaces/${wid}/calendar/events?start=${encodeURIComponent(new Date(now).toISOString())}&end=${encodeURIComponent(new Date(now + 3_600_000).toISOString())}`,
        { headers: authHeader(token) },
      )
    ).json();
    const titles = json.data.items.map((e: { title: string }) => e.title);
    expect(titles).toContain("窗内会");
    expect(titles).not.toContain("出窗会");
  });
});

describe("事件详情与更新 /calendar/events/{eventId}", () => {
  it("详情 200；不存在的 uuid 404", async () => {
    const list = await (
      await fetch(`${BASE}/workspaces/${wid}/calendar/events`, { headers: authHeader(token) })
    ).json();
    const eventId = list.data.items[0].id as string;

    const res = await fetch(`${BASE}/workspaces/${wid}/calendar/events/${eventId}`, {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);

    const missing = await fetch(`${BASE}/workspaces/${wid}/calendar/events/${uuid()}`, {
      headers: authHeader(token),
    });
    expect(missing.status).toBe(404);
  });

  it("PATCH 改标题成功；不存在的 uuid 404", async () => {
    const created = await (
      await createEvent({
        title: "待改会",
        startAt: iso(10_800_000),
        endAt: iso(14_400_000),
      })
    ).json();
    const eventId = created.data.id as string;

    const res = await fetch(`${BASE}/workspaces/${wid}/calendar/events/${eventId}`, {
      method: "PATCH",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "已改会", location: "3 号会议室" }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.title).toBe("已改会");
    expect(json.data.location).toBe("3 号会议室");

    const missing = await fetch(`${BASE}/workspaces/${wid}/calendar/events/${uuid()}`, {
      method: "PATCH",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "查无此会" }),
    });
    expect(missing.status).toBe(404);
  });
});

describe("删除与跨工作区隔离", () => {
  it("B 的 token 读 A 的事件返回 403（工作区隔离）", async () => {
    const list = await (
      await fetch(`${BASE}/workspaces/${wid}/calendar/events`, { headers: authHeader(token) })
    ).json();
    const eventId = list.data.items[0].id as string;

    const res = await fetch(`${BASE}/workspaces/${wid}/calendar/events/${eventId}`, {
      headers: authHeader(otherToken),
    });
    expect(res.status).toBe(403);
  });

  it("DELETE 返回 { id, deleted: true }，再读 404", async () => {
    const created = await (
      await createEvent({ title: "待删会", startAt: iso(20_000_000), endAt: iso(22_000_000) })
    ).json();
    const eventId = created.data.id as string;

    const del = await fetch(`${BASE}/workspaces/${wid}/calendar/events/${eventId}`, {
      method: "DELETE",
      headers: authHeader(token),
    });
    const delJson = await del.json();

    expect(del.status).toBe(200);
    expect(delJson.data).toEqual({ id: eventId, deleted: true });

    const followUp = await fetch(`${BASE}/workspaces/${wid}/calendar/events/${eventId}`, {
      headers: authHeader(token),
    });
    expect(followUp.status).toBe(404);
  });
});
