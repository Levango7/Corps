import { describe, it, expect, beforeAll } from "vitest";
import { BASE, registerUser, authHeader } from "../helpers";

/**
 * 通知中心 API 集成测试（/workspaces/{wid}/notifications）
 *
 * 覆盖：
 * 1. 列表（GET）— 分页信封 { items, page, limit, total, hasMore }、默认 page=1/limit=50
 * 2. 未读计数（GET ?count=true）— data.unread 为数字，新工作区为 0
 * 3. 仅未读（GET ?unread=true）— 返回的每条 read 均为 false
 * 4. 参数校验 — limit=101 超出上限 400
 * 5. 标记已读（PATCH）— 既无 id 也无 all 时 400（notificationsNeedIdOrAll）；id 非 uuid 时 400
 * 6. PATCH {all:true} 在没有未读时 updatedCount=0（幂等，不虚报）
 * 7. 跨工作区隔离 — B 的 token 访问 A 的通知 403
 * 8. 未认证 — 不带 token 401
 *
 * 契约：api/openapi.yaml **尚未**声明该域（契约覆盖率是另一条单独的债），
 * 本文件钉的是实现侧行为，作为后续补声明时的行为依据。
 *
 * 说明：本文件不制造通知数据（通知由业务事件产生，测试里没有稳定触发点），
 * 因此断言集中在"信封形状 + 校验 + 隔离"这三类与数据量无关的契约上。
 */

let token: string;
let wid: string;
let otherToken: string;

const auth = () => ({ ...authHeader(token), "Content-Type": "application/json" });

beforeAll(async () => {
  const owner = await registerUser({
    prefix: "notif-owner",
    workspaceName: "通知测试工作区",
  });
  token = owner.accessToken;
  wid = owner.workspace.id;

  const other = await registerUser({ prefix: "notif-other" });
  otherToken = other.accessToken;
});

describe("GET /notifications", () => {
  it("默认返回分页信封，page=1 / limit=50", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/notifications`, {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.code).toBe(200);
    expect(Array.isArray(json.data.items)).toBe(true);
    expect(json.data.page).toBe(1);
    expect(json.data.limit).toBe(50);
    expect(typeof json.data.total).toBe("number");
    expect(typeof json.data.hasMore).toBe("boolean");
    // 新工作区没有通知：空列表与 total=0 必须一致，不能出现"有 items 但 total=0"
    expect(json.data.items.length).toBe(0);
    expect(json.data.total).toBe(0);
    expect(json.data.hasMore).toBe(false);
  });

  it("count=true 返回未读计数而不是列表", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/notifications?count=true`, {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveProperty("unread");
    expect(json.data.unread).toBe(0);
    // 计数模式下不应夹带列表字段
    expect(json.data.items).toBeUndefined();
  });

  it("unread=true 时返回的每条通知 read 均为 false", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/notifications?unread=true`, {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.data.items)).toBe(true);
    for (const item of json.data.items) {
      expect(item.read).toBe(false);
    }
  });

  it("limit=101 超过上限 100 时返回 400 而不是静默截断", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/notifications?limit=101`, {
      headers: authHeader(token),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe(400);
    expect(Array.isArray(json.errors)).toBe(true);
  });

  it("limit=0 同样是 400（下限 1）", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/notifications?limit=0`, {
      headers: authHeader(token),
    });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /notifications", () => {
  it("既无 id 也无 all → 400", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/notifications`, {
      method: "PATCH",
      headers: auth(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe(400);
    expect(typeof json.message).toBe("string");
    expect(json.message.length).toBeGreaterThan(0);
  });

  it("id 不是 uuid → 400 且带 errors", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/notifications`, {
      method: "PATCH",
      headers: auth(),
      body: JSON.stringify({ id: "not-a-uuid" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe(400);
    expect(Array.isArray(json.errors)).toBe(true);
  });

  it("all=true 在没有未读时 updatedCount=0（不虚报更新条数）", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/notifications`, {
      method: "PATCH",
      headers: auth(),
      body: JSON.stringify({ all: true }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.success).toBe(true);
    expect(json.data.updatedCount).toBe(0);
  });
});

describe("隔离与认证", () => {
  it("跨工作区：B 的 token 访问 A 的通知列表 403", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/notifications`, {
      headers: authHeader(otherToken),
    });
    expect(res.status).toBe(403);
  });

  it("跨工作区：B 也不能用 PATCH 改 A 的通知", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/notifications`, {
      method: "PATCH",
      headers: { ...authHeader(otherToken), "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    expect(res.status).toBe(403);
  });

  it("不带 token → 401", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/notifications`);
    expect(res.status).toBe(401);
  });
});
