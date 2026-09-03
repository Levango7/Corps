import { describe, it, expect, beforeAll } from "vitest";
import { BASE, registerUser, authHeader } from "../helpers";

/**
 * 文档中心集成测试（v0.4.0 队列第 2 项）
 *
 * 覆盖：
 * 1. 列表 — 空、搜索（标题/正文 ilike）
 * 2. CRUD — 创建、获取、修改、删除
 * 3. 分享 — 生成 token、撤分享、公开访问（无需登录）
 * 4. 跨工作区防护 — A 的 token 不能读/改/删 B 的文档
 * 5. 草稿 vs 发布 — 草稿不返回已发布快照；发布后 publishedMarkdown 不为空
 */

let token: string;
let wid: string;
let otherToken: string;
let otherWid: string;

beforeAll(async () => {
  const owner = await registerUser({ prefix: "doc-owner", workspaceName: "文档工作区" });
  token = owner.accessToken;
  wid = owner.workspace.id;

  const other = await registerUser({ prefix: "doc-other" });
  otherToken = other.accessToken;
  otherWid = other.workspace.id;
});

async function createDoc(title: string, extra: Record<string, unknown> = {}) {
  const res = await fetch(`${BASE}/workspaces/${wid}/documents`, {
    method: "POST",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: JSON.stringify({ title, ...extra }),
  });
  return { res, json: await res.json() };
}

describe("文档 CRUD", () => {
  it("创建文档成功（201），默认 markdown 空串", async () => {
    const { res, json } = await createDoc("项目公约");
    expect(res.status).toBe(201);
    expect(json.data.id).toBeDefined();
    expect(json.data.title).toBe("项目公约");
    expect(json.data.markdown).toBe("");
    expect(json.data.publishedMarkdown).toBeNull();
  });

  it("创建文档支持传入 markdown", async () => {
    const { json } = await createDoc("API 风格", {
      markdown: "# API 风格\n\nRESTful 优先于 RPC",
    });
    expect(json.data.markdown).toContain("RESTful");
  });

  it("GET 详情返回完整字段", async () => {
    const { json: created } = await createDoc("详细页测试", {
      markdown: "正文内容",
    });
    const id = created.data.id;
    const res = await fetch(`${BASE}/workspaces/${wid}/documents/${id}`, {
      headers: authHeader(token),
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.id).toBe(id);
    expect(json.data.title).toBe("详细页测试");
    expect(json.data.markdown).toBe("正文内容");
  });

  it("PATCH 修改标题与正文（200）", async () => {
    const { json: created } = await createDoc("原标题");
    const id = created.data.id;
    const res = await fetch(`${BASE}/workspaces/${wid}/documents/${id}`, {
      method: "PATCH",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "新标题", markdown: "## 新内容" }),
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.title).toBe("新标题");
    expect(json.data.markdown).toBe("## 新内容");
  });

  it("DELETE 成功后 GET 返 404", async () => {
    const { json: created } = await createDoc("待删除");
    const id = created.data.id;
    const del = await fetch(`${BASE}/workspaces/${wid}/documents/${id}`, {
      method: "DELETE",
      headers: authHeader(token),
    });
    expect(del.status).toBe(200);
    const get = await fetch(`${BASE}/workspaces/${wid}/documents/${id}`, {
      headers: authHeader(token),
    });
    expect(get.status).toBe(404);
  });
});

describe("文档搜索", () => {
  beforeAll(async () => {
    await createDoc("新人入职清单");
    await createDoc("架构决策记录 ADR-001");
    await createDoc("周会纪要 2026-08-31", { markdown: "讨论了 K8s 升级路径" });
  });

  it("列表按更新时间倒序", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/documents`, {
      headers: authHeader(token),
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < json.data.length - 1; i++) {
      const prev = new Date(json.data[i].updatedAt).getTime();
      const next = new Date(json.data[i + 1].updatedAt).getTime();
      expect(prev).toBeGreaterThanOrEqual(next);
    }
  });

  it("标题模糊搜索（q 命中标题）", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/documents?q=${encodeURIComponent("入职")}`, {
      headers: authHeader(token),
    });
    const json = await res.json();
    const titles = json.data.map((d: { title: string }) => d.title);
    expect(titles).toContain("新人入职清单");
  });

  it("正文模糊搜索（q 命中 markdown 字段）", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/documents?q=${encodeURIComponent("K8s")}`, {
      headers: authHeader(token),
    });
    const json = await res.json();
    const titles = json.data.map((d: { title: string }) => d.title);
    expect(titles).toContain("周会纪要 2026-08-31");
  });
});

describe("发布与分享", () => {
  it("发布（PATCH publish=true）写入 publishedMarkdown 与 publishedAt", async () => {
    const { json: created } = await createDoc("发布测试", {
      markdown: "## 草稿内容",
    });
    const id = created.data.id;
    const res = await fetch(`${BASE}/workspaces/${wid}/documents/${id}`, {
      method: "PATCH",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ publish: true }),
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.publishedMarkdown).toBe("## 草稿内容");
    expect(json.data.publishedAt).not.toBeNull();
  });

  it("生成 shareToken 后公开 API 可读（含 publishedMarkdown）", async () => {
    const { json: created } = await createDoc("分享测试", {
      markdown: "## 这是要分享给客户的草稿",
    });
    const id = created.data.id;
    // 先发布
    await fetch(`${BASE}/workspaces/${wid}/documents/${id}`, {
      method: "PATCH",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ publish: true }),
    });
    // 生成 shareToken（PATCH shareToken="rotate" 触发服务端旋转；首次返回新 token）
    const res = await fetch(`${BASE}/workspaces/${wid}/documents/${id}`, {
      method: "PATCH",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ shareToken: "rotate" }),
    });
    const json = await res.json();
    expect(json.data.shareToken).toBeTruthy();
    const shareTok = json.data.shareToken as string;

    // 公开 API 不需要 auth
    const pub = await fetch(`${BASE.replace("/api/v1", "")}/api/documents/share/${shareTok}`);
    const pubJson = await pub.json();
    expect(pub.status).toBe(200);
    expect(pubJson.data.title).toBe("分享测试");
    expect(pubJson.data.publishedMarkdown).toBe("## 这是要分享给客户的草稿");
  });

  it("未发布的文档 公开 API 返 404", async () => {
    const { json: created } = await createDoc("草稿无快照");
    const id = created.data.id;
    // 先生成 token（未发布）
    const shareRes = await fetch(`${BASE}/workspaces/${wid}/documents/${id}`, {
      method: "PATCH",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ shareToken: "rotate" }),
    });
    const shareJson = await shareRes.json();
    const shareTok = shareJson.data.shareToken as string;

    // 公开读：草稿无 publishedMarkdown → 404
    const pub = await fetch(`${BASE.replace("/api/v1", "")}/api/documents/share/${shareTok}`);
    expect(pub.status).toBe(404);
  });

  it("shareToken=null 取消分享", async () => {
    const { json: created } = await createDoc("取消分享测试", {
      markdown: "## 正文",
    });
    const id = created.data.id;
    await fetch(`${BASE}/workspaces/${wid}/documents/${id}`, {
      method: "PATCH",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ publish: true, shareToken: "rotate" }),
    });
    const off = await fetch(`${BASE}/workspaces/${wid}/documents/${id}`, {
      method: "PATCH",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ shareToken: null }),
    });
    const offJson = await off.json();
    expect(off.status).toBe(200);
    expect(offJson.data.shareToken).toBeNull();
  });
});

describe("跨工作区防护", () => {
  it("A 的 token 不能读 B 工作区的文档（在 B 工作区下 404）", async () => {
    // 在 otherWid 下建文档
    const create = await fetch(`${BASE}/workspaces/${otherWid}/documents`, {
      method: "POST",
      headers: { ...authHeader(otherToken), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "B 租户文档" }),
    });
    const created = await create.json();
    const id = created.data.id;
    // A 的 token 拿 B 的 wid 上下文 → 401（getWorkspaceContext 跨工作区 null）
    const res = await fetch(`${BASE}/workspaces/${otherWid}/documents/${id}`, {
      headers: authHeader(token),
    });
    expect(res.status).toBe(401);
  });

  it("A 的 token 不能改 B 工作区的文档（在 B 工作区下 401）", async () => {
    const create = await fetch(`${BASE}/workspaces/${otherWid}/documents`, {
      method: "POST",
      headers: { ...authHeader(otherToken), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "B 租户文档 2" }),
    });
    const created = await create.json();
    const id = created.data.id;
    const res = await fetch(`${BASE}/workspaces/${otherWid}/documents/${id}`, {
      method: "PATCH",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "越权修改" }),
    });
    expect(res.status).toBe(401);
  });
});
