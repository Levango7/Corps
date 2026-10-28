import { describe, it, expect, beforeAll } from "vitest";
import { BASE, registerUser, authHeader } from "../helpers";

/**
 * 空间 API 集成测试（/workspaces/{wid}/spaces）
 *
 * 覆盖：
 * 1. 列表 — { items, total } 信封（不是分页 cursor 形式）
 * 2. 创建 — 201；name 空 400；name 超长（>100）400
 * 3. 更新 — PATCH 改名生效；缺 id 400；不存在的 id 404
 * 4. 删除 — { id, deleted: true }；再删 404；id 非 uuid 400
 * 5. 隔离与认证 — 跨工作区改/删 403；无 token 401
 *
 * 契约：api/openapi.yaml 尚未声明该域，本文件钉实现侧行为。
 */

let token: string;
let wid: string;
let otherToken: string;

const auth = () => ({ ...authHeader(token), "Content-Type": "application/json" });
const NAME = `pinspace-${Date.now()}`;

async function createSpace(body: Record<string, unknown>) {
  const res = await fetch(`${BASE}/workspaces/${wid}/spaces`, {
    method: "POST",
    headers: auth(),
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

beforeAll(async () => {
  const owner = await registerUser({ prefix: "space-owner", workspaceName: "空间测试工作区" });
  token = owner.accessToken;
  wid = owner.workspace.id;
  const other = await registerUser({ prefix: "space-other" });
  otherToken = other.accessToken;
});

describe("GET /spaces", () => {
  it("返回 { items, total } 信封", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/spaces`, {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.code).toBe(200);
    expect(Array.isArray(json.data.items)).toBe(true);
    expect(json.data.total).toBe(json.data.items.length);
  });
});

describe("POST /spaces", () => {
  it("创建成功返回 201，并出现在列表里", async () => {
    const { status, json } = await createSpace({ name: NAME, icon: "folder" });
    expect(status).toBe(201);
    expect(json.code).toBe(201);
    expect(json.data.id).toBeTruthy();
    expect(json.data.name).toBe(NAME);

    const list = await fetch(`${BASE}/workspaces/${wid}/spaces`, {
      headers: authHeader(token),
    });
    const listJson = await list.json();
    expect(listJson.data.items.map((s: { id: string }) => s.id)).toContain(json.data.id);
  });

  it("name 为空 → 400", async () => {
    const { status } = await createSpace({ name: "" });
    expect(status).toBe(400);
  });

  it("name 超过 100 字符 → 400", async () => {
    const { status } = await createSpace({ name: "z".repeat(101) });
    expect(status).toBe(400);
  });
});

describe("PATCH /spaces", () => {
  it("改名生效", async () => {
    const created = await createSpace({ name: `${NAME}-patch` });
    const id = created.json.data.id;
    const newName = `${NAME}-renamed`;

    const res = await fetch(`${BASE}/workspaces/${wid}/spaces`, {
      method: "PATCH",
      headers: auth(),
      body: JSON.stringify({ id, name: newName }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.name).toBe(newName);
  });

  it("缺 id → 400", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/spaces`, {
      method: "PATCH",
      headers: auth(),
      body: JSON.stringify({ name: "没有 id" }),
    });
    expect(res.status).toBe(400);
  });

  it("不存在的 id → 404", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/spaces`, {
      method: "PATCH",
      headers: auth(),
      body: JSON.stringify({ id: crypto.randomUUID(), name: "不存在" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /spaces", () => {
  it("删除返回 { id, deleted: true }，再删同一条 404", async () => {
    const created = await createSpace({ name: `${NAME}-del` });
    const id = created.json.data.id;

    const res = await fetch(`${BASE}/workspaces/${wid}/spaces`, {
      method: "DELETE",
      headers: auth(),
      body: JSON.stringify({ id }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({ id, deleted: true });

    const again = await fetch(`${BASE}/workspaces/${wid}/spaces`, {
      method: "DELETE",
      headers: auth(),
      body: JSON.stringify({ id }),
    });
    expect(again.status).toBe(404);
  });

  it("id 不是 uuid → 400", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/spaces`, {
      method: "DELETE",
      headers: auth(),
      body: JSON.stringify({ id: "not-a-uuid" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("隔离与认证", () => {
  it("跨工作区改 A 的空间 → 403", async () => {
    const created = await createSpace({ name: `${NAME}-iso` });
    const res = await fetch(`${BASE}/workspaces/${wid}/spaces`, {
      method: "PATCH",
      headers: { ...authHeader(otherToken), "Content-Type": "application/json" },
      body: JSON.stringify({ id: created.json.data.id, name: "越权改名" }),
    });
    expect(res.status).toBe(403);
  });

  it("不带 token → 401", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/spaces`);
    expect(res.status).toBe(401);
  });
});
