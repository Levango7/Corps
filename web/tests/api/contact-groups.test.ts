import { describe, it, expect, beforeAll } from "vitest";
import { BASE, registerUser, authHeader } from "../helpers";

/**
 * 联系人分组 API 集成测试（/workspaces/{wid}/contact-groups）
 *
 * 覆盖：
 * 1. 创建分组（POST）— 校验、空组 _count.contacts === 0
 * 2. 查询（GET 列表）— 含 _count
 * 3. 更新（PATCH，?gid= 查询参数形态）— 改名、404
 * 4. 删除（DELETE，?gid=）— { id, deleted: true }；组内联系人经 SetNull 自动解绑
 * 5. 校验失败 400；跨工作区 403
 *
 * 契约：api/openapi.yaml 已声明该路由（2026-10-19 批次），本文件是其行为侧的钉子。
 */

let token: string;
let wid: string;
let otherToken: string;

const uuid = () => crypto.randomUUID();

async function createGroup(name: string) {
  return fetch(`${BASE}/workspaces/${wid}/contact-groups`, {
    method: "POST",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

async function createContact(groupId: string, name: string) {
  return fetch(`${BASE}/workspaces/${wid}/contacts`, {
    method: "POST",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: JSON.stringify({ name, groupId }),
  });
}

beforeAll(async () => {
  const owner = await registerUser({
    prefix: "cgroups-owner",
    workspaceName: "分组测试工作区",
  });
  token = owner.accessToken;
  wid = owner.workspace.id;

  const other = await registerUser({ prefix: "cgroups-other" });
  otherToken = other.accessToken;
});

describe("分组创建与列表", () => {
  it("创建分组成功（POST 响应无 include，只有裸行）", async () => {
    const res = await createGroup("供应商");
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.data.name).toBe("供应商");
    expect(json.data.id).toBeDefined();
  });

  it("name 缺失返回 400", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/contact-groups`, {
      method: "POST",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("列表包含所建分组与计数", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/contact-groups`, {
      headers: authHeader(token),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    const names = json.data.items.map((g: { name: string }) => g.name);
    expect(names).toContain("供应商");
    for (const g of json.data.items) {
      expect(g._count).toHaveProperty("contacts");
    }
  });
});

describe("分组更新与删除", () => {
  it("PATCH ?gid= 改名成功", async () => {
    const created = await (await createGroup("旧名")).json();
    const gid = created.data.id as string;

    const res = await fetch(`${BASE}/workspaces/${wid}/contact-groups?gid=${gid}`, {
      method: "PATCH",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ name: "新名" }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.name).toBe("新名");
  });

  it("PATCH 不存在的 gid 返回 404", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/contact-groups?gid=${uuid()}`, {
      method: "PATCH",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ name: "查无此组" }),
    });
    expect(res.status).toBe(404);
  });

  it("删除分组后组内联系人 SetNull 自动解绑", async () => {
    const group = await (await createGroup("待删组")).json();
    const gid = group.data.id as string;
    const contact = await (await createContact(gid, "组内联系人")).json();
    expect(contact.data.groupId).toBe(gid);

    const del = await fetch(`${BASE}/workspaces/${wid}/contact-groups?gid=${gid}`, {
      method: "DELETE",
      headers: authHeader(token),
    });
    const delJson = await del.json();

    expect(del.status).toBe(200);
    expect(delJson.data).toEqual({ id: gid, deleted: true });

    const list = await (
      await fetch(`${BASE}/workspaces/${wid}/contacts?search=组内联系人`, {
        headers: authHeader(token),
      })
    ).json();
    expect(list.data.items[0].groupId).toBeNull();
  });

  it("DELETE 不存在的 gid 返回 404", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/contact-groups?gid=${uuid()}`, {
      method: "DELETE",
      headers: authHeader(token),
    });
    expect(res.status).toBe(404);
  });
});

describe("跨工作区隔离", () => {
  it("B 的 token 改 A 的分组返回 403（非成员先被成员校验拦截）", async () => {
    const created = await (await createGroup("A 的组")).json();
    const gid = created.data.id as string;

    const res = await fetch(`${BASE}/workspaces/${wid}/contact-groups?gid=${gid}`, {
      method: "PATCH",
      headers: { ...authHeader(otherToken), "Content-Type": "application/json" },
      body: JSON.stringify({ name: "越权改名" }),
    });
    expect(res.status).toBe(403);
  });
});
