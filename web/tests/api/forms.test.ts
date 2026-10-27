import { describe, it, expect, beforeAll } from "vitest";
import { BASE, registerUser, authHeader } from "../helpers";

/**
 * 表单 API 集成测试（/workspaces/{wid}/forms 与 /forms/{fid} 与 /forms/{fid}/submissions）
 *
 * 覆盖：
 * 1. 创建表单（POST）— fields 必填 min 1、字段类型校验、默认值
 * 2. 列表（GET）— 分页信封、active 过滤、_count submissions
 * 3. 详情（GET）— 含 fields 完整定义、_count submissions
 * 3. 更新（PATCH）— 局部更新、404
 * 4. 删除（DELETE）— code: 0 + data:null，再读 404
 * 4. 提交（POST /submissions）— data 为 fieldId→value 记录
 * 5. 跨工作区隔离 — B 的 token 读 A 的表单 403
 *
 * 契约：api/openapi.yaml 已声明该域（2026-10-27 第六批），本文件是其行为侧的钉子。
 * 注意：forms 域整域使用 LEGACY ENVELOPE (code=0)，契约中已显式标注。
 */

let token: string;
let wid: string;
let otherToken: string;

const auth = () => ({ ...authHeader(token), "Content-Type": "application/json" });

const validField = {
  id: "f1",
  type: "text",
  label: "姓名",
  required: true,
};

async function createForm(body: Record<string, unknown>) {
  return fetch(`${BASE}/workspaces/${wid}/forms`, {
    method: "POST",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const owner = await registerUser({
    prefix: "forms-owner",
    workspaceName: "表单测试工作区",
  });
  token = owner.accessToken;
  wid = owner.workspace.id;

  const other = await registerUser({ prefix: "forms-other" });
  otherToken = other.accessToken;
});

describe("创建表单 POST /forms", () => {
  it("最简 fields 创建成功，active 默认 true", async () => {
    const res = await createForm({
      title: "报名表",
      fields: [validField],
    });
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.code).toBe(0);
    expect(json.data.title).toBe("报名表");
    expect(json.data.active).toBe(true);
    expect(json.data.fields).toHaveLength(1);
    expect(json.data.fields[0].id).toBe("f1");
  });

  it("fields 为空数组返回 400", async () => {
    const res = await createForm({ title: "无字段表单", fields: [] });
    expect(res.status).toBe(400);
  });

  it("field 缺少 id 返回 400", async () => {
    const res = await createForm({
      title: "缺 id",
      fields: [{ type: "text", label: "缺 id", required: true }],
    });
    expect(res.status).toBe(400);
  });

  it("field type 非法返回 400", async () => {
    const res = await createForm({
      title: "非法类型",
      fields: [{ id: "f1", type: "invalid", label: "错误", required: true }],
    });
    expect(res.status).toBe(400);
  });
});

describe("查询表单 GET /forms", () => {
  it("列表返回分页信封，含 _count.submissions", async () => {
    await createForm({ title: "列表测试", fields: [validField] });
    const res = await fetch(`${BASE}/workspaces/${wid}/forms`, { headers: authHeader(token) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.code).toBe(0);
    expect(json.data).toMatchObject({
      items: expect.any(Array),
      total: expect.any(Number),
      skip: 0,
      take: 50,
    });
    expect(json.data.items.length).toBeGreaterThan(0);
    expect(json.data.items[0]).toHaveProperty("_count");
    expect(json.data.items[0]._count).toHaveProperty("submissions");
  });

  it("active=true 只返回启用的表单", async () => {
    await createForm({ title: "停用表单", fields: [validField], active: false });

    const res = await fetch(`${BASE}/workspaces/${wid}/forms?active=true`, {
      headers: authHeader(token),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.items.every((f: { active: boolean }) => f.active === true)).toBe(true);
  });
});

describe("表单详情与更新 /forms/{fid}", () => {
  it("详情返回完整 fields 与 _count", async () => {
    const created = await (await createForm({ title: "详情测试", fields: [validField] })).json();
    const fid = created.data.id as string;

    const res = await fetch(`${BASE}/workspaces/${wid}/forms/${fid}`, {
      headers: authHeader(token),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.code).toBe(0);
    expect(json.data.fields).toHaveLength(1);
    expect(json.data._count).toHaveProperty("submissions");
  });

  it("不存在的 fid 返回 404", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/forms/${crypto.randomUUID()}`, {
      headers: authHeader(token),
    });
    expect(res.status).toBe(404);
  });

  it("PATCH 部分更新成功", async () => {
    const created = await (await createForm({ title: "待改表单", fields: [validField] })).json();
    const fid = created.data.id as string;

    const res = await fetch(`${BASE}/workspaces/${wid}/forms/${fid}`, {
      method: "PATCH",
      headers: auth(),
      body: JSON.stringify({ title: "已改标题", active: false }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.code).toBe(0);
    expect(json.data.title).toBe("已改标题");
    expect(json.data.active).toBe(false);
  });

  it("PATCH 不存在的 fid 返回 404", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/forms/${crypto.randomUUID()}`, {
      method: "PATCH",
      headers: auth(),
      body: JSON.stringify({ title: "查无此表" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("删除与跨工作区隔离", () => {
  it("DELETE 返回 code:0 + data:null，再读 404", async () => {
    const created = await (await createForm({ title: "待删", fields: [validField] })).json();
    const fid = created.data.id as string;

    const del = await fetch(`${BASE}/workspaces/${wid}/forms/${fid}`, {
      method: "DELETE",
      headers: authHeader(token),
    });
    const delJson = await del.json();

    expect(del.status).toBe(200);
    expect(delJson.code).toBe(0);
    expect(delJson.data).toBeNull();

    const followUp = await fetch(`${BASE}/workspaces/${wid}/forms/${fid}`, {
      headers: authHeader(token),
    });
    expect(followUp.status).toBe(404);
  });

  it("B 的 token 读 A 的表单返回 403（工作区隔离）", async () => {
    const created = await (await createForm({ title: "A 的表单", fields: [validField] })).json();
    const fid = created.data.id as string;

    const res = await fetch(`${BASE}/workspaces/${wid}/forms/${fid}`, {
      headers: authHeader(otherToken),
    });
    expect(res.status).toBe(403);
  });
});

describe("表单提交 POST /forms/{fid}/submissions", () => {
  it("提交成功，data 为 fieldId→value 记录", async () => {
    const created = await (await createForm({ title: "提交测试", fields: [validField] })).json();
    const fid = created.data.id as string;

    const res = await fetch(`${BASE}/workspaces/${wid}/forms/${fid}/submissions`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ data: { f1: "张三" } }),
    });
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.code).toBe(0);
    expect(json.data.data).toEqual({ f1: "张三" });
  });

  it("跨工作区提交返回 403", async () => {
    const created = await (await createForm({ title: "A 的表单", fields: [validField] })).json();
    const fid = created.data.id as string;

    const res = await fetch(`${BASE}/workspaces/${wid}/forms/${fid}/submissions`, {
      method: "POST",
      headers: { ...authHeader(otherToken), "Content-Type": "application/json" },
      body: JSON.stringify({ data: { f1: "越权" } }),
    });
    expect(res.status).toBe(403);
  });
});

describe("跨工作区隔离（列表/详情）", () => {
  it("B 的 token 列 A 的表单返回 403", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/forms`, {
      headers: authHeader(otherToken),
    });
    expect(res.status).toBe(403);
  });

  it("B 的 token 查 A 的表单详情返回 403", async () => {
    const created = await (await createForm({ title: "A 的", fields: [validField] })).json();
    const fid = created.data.id as string;

    const res = await fetch(`${BASE}/workspaces/${wid}/forms/${fid}`, {
      headers: authHeader(otherToken),
    });
    expect(res.status).toBe(403);
  });
});

describe("提交列表 GET /forms/{fid}/submissions", () => {
  it("列表返回分页信封（items/total/skip/take），code=0", async () => {
    const created = await (await createForm({ title: "列表测试", fields: [validField] })).json();
    const fid = created.data.id as string;
    await fetch(`${BASE}/workspaces/${wid}/forms/${fid}/submissions`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ data: { f1: "提交1" } }),
    });
    await fetch(`${BASE}/workspaces/${wid}/forms/${fid}/submissions`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ data: { f1: "提交2" } }),
    });

    const res = await fetch(`${BASE}/workspaces/${wid}/forms/${fid}/submissions`, {
      headers: authHeader(token),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.code).toBe(0);
    expect(json.data).toMatchObject({
      items: expect.any(Array),
      total: 2,
      skip: 0,
      take: 50,
    });
  });
});
