import { describe, it, expect, beforeAll } from "vitest";
import { BASE, registerUser, authHeader } from "../helpers";

/**
 * 工作区公告 API 集成测试（/workspaces/{wid}/announcements 与 /announcements/{aid}）
 *
 * 覆盖：
 * 1. 创建公告（POST）— 默认值（type=info、pinned=false、targetAudience={type:"all"}）、400
 * 2. 查询（GET 列表 / GET 详情）— type/pinned 过滤、置顶优先排序、404
 * 3. 更新（PATCH）— 局部更新、404
 * 4. 删除（DELETE）— { id, deleted: true }，删除后详情 404
 * 5. 跨工作区隔离 — B 的 token 读不到 A 的公告（404）
 *
 * 契约：api/openapi.yaml 已声明这组路由（2026-10-25），本文件是其行为侧的钉子。
 */

let token: string;
let wid: string;
let otherToken: string;

const uuid = () => crypto.randomUUID();

async function createAnnouncement(body: Record<string, unknown>) {
  return fetch(`${BASE}/workspaces/${wid}/announcements`, {
    method: "POST",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const owner = await registerUser({
    prefix: "announce-owner",
    workspaceName: "公告测试工作区",
  });
  token = owner.accessToken;
  wid = owner.workspace.id;

  const other = await registerUser({ prefix: "announce-other" });
  otherToken = other.accessToken;
});

describe("创建公告 POST /announcements", () => {
  it("只填 title/content 创建成功，默认值齐全", async () => {
    const res = await createAnnouncement({ title: "例会通知", content: "周五下午三点" });
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.code).toBe(201);
    expect(json.data.title).toBe("例会通知");
    expect(json.data.type).toBe("info");
    expect(json.data.pinned).toBe(false);
    expect(json.data.targetAudience).toEqual({ type: "all" });
    expect(json.data.publishedAt).toBeDefined();
    expect(json.data.publisher.email).toContain("announce-owner");
  });

  it("显式 type 与 expiresAt 落库", async () => {
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const res = await createAnnouncement({
      title: "紧急维护",
      content: "今晚停机",
      type: "urgent",
      pinned: true,
      expiresAt,
    });
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.data.type).toBe("urgent");
    expect(json.data.pinned).toBe(true);
    expect(json.data.expiresAt).toBe(expiresAt);
  });

  it("title 超长返回 400", async () => {
    const res = await createAnnouncement({ title: "a".repeat(201), content: "x" });
    expect(res.status).toBe(400);
  });

  it("非法 type 返回 400", async () => {
    const res = await createAnnouncement({ title: "t", content: "c", type: "boom" });
    expect(res.status).toBe(400);
  });
});

describe("查询公告 GET /announcements", () => {
  it("列表返回分页信封", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/announcements`, {
      headers: authHeader(token),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toMatchObject({
      page: 1,
      limit: 50,
      total: expect.any(Number),
      hasMore: expect.any(Boolean),
    });
    expect(json.data.items.length).toBeGreaterThanOrEqual(2);
  });

  it("置顶公告排在最前", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/announcements`, {
      headers: authHeader(token),
    });
    const json = await res.json();

    expect(json.data.items[0].pinned).toBe(true);
    expect(json.data.items[0].title).toBe("紧急维护");
  });

  it("type=info 过滤后不含 urgent", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/announcements?type=info`, {
      headers: authHeader(token),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    for (const item of json.data.items) expect(item.type).toBe("info");
  });

  it("非法 type 过滤值返回 400", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/announcements?type=boom`, {
      headers: authHeader(token),
    });
    expect(res.status).toBe(400);
  });
});

describe("公告详情与更新 /announcements/{aid}", () => {
  it("不存在的 uuid 返回 404", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/announcements/${uuid()}`, {
      headers: authHeader(token),
    });
    expect(res.status).toBe(404);
  });

  it("PATCH 局部更新标题与置顶", async () => {
    const list = await (
      await fetch(`${BASE}/workspaces/${wid}/announcements?type=info`, {
        headers: authHeader(token),
      })
    ).json();
    const aid = list.data.items[0].id as string;

    const res = await fetch(`${BASE}/workspaces/${wid}/announcements/${aid}`, {
      method: "PATCH",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "例会通知（改期）", pinned: true }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.title).toBe("例会通知（改期）");
    expect(json.data.pinned).toBe(true);
  });

  it("PATCH 不存在的 uuid 返回 404", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/announcements/${uuid()}`, {
      method: "PATCH",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "查无此公告" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("删除与跨工作区隔离", () => {
  it("B 的 token 读 A 的公告返回 403（非成员先被工作区成员校验拦截，不泄漏存在性）", async () => {
    const list = await (
      await fetch(`${BASE}/workspaces/${wid}/announcements`, { headers: authHeader(token) })
    ).json();
    const aid = list.data.items[0].id as string;

    const res = await fetch(`${BASE}/workspaces/${wid}/announcements/${aid}`, {
      headers: authHeader(otherToken),
    });
    expect(res.status).toBe(403);
  });

  it("DELETE 返回 { id, deleted: true }，再读 404", async () => {
    const created = await (await createAnnouncement({ title: "待删除", content: "x" })).json();
    const aid = created.data.id as string;

    const del = await fetch(`${BASE}/workspaces/${wid}/announcements/${aid}`, {
      method: "DELETE",
      headers: authHeader(token),
    });
    const delJson = await del.json();

    expect(del.status).toBe(200);
    expect(delJson.data).toEqual({ id: aid, deleted: true });

    const followUp = await fetch(`${BASE}/workspaces/${wid}/announcements/${aid}`, {
      headers: authHeader(token),
    });
    expect(followUp.status).toBe(404);
  });
});
