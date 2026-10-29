import { describe, it, expect, beforeAll } from "vitest";
import { BASE, registerUser, authHeader } from "../helpers";

/**
 * 跨内容全文搜索 API 集成测试（/workspaces/{wid}/search）
 *
 * 覆盖：
 * 1. 命中任务 — { type, id, title, snippet, href, updatedAt } 六字段齐全，
 *    href 是 `/w/{wid}/task/{id}`（前端点击能直接跳转）
 * 2. 分页上限 — limit 真的截断（两条命中 + limit=1 只回一条），total 反映的是**截断后**条数
 * 3. 类型过滤 — type=document 时不含 task 结果
 * 4. 参数校验 — 缺 q 400；q 全是空格 400（不能退化成"匹配全部"）
 * 5. 跨租户隔离 — B 在自己工作区搜同一个词，搜不到 A 的任务
 * 6. 未认证 — 不带 token 401
 *
 * 契约：api/openapi.yaml **尚未**声明该域（契约覆盖率是另一条单独的债），
 * 本文件钉的是实现侧行为。
 *
 * 说明：这里只钉 Task 一类命中。Document / Decision 的命中路径需要先造出对应实体，
 * 其权限与生命周期由各自域的文件负责，不在本文件重复铺设。
 */

let token: string;
let wid: string;
let otherToken: string;
let otherWid: string;
/** 每个文件独有的一次性词根，避免与其他用例/其他文件的数据互相命中 */
const HIT = `pinsrch${Date.now()}`;

const auth = () => ({ ...authHeader(token), "Content-Type": "application/json" });

async function createTask(title: string): Promise<{ id: string; title: string }> {
  const res = await fetch(`${BASE}/workspaces/${wid}/tasks`, {
    method: "POST",
    headers: auth(),
    body: JSON.stringify({ title }),
  });
  expect(res.status).toBe(201);
  const json = await res.json();
  return json.data;
}

beforeAll(async () => {
  const owner = await registerUser({
    prefix: "search-owner",
    workspaceName: "搜索测试工作区",
  });
  token = owner.accessToken;
  wid = owner.workspace.id;

  const other = await registerUser({ prefix: "search-other" });
  otherToken = other.accessToken;
  otherWid = other.workspace.id;

  // 两条命中，用于验证 limit 真的截断
  await createTask(`${HIT} 第一条`);
  await createTask(`${HIT} 第二条`);
});

describe("GET /search", () => {
  it("命中任务时六字段齐全，href 指向任务详情", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/search?q=${HIT}`, {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.code).toBe(200);
    expect(Array.isArray(json.data.items)).toBe(true);

    const tasks = json.data.items.filter((i: { type: string }) => i.type === "task");
    expect(tasks.length).toBe(2);
    for (const item of tasks) {
      expect(item.id).toBeTruthy();
      expect(item.title).toContain(HIT);
      expect(item.href).toBe(`/w/${wid}/task/${item.id}`);
      expect(typeof item.snippet).toBe("string");
      expect(new Date(item.updatedAt).toString()).not.toBe("Invalid Date");
    }
    // total 是**截断后**的条数（实现里的语义），不是命中的全量条数
    expect(json.data.total).toBe(json.data.items.length);
  });

  it("limit=1 时只回一条，证明上限真的生效", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/search?q=${HIT}&limit=1`, {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.items.length).toBe(1);
    expect(json.data.total).toBe(1);
  });

  it("type=document 时不含 task 结果", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/search?q=${HIT}&type=document`, {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    const types = json.data.items.map((i: { type: string }) => i.type);
    expect(types).not.toContain("task");
    // 该词只存在于任务标题里，因此文档类结果应为空
    expect(json.data.items.length).toBe(0);
  });

  it("缺 q 参数 → 400", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/search`, {
      headers: authHeader(token),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe(400);
  });

  it("q 全是空格 → 400（trim 后不允许退化成匹配全部）", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/search?q=%20%20%20`, {
      headers: authHeader(token),
    });
    expect(res.status).toBe(400);
  });

  it("type 取值非法 → 400", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/search?q=${HIT}&type=bogus`, {
      headers: authHeader(token),
    });
    expect(res.status).toBe(400);
  });
});

describe("隔离与认证", () => {
  it("跨租户：B 在自己工作区搜同一个词，搜不到 A 的任务", async () => {
    const res = await fetch(`${BASE}/workspaces/${otherWid}/search?q=${HIT}`, {
      headers: authHeader(otherToken),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.items.length).toBe(0);
  });

  it("用别人的 wid 搜索 → 403", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/search?q=${HIT}`, {
      headers: authHeader(otherToken),
    });
    expect(res.status).toBe(403);
  });

  it("不带 token → 401", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/search?q=${HIT}`);
    expect(res.status).toBe(401);
  });
});
