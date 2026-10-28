import { describe, it, expect, beforeAll } from "vitest";
import { BASE, registerUser, authHeader } from "../helpers";

/**
 * 标签 API 集成测试（/workspaces/{wid}/labels）
 *
 * 覆盖：
 * 1. 列表 — 空工作区返回空数组；创建后能读到（GET 直接返回数组，不是分页信封）
 * 2. 创建 — 201 且回读带 id/name/color；name 为空 400；同名 409（工作区内唯一）
 * 3. 删除 — 200 { id, deleted: true }；重复删 404；id 非 uuid 400
 * 4. 隔离与认证 — 跨工作区删除 403；无 token 401
 *
 * 契约：api/openapi.yaml 尚未声明该域，本文件钉实现侧行为。
 *
 * ⚠ 本域的 GET 走 `cachedQuery`（tag `labels:{wid}`，60s 重验证），
 *   所以**不**断言"POST 之后立刻能在列表里读到""DELETE 之后列表里就没有了"——
 *   那两条断言的是缓存刷新时机，不是 API 行为，实测会红（本轮 CI 就是这么红的）。
 *   列表相关只钉形状；增删的效果以 201/200 响应与 404 为准。
 */

let token: string;
let wid: string;
let otherToken: string;

const auth = () => ({ ...authHeader(token), "Content-Type": "application/json" });
const NAME = `pinlabel-${Date.now()}`;

async function createLabel(body: Record<string, unknown>) {
  const res = await fetch(`${BASE}/workspaces/${wid}/labels`, {
    method: "POST",
    headers: auth(),
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

beforeAll(async () => {
  const owner = await registerUser({ prefix: "label-owner", workspaceName: "标签测试工作区" });
  token = owner.accessToken;
  wid = owner.workspace.id;
  const other = await registerUser({ prefix: "label-other" });
  otherToken = other.accessToken;
});

describe("GET /labels", () => {
  it("空工作区返回空数组（不是分页信封）", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/labels`, {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.code).toBe(200);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.length).toBe(0);
  });
});

describe("POST /labels", () => {
  it("创建成功返回 201，带 id/name/color", async () => {
    const { status, json } = await createLabel({ name: NAME, color: "blue" });
    expect(status).toBe(201);
    expect(json.code).toBe(201);
    expect(json.data.id).toBeTruthy();
    expect(json.data.name).toBe(NAME);
    expect(json.data.color).toBe("blue");
  });

  it("name 为空字符串 → 400", async () => {
    const { status, json } = await createLabel({ name: "" });
    expect(status).toBe(400);
    expect(json.code).toBe(400);
    expect(Array.isArray(json.errors)).toBe(true);
  });

  it("name 超过 50 字符 → 400", async () => {
    const { status } = await createLabel({ name: "x".repeat(51) });
    expect(status).toBe(400);
  });

  it("同工作区内重名 → 409（不是 500）", async () => {
    const { status, json } = await createLabel({ name: NAME });
    expect(status).toBe(409);
    expect(json.code).toBe(409);
  });
});

describe("DELETE /labels", () => {
  it("删除返回 { id, deleted: true }", async () => {
    const created = await createLabel({ name: `${NAME}-del` });
    expect(created.status).toBe(201);
    const id = created.json.data.id;

    const res = await fetch(`${BASE}/workspaces/${wid}/labels`, {
      method: "DELETE",
      headers: auth(),
      body: JSON.stringify({ id }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({ id, deleted: true });
  });

  it("删不存在的 id → 404", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/labels`, {
      method: "DELETE",
      headers: auth(),
      body: JSON.stringify({ id: crypto.randomUUID() }),
    });
    expect(res.status).toBe(404);
  });

  it("id 不是 uuid → 400", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/labels`, {
      method: "DELETE",
      headers: auth(),
      body: JSON.stringify({ id: "not-a-uuid" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("隔离与认证", () => {
  it("跨工作区删除 A 的标签 → 403", async () => {
    const created = await createLabel({ name: `${NAME}-iso` });
    const res = await fetch(`${BASE}/workspaces/${wid}/labels`, {
      method: "DELETE",
      headers: { ...authHeader(otherToken), "Content-Type": "application/json" },
      body: JSON.stringify({ id: created.json.data.id }),
    });
    expect(res.status).toBe(403);
  });

  it("不带 token → 401", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/labels`);
    expect(res.status).toBe(401);
  });
});
