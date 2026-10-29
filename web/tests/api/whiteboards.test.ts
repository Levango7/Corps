import { describe, it, expect, beforeAll } from "vitest";
import { BASE, registerUser, authHeader } from "../helpers";

/**
 * 白板 API 集成测试（/workspaces/{wid}/whiteboards）
 *
 * 覆盖：
 * 1. 列表 — { items, total, hasMore } 信封；take 上限 100（take=101 → 400）
 * 2. 创建 — 201 且带回 id/title；title 空 400；title 超长（>200）400
 * 3. data 形态 — 字符串与数组都接受（schema 是 union），非法形态（数字）400
 * 4. 隔离与认证 — 跨工作区 403；无 token 401
 *
 * 契约：api/openapi.yaml 尚未声明该域，本文件钉实现侧行为。
 */

let token: string;
let wid: string;
let otherToken: string;

const auth = () => ({ ...authHeader(token), "Content-Type": "application/json" });
const TAG = Date.now();

async function createBoard(body: Record<string, unknown>) {
  const res = await fetch(`${BASE}/workspaces/${wid}/whiteboards`, {
    method: "POST",
    headers: auth(),
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

beforeAll(async () => {
  const owner = await registerUser({ prefix: "wb-owner", workspaceName: "白板测试工作区" });
  token = owner.accessToken;
  wid = owner.workspace.id;
  const other = await registerUser({ prefix: "wb-other" });
  otherToken = other.accessToken;
});

describe("GET /whiteboards", () => {
  it("返回 { items, total, hasMore } 信封", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/whiteboards`, {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.code).toBe(200);
    expect(Array.isArray(json.data.items)).toBe(true);
    expect(typeof json.data.total).toBe("number");
    expect(typeof json.data.hasMore).toBe("boolean");
  });

  it("take=101 超过上限 100 → 400", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/whiteboards?take=101`, {
      headers: authHeader(token),
    });
    expect(res.status).toBe(400);
  });

  it("take=1 时最多回一条", async () => {
    await createBoard({ title: `pinwb-a-${TAG}` });
    await createBoard({ title: `pinwb-b-${TAG}` });
    const res = await fetch(`${BASE}/workspaces/${wid}/whiteboards?take=1`, {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.items.length).toBe(1);
    // total 是全量，不受 take 影响
    expect(json.data.total).toBeGreaterThanOrEqual(2);
  });
});

describe("POST /whiteboards", () => {
  it("创建成功返回 201，带回 id 与 title", async () => {
    const { status, json } = await createBoard({ title: `pinwb-${TAG}` });
    expect(status).toBe(201);
    expect(json.code).toBe(201);
    expect(json.data.id).toBeTruthy();
    expect(json.data.title).toBe(`pinwb-${TAG}`);
  });

  it("data 传字符串也接受（union 分支）", async () => {
    const { status, json } = await createBoard({
      title: `pinwb-str-${TAG}`,
      data: '{"shapes":[]}',
    });
    expect(status).toBe(201);
    expect(json.data.id).toBeTruthy();
  });

  it("title 为空 → 400", async () => {
    const { status } = await createBoard({ title: "" });
    expect(status).toBe(400);
  });

  it("title 超过 200 字符 → 400", async () => {
    const { status } = await createBoard({ title: "b".repeat(201) });
    expect(status).toBe(400);
  });

  it("data 传数字 → 400（只允许字符串或数组）", async () => {
    const { status } = await createBoard({ title: `pinwb-bad-${TAG}`, data: 42 });
    expect(status).toBe(400);
  });
});

describe("隔离与认证", () => {
  it("跨工作区读 A 的白板 → 403", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/whiteboards`, {
      headers: authHeader(otherToken),
    });
    expect(res.status).toBe(403);
  });

  it("不带 token → 401", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/whiteboards`);
    expect(res.status).toBe(401);
  });
});
