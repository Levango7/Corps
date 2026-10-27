import { describe, it, expect, beforeAll } from "vitest";
import { BASE, registerUser, authHeader } from "../helpers";

/**
 * 通讯录联系人 API 集成测试（/workspaces/{wid}/contacts 与 /contacts/{cid}）
 *
 * 覆盖：
 * 1. 创建联系人（POST）— 必填 name、可空字段默认 null、非法入参 400
 * 2. 查询（GET 列表 / GET 详情）— 分页信封、groupId/search 过滤、404
 * 3. 更新（PATCH）— 局部更新、404
 * 4. 删除（DELETE）— { id, deleted: true }，删除后详情 404
 * 5. 跨工作区隔离 — B 的 token 读不到 A 的联系人（404）
 * 6. 分组联动 — 先建 contact-groups 分组，再按 groupId 过滤
 *
 * 契约：api/openapi.yaml 已声明这组路由（2026-10-25），本文件是其行为侧的钉子。
 */

let token: string;
let wid: string;
let otherToken: string;
let groupId: string;

const uuid = () => crypto.randomUUID();

async function createContact(body: Record<string, unknown>) {
  return fetch(`${BASE}/workspaces/${wid}/contacts`, {
    method: "POST",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const owner = await registerUser({
    prefix: "contacts-owner",
    workspaceName: "联系人测试工作区",
  });
  token = owner.accessToken;
  wid = owner.workspace.id;

  const other = await registerUser({ prefix: "contacts-other" });
  otherToken = other.accessToken;

  const res = await fetch(`${BASE}/workspaces/${wid}/contact-groups`, {
    method: "POST",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: JSON.stringify({ name: "客户" }),
  });
  expect(res.status).toBe(201);
  groupId = (await res.json()).data.id;
});

describe("创建联系人 POST /contacts", () => {
  it("只填 name 创建成功，可空字段落 null", async () => {
    const res = await createContact({ name: "张三" });
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.code).toBe(201);
    expect(json.data.name).toBe("张三");
    expect(json.data.email).toBeNull();
    expect(json.data.phone).toBeNull();
    expect(json.data.groupId).toBeNull();
  });

  it("全字段创建成功并落到分组", async () => {
    const res = await createContact({
      name: "李四",
      email: "lisi@example.com",
      phone: "13800000000",
      department: "销售部",
      position: "经理",
      notes: "重要客户",
      groupId,
    });
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.data.email).toBe("lisi@example.com");
    expect(json.data.department).toBe("销售部");
    expect(json.data.groupId).toBe(groupId);
  });

  it("name 缺失返回 400", async () => {
    const res = await createContact({ email: "noname@example.com" });
    expect(res.status).toBe(400);
  });

  it("email 格式非法返回 400", async () => {
    const res = await createContact({ name: "王五", email: "not-an-email" });
    expect(res.status).toBe(400);
  });
});

describe("查询联系人 GET /contacts", () => {
  it("列表返回分页信封，行内不含 notes（select 裁剪）", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/contacts`, {
      headers: authHeader(token),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.items.length).toBeGreaterThan(0);
    expect(json.data).toMatchObject({ page: 1, total: expect.any(Number) });
    expect("notes" in json.data.items[0]).toBe(false);
  });

  it("groupId 过滤只返回该分组的联系人", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/contacts?groupId=${groupId}`, {
      headers: authHeader(token),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.items.length).toBe(1);
    expect(json.data.items[0].name).toBe("李四");
  });

  it("search 模糊命中邮箱", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/contacts?search=lisi@example.com`, {
      headers: authHeader(token),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.items).toHaveLength(1);
    expect(json.data.items[0].name).toBe("李四");
  });
});

describe("联系人详情与更新 /contacts/{cid}", () => {
  it("详情返回 group 与 creator 关联", async () => {
    const list = await (
      await fetch(`${BASE}/workspaces/${wid}/contacts?search=lisi`, {
        headers: authHeader(token),
      })
    ).json();
    const cid = list.data.items[0].id as string;

    const res = await fetch(`${BASE}/workspaces/${wid}/contacts/${cid}`, {
      headers: authHeader(token),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.group).toMatchObject({ id: groupId, name: "客户" });
    expect(json.data.creator.email).toContain("contacts-owner");
    expect(json.data.notes).toBe("重要客户");
  });

  it("不存在的 uuid 返回 404", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/contacts/${uuid()}`, {
      headers: authHeader(token),
    });
    expect(res.status).toBe(404);
  });

  it("PATCH 局部更新成功", async () => {
    const list = await (
      await fetch(`${BASE}/workspaces/${wid}/contacts?search=张三`, {
        headers: authHeader(token),
      })
    ).json();
    const cid = list.data.items[0].id as string;

    const res = await fetch(`${BASE}/workspaces/${wid}/contacts/${cid}`, {
      method: "PATCH",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ position: "总监" }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.position).toBe("总监");
    expect(json.data.name).toBe("张三");
  });

  it("PATCH 不存在的 uuid 返回 404", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/contacts/${uuid()}`, {
      method: "PATCH",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ name: "查无此人" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("删除与跨工作区隔离", () => {
  it("B 的 token 读 A 的联系人返回 403（非成员先被工作区成员校验拦截，不泄漏存在性）", async () => {
    const list = await (
      await fetch(`${BASE}/workspaces/${wid}/contacts?search=李四`, {
        headers: authHeader(token),
      })
    ).json();
    const cid = list.data.items[0].id as string;

    const res = await fetch(`${BASE}/workspaces/${wid}/contacts/${cid}`, {
      headers: authHeader(otherToken),
    });
    expect(res.status).toBe(403);
  });

  it("DELETE 返回 { id, deleted: true }，再读 404", async () => {
    const created = await (await createContact({ name: "待删除" })).json();
    const cid = created.data.id as string;

    const del = await fetch(`${BASE}/workspaces/${wid}/contacts/${cid}`, {
      method: "DELETE",
      headers: authHeader(token),
    });
    const delJson = await del.json();

    expect(del.status).toBe(200);
    expect(delJson.data).toEqual({ id: cid, deleted: true });

    const followUp = await fetch(`${BASE}/workspaces/${wid}/contacts/${cid}`, {
      headers: authHeader(token),
    });
    expect(followUp.status).toBe(404);
  });
});
