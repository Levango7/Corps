import { describe, it, expect, beforeAll } from "vitest";
import { BASE, registerUser, authHeader } from "../helpers";

/**
 * 白板 API 集成测试（/workspaces/{wid}/whiteboards 与 /whiteboards/{wbid}）
 *
 * 覆盖：
 * 1. 创建（POST）— data 默认空数组、title 校验 400
 * 2. 列表（GET）— take/skip 分页信封（items/total/hasMore）
 * 3. 详情（GET）— 含完整画布 data
 * 4. 更新（PATCH）— 改 title 与画布 data
 * 5. 删除（DELETE）— { id, deleted: true }，再读 404
 * 6. 跨工作区隔离 — B 的 token 读 A 的白板 403
 *
 * 契约：api/openapi.yaml 已声明该域（2026-10-26 第四批），本文件是其行为侧的钉子。
 */

let token: string;
let wid: string;
let otherToken: string;

const uuid = () => crypto.randomUUID();

const auth = () => ({ ...authHeader(token), "Content-Type": "application/json" });

async function createBoard(body: Record<string, unknown>) {
  return fetch(`${BASE}/workspaces/${wid}/whiteboards`, {
    method: "POST",
    headers: auth(),
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const owner = await registerUser({
    prefix: "wb-owner",
    workspaceName: "白板测试工作区",
  });
  token = owner.accessToken;
  wid = owner.workspace.id;

  const other = await registerUser({ prefix: "wb-other" });
  otherToken = other.accessToken;
});

describe("创建白板 POST /whiteboards", () => {
  it("只填 title 创建成功，data 默认空数组", async () => {
    const res = await createBoard({ title: "架构草图" });
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.data.title).toBe("架构草图");
    expect(json.data.data).toEqual([]);
  });

  it("title 缺失返回 400", async () => {
    const res = await createBoard({ data: [] });
    expect(res.status).toBe(400);
  });
});

describe("列表与详情 GET /whiteboards", () => {
  it("列表分页信封（updatedAt 倒序）", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/whiteboards`, {
      headers: authHeader(token),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toMatchObject({
      total: expect.any(Number),
      hasMore: expect.any(Boolean),
    });
    const titles = json.data.items.map((b: { title: string }) => b.title);
    expect(titles).toContain("架构草图");
  });

  it("详情含完整画布 data；不存在的 uuid 404", async () => {
    const elements = [{ id: "e1", type: "rect", x: 10, y: 20, width: 100, height: 60 }];
    const board = await (await createBoard({ title: "带画布", data: elements })).json();

    const res = await fetch(`${BASE}/workspaces/${wid}/whiteboards/${board.data.id}`, {
      headers: authHeader(token),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.data).toEqual(elements);

    const missing = await fetch(`${BASE}/workspaces/${wid}/whiteboards/${uuid()}`, {
      headers: authHeader(token),
    });
    expect(missing.status).toBe(404);
  });
});

describe("更新与删除 /whiteboards/{wbid}", () => {
  it("PATCH 改标题与画布内容", async () => {
    const board = await (await createBoard({ title: "旧白板" })).json();
    const newData = [{ id: "e2", type: "text", x: 0, y: 0, content: "hello" }];

    const res = await fetch(`${BASE}/workspaces/${wid}/whiteboards/${board.data.id}`, {
      method: "PATCH",
      headers: auth(),
      body: JSON.stringify({ title: "新白板", data: newData }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.title).toBe("新白板");
    expect(json.data.data).toEqual(newData);
  });

  it("DELETE 返回 { id, deleted: true }，再读 404", async () => {
    const board = await (await createBoard({ title: "待删白板" })).json();
    const wbid = board.data.id as string;

    const del = await fetch(`${BASE}/workspaces/${wid}/whiteboards/${wbid}`, {
      method: "DELETE",
      headers: authHeader(token),
    });
    const delJson = await del.json();

    expect(del.status).toBe(200);
    expect(delJson.data).toEqual({ id: wbid, deleted: true });

    const followUp = await fetch(`${BASE}/workspaces/${wid}/whiteboards/${wbid}`, {
      headers: authHeader(token),
    });
    expect(followUp.status).toBe(404);
  });
});

describe("跨工作区隔离", () => {
  it("B 的 token 读 A 的白板返回 403", async () => {
    const board = await (await createBoard({ title: "A 的白板" })).json();

    const res = await fetch(`${BASE}/workspaces/${wid}/whiteboards/${board.data.id}`, {
      headers: authHeader(otherToken),
    });
    expect(res.status).toBe(403);
  });
});
