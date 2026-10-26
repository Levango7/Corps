import { describe, it, expect, beforeAll } from "vitest";
import { BASE, registerUser, authHeader } from "../helpers";

/**
 * Wiki 页面 API 集成测试（/workspaces/{wid}/wiki 与 /wiki/{pageId}）
 *
 * 覆盖：
 * 1. 创建页面（POST）— content 默认空串、slug 自动生成、400 校验
 * 2. 列表（GET）— 分页信封、q 模糊搜索（title/content/slug）
 * 3. 详情（GET）— 含直接子页面（树形）
 * 4. 更新（PATCH）— 改名、挂到父页下
 * 5. 删除（DELETE）— { id, deleted: true }，再读 404
 * 6. 跨工作区隔离 — B 的 token 读 A 的页面 403
 *
 * 契约：api/openapi.yaml 已声明该域（2026-10-26 第四批），本文件是其行为侧的钉子。
 */

let token: string;
let wid: string;
let otherToken: string;

const uuid = () => crypto.randomUUID();

const auth = () => ({ ...authHeader(token), "Content-Type": "application/json" });

async function createPage(body: Record<string, unknown>) {
  return fetch(`${BASE}/workspaces/${wid}/wiki`, {
    method: "POST",
    headers: auth(),
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const owner = await registerUser({
    prefix: "wiki-owner",
    workspaceName: "Wiki 测试工作区",
  });
  token = owner.accessToken;
  wid = owner.workspace.id;

  const other = await registerUser({ prefix: "wiki-other" });
  otherToken = other.accessToken;
});

describe("创建页面 POST /wiki", () => {
  it("只填 title 创建成功，content 默认空串且 slug 自动生成", async () => {
    const res = await createPage({ title: "产品手册" });
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.data.title).toBe("产品手册");
    expect(json.data.content).toBe("");
    expect(json.data.slug).toBeTruthy();
    expect(json.data.parentId).toBeNull();
  });

  it("title 缺失返回 400", async () => {
    const res = await createPage({ content: "没有标题" });
    expect(res.status).toBe(400);
  });
});

describe("列表与搜索 GET /wiki", () => {
  it("列表分页信封且包含新建页面", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/wiki`, { headers: authHeader(token) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toMatchObject({ total: expect.any(Number), hasMore: expect.any(Boolean) });
    const titles = json.data.items.map((p: { title: string }) => p.title);
    expect(titles).toContain("产品手册");
  });

  it("q 搜索命中 title；无关关键词返回空", async () => {
    const hit = await (
      await fetch(`${BASE}/workspaces/${wid}/wiki?q=产品手册`, { headers: authHeader(token) })
    ).json();
    const titles = hit.data.items.map((p: { title: string }) => p.title);
    expect(titles).toContain("产品手册");

    const miss = await (
      await fetch(`${BASE}/workspaces/${wid}/wiki?q=definitely-no-match-xyz`, {
        headers: authHeader(token),
      })
    ).json();
    expect(miss.data.items).toHaveLength(0);
  });
});

describe("详情、父子结构与更新 /wiki/{pageId}", () => {
  it("父页详情包含子页（树形）", async () => {
    const parent = await (await createPage({ title: "父页面" })).json();
    const child = await (await createPage({ title: "子页面", parentId: parent.data.id })).json();
    expect(child.data.parentId).toBe(parent.data.id);

    const res = await fetch(`${BASE}/workspaces/${wid}/wiki/${parent.data.id}`, {
      headers: authHeader(token),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(json.data.children)).toBe(true);
    expect(json.data.children.map((c: { title: string }) => c.title)).toContain("子页面");
  });

  it("PATCH 改名与内容更新成功；不存在的 uuid 404", async () => {
    const page = await (await createPage({ title: "待改页面" })).json();

    const res = await fetch(`${BASE}/workspaces/${wid}/wiki/${page.data.id}`, {
      method: "PATCH",
      headers: auth(),
      body: JSON.stringify({ title: "已改页面", content: "新内容" }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.title).toBe("已改页面");
    expect(json.data.content).toBe("新内容");

    const missing = await fetch(`${BASE}/workspaces/${wid}/wiki/${uuid()}`, {
      method: "PATCH",
      headers: auth(),
      body: JSON.stringify({ title: "查无此页" }),
    });
    expect(missing.status).toBe(404);
  });
});

describe("删除与跨工作区隔离", () => {
  it("DELETE 返回 { id, deleted: true }，再读 404", async () => {
    const page = await (await createPage({ title: "待删页面" })).json();
    const pageId = page.data.id as string;

    const del = await fetch(`${BASE}/workspaces/${wid}/wiki/${pageId}`, {
      method: "DELETE",
      headers: authHeader(token),
    });
    const delJson = await del.json();

    expect(del.status).toBe(200);
    expect(delJson.data).toEqual({ id: pageId, deleted: true });

    const followUp = await fetch(`${BASE}/workspaces/${wid}/wiki/${pageId}`, {
      headers: authHeader(token),
    });
    expect(followUp.status).toBe(404);
  });

  it("B 的 token 读 A 的页面返回 403（工作区隔离）", async () => {
    const page = await (await createPage({ title: "A 的页面" })).json();

    const res = await fetch(`${BASE}/workspaces/${wid}/wiki/${page.data.id}`, {
      headers: authHeader(otherToken),
    });
    expect(res.status).toBe(403);
  });
});
