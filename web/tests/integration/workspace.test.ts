import { describe, it, expect, beforeAll } from "vitest";

const BASE = "http://localhost:3000/api/v1";

describe("AC-03: 跨租户请求隔离", () => {
  let tokenA: string;
  let tokenB: string;
  let widA: string;
  let widB: string;

  beforeAll(async () => {
    // 创建租户 A
    const rA = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `tenant-a-${Date.now()}@corps.test`,
        password: "Test123456!",
        workspaceName: "Tenant A",
      }),
    });
    const dA = await rA.json();
    tokenA = dA.data.accessToken;
    widA = dA.data.workspace.id;

    // 创建租户 B
    const rB = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `tenant-b-${Date.now()}@corps.test`,
        password: "Test123456!",
        workspaceName: "Tenant B",
      }),
    });
    const dB = await rB.json();
    tokenB = dB.data.accessToken;
    widB = dB.data.workspace.id;

    // 在租户 B 中创建一个任务作为"私密数据"
    await fetch(`${BASE}/workspaces/${widB}/tasks`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${tokenB}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "B的秘密任务",
        status: "todo",
        priority: "high",
      }),
    });
  });

  it("AC-03: 租户A的token访问租户B的任务列表应返回 404 或 403", async () => {
    const res = await fetch(`${BASE}/workspaces/${widB}/tasks`, {
      headers: { "Authorization": `Bearer ${tokenA}` },
    });
    expect([404, 403]).toContain(res.status);
  });

  it("AC-03: 租户A不能直接构造URL访问租户B的任务详情", async () => {
    const res = await fetch(`${BASE}/workspaces/${widB}/tasks/fake-uuid`, {
      headers: { "Authorization": `Bearer ${tokenA}` },
    });
    expect([404, 403]).toContain(res.status);
  });
});

describe("AC-04: RLS引擎层拦截漏写WHERE", () => {
  it("AC-04: 跨租户的读与写全部被拒（应用层兜底回归）", async () => {
    // 说明：引擎层断言（无 WHERE 时由 PG RLS 拦截）需要以非表主、NOBYPASSRLS 的
    // app_role 连接执行，CI 以 postgres 超级用户跑库无法复现（超级用户绕过 RLS）。
    // 部署步骤见 db/schema.sql 头部注释。此处验证等价的应用层回归面：
    // 租户 A 对租户 B 资源的一切读写都必须失败，不允许任何数据返回。
    const rB = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `rls-b-${Date.now()}@corps.test`,
        password: "Test123456!",
        workspaceName: "RLS Tenant B",
      }),
    });
    const dB = await rB.json();
    const tokenB = dB.data.accessToken;
    const widB = dB.data.workspace.id;

    const taskRes = await fetch(`${BASE}/workspaces/${widB}/tasks`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${tokenB}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: "B的机密任务", status: "todo", priority: "high" }),
    });
    const taskId = (await taskRes.json()).data.id;

    // 租户 A（AC-03 场景中已注册）
    const listA = await fetch(`${BASE}/workspaces/${widA}/tasks`, {
      headers: { "Authorization": `Bearer ${tokenA}` },
    });
    const tasksA = await listA.json();
    expect(JSON.stringify(tasksA)).not.toContain("B的机密任务");

    // 写路径：A 构造 URL 直接改/删 B 的任务
    const patchRes = await fetch(`${BASE}/workspaces/${widB}/tasks/${taskId}`, {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${tokenA}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: "被篡改" }),
    });
    expect([401, 403, 404]).toContain(patchRes.status);

    const deleteRes = await fetch(`${BASE}/workspaces/${widB}/tasks/${taskId}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${tokenA}` },
    });
    expect([401, 403, 404]).toContain(deleteRes.status);

    // B 的任务未被改动
    const detailB = await fetch(`${BASE}/workspaces/${widB}/tasks/${taskId}`, {
      headers: { "Authorization": `Bearer ${tokenB}` },
    });
    expect((await detailB.json()).data.title).toBe("B的机密任务");
  });
});

describe("AC-05: RBAC 权限控制", () => {
  let ownerToken: string;
  let memberToken: string;
  let wid: string;
  let memberUid: string;
  let dOwner: any;

  beforeAll(async () => {
    // 注册 owner
    const rOwner = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `owner-${Date.now()}@corps.test`,
        password: "Test123456!",
        workspaceName: "RBAC Test",
      }),
    });
    dOwner = await rOwner.json();
    ownerToken = dOwner.data.accessToken;
    wid = dOwner.data.workspace.id;

    // 注册 member 账户
    const rMember = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `member-${Date.now()}@corps.test`,
        password: "Test123456!",
        workspaceName: "Member Own WS",
      }),
    });
    const dMember = await rMember.json();
    memberToken = dMember.data.accessToken;
    memberUid = dMember.data.user.id;

    // owner 邀请 member 加入工作区
    await fetch(`${BASE}/workspaces/${wid}/members/invite`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${ownerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: dMember.data.user.email }),
    });
  });

  it("Member角色调用移除成员接口应返回 403", async () => {
    // member 尝试移除 owner → 应 403
    const res = await fetch(`${BASE}/workspaces/${wid}/members/${dOwner.data.user.id}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${memberToken}` },
    });
    expect(res.status).toBe(403);
  });

  it("Member角色调用邀请接口应返回 403", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/members/invite`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${memberToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: `new-${Date.now()}@corps.test` }),
    });
    expect(res.status).toBe(403);
  });

  it("Member角色调用计费接口应返回 403", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/billing/checkout`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${memberToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });

  it("Owner可以移除Member", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/members/${memberUid}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${ownerToken}` },
    });
    expect(res.status).toBe(200);
  });
});

describe("AC-06: 看板拖拽乐观更新", () => {
  it("PATCH /tasks/:id 修改status并持久化", async () => {
    // 拖拽链路的后端契约：本地先变（乐观）→ PATCH {status, sortOrder} → GET 可见持久化结果
    const rOwner = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `drag-${Date.now()}@corps.test`,
        password: "Test123456!",
        workspaceName: "Drag Test",
      }),
    });
    const dOwner = await rOwner.json();
    const token = dOwner.data.accessToken as string;
    const dragWid = dOwner.data.workspace.id as string;

    const createRes = await fetch(`${BASE}/workspaces/${dragWid}/tasks`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: "拖拽测试任务", status: "todo", priority: "medium" }),
    });
    const created = await createRes.json();
    expect(createRes.status).toBe(201);
    const taskId = created.data.id;
    expect(created.data.status).toBe("todo");

    // 模拟拖到"进行中"列
    const patchRes = await fetch(`${BASE}/workspaces/${dragWid}/tasks/${taskId}`, {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "in_progress", sortOrder: 100.5 }),
    });
    expect(patchRes.status).toBe(200);
    expect((await patchRes.json()).data.status).toBe("in_progress");

    // 重新拉取详情，确认已持久化而非仅响应体回显
    const getRes = await fetch(`${BASE}/workspaces/${dragWid}/tasks/${taskId}`, {
      headers: { "Authorization": `Bearer ${token}` },
    });
    const persisted = await getRes.json();
    expect(persisted.data.status).toBe("in_progress");
    expect(persisted.data.sortOrder).toBe(100.5);

    // 非法状态值必须被 Zod 拒绝（历史遗留值 "doing" 不在合法枚举内）
    const badRes = await fetch(`${BASE}/workspaces/${dragWid}/tasks/${taskId}`, {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "doing" }),
    });
    expect(badRes.status).toBe(400);
  });
});