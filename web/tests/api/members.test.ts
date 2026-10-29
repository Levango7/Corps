import { describe, it, expect, beforeAll } from "vitest";
import { BASE, registerUser, authHeader } from "../helpers";

/**
 * 成员列表 API 集成测试（/workspaces/{wid}/members）
 *
 * 覆盖：
 * 1. 列表 — 分页信封 { items, page, limit, total, hasMore }，默认 1/50
 * 2. 内容 — 新工作区只有注册者一人；每条带 role 与 user{id,email,name,image}
 * 3. 参数校验 — limit=101 400、limit=0 400、page=0 400
 * 4. 隔离与认证 — 跨工作区 403；无 token 401
 *
 * 契约：api/openapi.yaml 尚未声明该域，本文件钉实现侧行为。
 */

let token: string;
let wid: string;
let ownerEmail: string;
let otherToken: string;

beforeAll(async () => {
  const owner = await registerUser({ prefix: "member-owner", workspaceName: "成员测试工作区" });
  token = owner.accessToken;
  wid = owner.workspace.id;
  ownerEmail = owner.user.email;
  const other = await registerUser({ prefix: "member-other" });
  otherToken = other.accessToken;
});

describe("GET /members", () => {
  it("返回分页信封，默认 page=1 / limit=50", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/members`, {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.code).toBe(200);
    expect(json.data.page).toBe(1);
    expect(json.data.limit).toBe(50);
    expect(Array.isArray(json.data.items)).toBe(true);
    expect(typeof json.data.total).toBe("number");
    expect(typeof json.data.hasMore).toBe("boolean");
  });

  it("新工作区只有注册者一个成员；items 是**扁平**结构（不是嵌套 user）", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/members`, {
      headers: authHeader(token),
    });
    const json = await res.json();
    expect(json.data.items.length).toBe(1);
    expect(json.data.total).toBe(1);
    expect(json.data.hasMore).toBe(false);

    const me = json.data.items[0];
    expect(typeof me.role).toBe("string");
    expect(me.role.length).toBeGreaterThan(0);
    // 实现把 member.user 摊平了（见 route.ts 的 map）：email/name/image 直接在顶层，
    // 没有 user 子对象。这条钉住形状，免得前端按嵌套写、后端悄悄改。
    expect(me.email).toBe(ownerEmail);
    expect(me.user).toBeUndefined();
    expect(me.isSelf).toBe(true);
    // 只暴露白名单字段，不能把 passwordHash 之类带出去
    expect(me.passwordHash).toBeUndefined();
  });

  it("limit=101 超过上限 → 400", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/members?limit=101`, {
      headers: authHeader(token),
    });
    expect(res.status).toBe(400);
  });

  it("limit=0 低于下限 → 400", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/members?limit=0`, {
      headers: authHeader(token),
    });
    expect(res.status).toBe(400);
  });

  it("page=0 低于下限 → 400", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/members?page=0`, {
      headers: authHeader(token),
    });
    expect(res.status).toBe(400);
  });
});

describe("隔离与认证", () => {
  it("跨工作区读 A 的成员列表 → 403", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/members`, {
      headers: authHeader(otherToken),
    });
    expect(res.status).toBe(403);
  });

  it("不带 token → 401", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/members`);
    expect(res.status).toBe(401);
  });
});
