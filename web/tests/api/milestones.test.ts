import { describe, it, expect, beforeAll } from "vitest";
import { BASE, registerUser, authHeader } from "../helpers";

/**
 * 里程碑 API 集成测试（/workspaces/{wid}/milestones）
 *
 * 覆盖：
 * 1. 列表 — 返回数组（GET 直接给数组，不是分页信封）
 * 2. 创建 — 201 且带回 id/name；name 空 400；name 超长（>100）400
 * 3. 删除 — { id, deleted: true }；删不存在 404；id 非 uuid 400
 * 4. 隔离与认证 — 跨工作区删除 403；无 token 401
 *
 * 契约：api/openapi.yaml 尚未声明该域，本文件钉实现侧行为。
 *
 * 注意：GET 走的是 `getCachedMilestones()`（有一层缓存），所以这里只断言"是数组"，
 * 不断言"刚创建的那条立刻出现"——那会把缓存策略当成契约钉死，日后换实现就误报。
 */

let token: string;
let wid: string;
let otherToken: string;

const auth = () => ({ ...authHeader(token), "Content-Type": "application/json" });
const NAME = `pinms-${Date.now()}`;

async function createMilestone(body: Record<string, unknown>) {
  const res = await fetch(`${BASE}/workspaces/${wid}/milestones`, {
    method: "POST",
    headers: auth(),
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

beforeAll(async () => {
  const owner = await registerUser({ prefix: "ms-owner", workspaceName: "里程碑测试工作区" });
  token = owner.accessToken;
  wid = owner.workspace.id;
  const other = await registerUser({ prefix: "ms-other" });
  otherToken = other.accessToken;
});

describe("GET /milestones", () => {
  it("返回数组", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/milestones`, {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.code).toBe(200);
    expect(Array.isArray(json.data)).toBe(true);
  });
});

describe("POST /milestones", () => {
  it("创建成功返回 201，带回 id 与 name", async () => {
    const { status, json } = await createMilestone({
      name: NAME,
      description: "由 tests/api 钉住",
    });
    expect(status).toBe(201);
    expect(json.code).toBe(201);
    expect(json.data.id).toBeTruthy();
    expect(json.data.name).toBe(NAME);
  });

  it("name 为空 → 400", async () => {
    const { status, json } = await createMilestone({ name: "" });
    expect(status).toBe(400);
    expect(json.code).toBe(400);
    expect(Array.isArray(json.errors)).toBe(true);
  });

  it("name 超过 100 字符 → 400", async () => {
    const { status } = await createMilestone({ name: "y".repeat(101) });
    expect(status).toBe(400);
  });

  it("dueDate 不是合法 ISO 时间 → 400", async () => {
    const { status } = await createMilestone({ name: `${NAME}-bad-date`, dueDate: "2026-13-45" });
    expect(status).toBe(400);
  });
});

describe("DELETE /milestones", () => {
  it("删除成功返回 { id, deleted: true }", async () => {
    const created = await createMilestone({ name: `${NAME}-del` });
    expect(created.status).toBe(201);
    const id = created.json.data.id;

    const res = await fetch(`${BASE}/workspaces/${wid}/milestones`, {
      method: "DELETE",
      headers: auth(),
      body: JSON.stringify({ id }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({ id, deleted: true });
  });

  it("删不存在的 id → 404", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/milestones`, {
      method: "DELETE",
      headers: auth(),
      body: JSON.stringify({ id: crypto.randomUUID() }),
    });
    expect(res.status).toBe(404);
  });

  it("id 不是 uuid → 400", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/milestones`, {
      method: "DELETE",
      headers: auth(),
      body: JSON.stringify({ id: "nope" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("隔离与认证", () => {
  it("跨工作区删除 A 的里程碑 → 403", async () => {
    const created = await createMilestone({ name: `${NAME}-iso` });
    const res = await fetch(`${BASE}/workspaces/${wid}/milestones`, {
      method: "DELETE",
      headers: { ...authHeader(otherToken), "Content-Type": "application/json" },
      body: JSON.stringify({ id: created.json.data.id }),
    });
    expect(res.status).toBe(403);
  });

  it("不带 token → 401", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/milestones`);
    expect(res.status).toBe(401);
  });
});
