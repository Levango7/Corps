import { describe, it, expect, beforeAll } from "vitest";
import { BASE, registerUser, authHeader } from "../helpers";

/**
 * 知识库（Wiki）API 集成测试（/workspaces/{wid}/wiki）
 *
 * 覆盖：
 * 1. 列表 — { items, total, hasMore } 信封；pageSize 上限 100 生效
 * 2. 创建 — 201 且带回 id/title；title 空 400；title 超长（>200）400
 * 3. slug 唯一 — 同工作区重复 slug 409（不是 500）
 * 4. 隔离与认证 — 跨工作区 403；无 token 401
 *
 * 契约：api/openapi.yaml 尚未声明该域，本文件钉实现侧行为。
 */

let token: string;
let wid: string;
let otherToken: string;

const auth = () => ({ ...authHeader(token), "Content-Type": "application/json" });
const TAG = Date.now();

async function createPage(body: Record<string, unknown>) {
  const res = await fetch(`${BASE}/workspaces/${wid}/wiki`, {
    method: "POST",
    headers: auth(),
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

beforeAll(async () => {
  const owner = await registerUser({ prefix: "wiki-owner", workspaceName: "知识库测试工作区" });
  token = owner.accessToken;
  wid = owner.workspace.id;
  const other = await registerUser({ prefix: "wiki-other" });
  otherToken = other.accessToken;
});

describe("GET /wiki", () => {
  it("返回 { items, total, hasMore } 信封", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/wiki`, {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.code).toBe(200);
    expect(Array.isArray(json.data.items)).toBe(true);
    expect(typeof json.data.total).toBe("number");
    expect(typeof json.data.hasMore).toBe("boolean");
  });

  it("pageSize=100 是合法上限，返回不超过 100 条", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/wiki?pageSize=100`, {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.items.length).toBeLessThanOrEqual(100);
  });
});

describe("POST /wiki", () => {
  it("创建成功返回 201，带回 id 与 title", async () => {
    const { status, json } = await createPage({
      title: `pinwiki-${TAG}`,
      content: "由 tests/api 钉住的内容",
    });
    expect(status).toBe(201);
    expect(json.code).toBe(201);
    expect(json.data.id).toBeTruthy();
    expect(json.data.title).toBe(`pinwiki-${TAG}`);
  });

  it("创建后出现在列表里", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/wiki?pageSize=100`, {
      headers: authHeader(token),
    });
    const json = await res.json();
    const titles = json.data.items.map((p: { title: string }) => p.title);
    expect(titles).toContain(`pinwiki-${TAG}`);
  });

  it("title 为空 → 400", async () => {
    const { status, json } = await createPage({ title: "" });
    expect(status).toBe(400);
    expect(json.code).toBe(400);
  });

  it("title 超过 200 字符 → 400", async () => {
    const { status } = await createPage({ title: "w".repeat(201) });
    expect(status).toBe(400);
  });

  it("重复 slug → 409（不是 500）", async () => {
    const slug = `pin-slug-${TAG}`;
    const first = await createPage({ title: `pinwiki-slug-a-${TAG}`, slug });
    expect(first.status).toBe(201);
    const second = await createPage({ title: `pinwiki-slug-b-${TAG}`, slug });
    expect(second.status).toBe(409);
    expect(second.json.code).toBe(409);
  });
});

describe("隔离与认证", () => {
  it("跨工作区读 A 的知识库 → 403", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/wiki`, {
      headers: authHeader(otherToken),
    });
    expect(res.status).toBe(403);
  });

  it("不带 token → 401", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/wiki`);
    expect(res.status).toBe(401);
  });
});
