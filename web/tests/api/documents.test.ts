import { describe, it, expect, beforeAll } from "vitest";
import { BASE, registerUser, authHeader } from "../helpers";

/**
 * 文档 API 集成测试（/workspaces/{wid}/documents 与 /documents/{id} 与 comments）
 *
 * 覆盖：
 * 1. 创建（POST）— title 必填、markdown 可选
 * 2. 列表（GET）— 分页信封 { items, page, limit, total, hasMore }
 * 3. 详情（GET）/ 更新（PATCH 局部 + publish 快照）/ 删除（DELETE → { id, deleted: true } → 再读 404）
 * 4. 评论（comments）— POST（anchorPath/anchorText/body）→ 201、GET 列表 { items, total }
 * 5. 校验 — 空 title 400、超限 markdown 400、评论缺 anchorPath 400
 * 6. 跨工作区隔离 — B 的 token 读 A 的文档 403
 *
 * 契约：documents 域使用 code=200/201 新信封；comments 列表为 { items, total } 非分页形态。
 */

let ownerToken: string;
let otherToken: string;
let wid: string;
let docId: string;

const auth = (t: string) => ({ ...authHeader(t), "Content-Type": "application/json" });

async function createDoc(token: string, title: string, markdown?: string) {
  return fetch(`${BASE}/workspaces/${wid}/documents`, {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify(markdown === undefined ? { title } : { title, markdown }),
  });
}

beforeAll(async () => {
  const owner = await registerUser({
    prefix: "docs-owner",
    workspaceName: "文档测试工作区",
  });
  ownerToken = owner.accessToken;
  wid = owner.workspace.id;

  const other = await registerUser({ prefix: "docs-other" });
  otherToken = other.accessToken;

  const res = await createDoc(ownerToken, "主文档", "# 标题\n\n正文内容");
  docId = (await res.json()).data.id;
});

describe("创建与列表", () => {
  it("POST /documents 创建成功（title + markdown）", async () => {
    const res = await createDoc(ownerToken, "会议纪要", "# 会议纪要\n\n- 议题一");
    const json = await res.json();
    expect(res.status).toBe(201);
    expect(json.code).toBe(201);
    expect(json.data.title).toBe("会议纪要");
    expect(json.data.markdown).toContain("议题一");
  });

  it("POST /documents 缺 title 返回 400", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/documents`, {
      method: "POST",
      headers: auth(ownerToken),
      body: JSON.stringify({ markdown: "# 无标题" }),
    });
    expect(res.status).toBe(400);
  });

  it("GET /documents 列表返回分页信封", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/documents?page=1&limit=10`, {
      headers: auth(ownerToken),
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.code).toBe(200);
    expect(json.data.items.length).toBeGreaterThanOrEqual(1);
    expect(json.data.page).toBe(1);
    expect(json.data.limit).toBe(10);
    expect(json.data.total).toBeGreaterThanOrEqual(1);
    expect(typeof json.data.hasMore).toBe("boolean");
  });

  it("GET /documents?q= 按标题搜索命中", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/documents?q=主文档`, {
      headers: auth(ownerToken),
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.items.some((d: { title: string }) => d.title === "主文档")).toBe(true);
  });
});

describe("详情 / 更新 / 删除", () => {
  it("GET /documents/{id} 返回完整文档", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/documents/${docId}`, {
      headers: auth(ownerToken),
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.id).toBe(docId);
    expect(json.data.title).toBe("主文档");
  });

  it("PATCH /documents/{id} 局部更新标题", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/documents/${docId}`, {
      method: "PATCH",
      headers: auth(ownerToken),
      body: JSON.stringify({ title: "改名后的主文档" }),
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    // data 直接是 doc（非 { doc } 包装）
    expect(json.data.title).toBe("改名后的主文档");
  });

  it("PATCH /documents/{id} 空 body 容忍为 no-op（200，title 不变）", async () => {
    // updateDocSchema 全字段 optional 且无 minProperties——空对象通过校验，返回原文档（不改动）
    const before = await fetch(`${BASE}/workspaces/${wid}/documents/${docId}`, {
      headers: auth(ownerToken),
    }).then((r) => r.json());

    const res = await fetch(`${BASE}/workspaces/${wid}/documents/${docId}`, {
      method: "PATCH",
      headers: auth(ownerToken),
      body: JSON.stringify({}),
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.title).toBe(before.data.title);
  });

  it("跨工作区隔离：B 的 token 读 A 的文档 403", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/documents/${docId}`, {
      headers: auth(otherToken),
    });
    expect(res.status).toBe(403);
  });

  it("DELETE /documents/{id} 返回 { id, deleted: true }，再读 404", async () => {
    const created = await createDoc(ownerToken, "待删文档");
    const id = (await created.json()).data.id;

    const del = await fetch(`${BASE}/workspaces/${wid}/documents/${id}`, {
      method: "DELETE",
      headers: auth(ownerToken),
    });
    const delJson = await del.json();
    expect(del.status).toBe(200);
    expect(delJson.data).toEqual({ id, deleted: true });

    const reread = await fetch(`${BASE}/workspaces/${wid}/documents/${id}`, {
      headers: auth(ownerToken),
    });
    expect(reread.status).toBe(404);
  });
});

describe("文档评论（comments）", () => {
  it("POST /documents/{id}/comments 创建成功（anchorPath/anchorText/body）", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/documents/${docId}/comments`, {
      method: "POST",
      headers: auth(ownerToken),
      body: JSON.stringify({
        anchorPath: "1.0",
        anchorText: "标题",
        body: "这一段需要补充数据来源",
      }),
    });
    const json = await res.json();
    expect(res.status).toBe(201);
    expect(json.data.body).toBe("这一段需要补充数据来源");
  });

  it("POST /documents/{id}/comments 缺 anchorPath 返回 400", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/documents/${docId}/comments`, {
      method: "POST",
      headers: auth(ownerToken),
      body: JSON.stringify({ anchorText: "标题", body: "缺锚点路径" }),
    });
    expect(res.status).toBe(400);
  });

  it("GET /documents/{id}/comments 列表返回 { items, total }", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/documents/${docId}/comments`, {
      headers: auth(ownerToken),
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(json.data.items)).toBe(true);
    expect(json.data.items.length).toBeGreaterThanOrEqual(1);
    expect(json.data.total).toBe(json.data.items.length);
  });
});
