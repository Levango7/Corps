import { describe, it, expect, beforeAll } from "vitest";
import { BASE, registerUser, inviteMember, authHeader, createTask } from "../helpers";

/**
 * RBAC 权限集成测试
 *
 * 覆盖矩阵：
 * ┌─────────┬──────────┬──────────┬──────────┬─────────┐
 * │ 操作    │ owner    │ admin    │ member   │ outsider│
 * ├─────────┼──────────┼──────────┼──────────┼─────────┤
 * │ 邀请成员 │ ✓        │ ✓        │ ✗ 403    │ 401     │
 * │ 改角色  │ ✓        │ ✓        │ ✗ 403    │ 401     │
 * │ 移除成员 │ ✓        │ ✓        │ ✗ 403    │ 401     │
 * │ 计费    │ ✓        │ ✗ 403    │ ✗ 403    │ 401     │
 * │ 读任务  │ ✓        │ ✓        │ ✓        │ 401     │
 * │ 建任务  │ ✓        │ ✓        │ ✓        │ 401     │
 * └─────────┴──────────┴──────────┴──────────┴─────────┘
 *
 * 另有独立的 "RBAC: viewer 只读角色" 用例组。viewer 列是后补的：
 * lib/permissions.ts 的矩阵一直声明 viewer 全只读，但本文件原先只有
 * owner/admin/member/outsider 四列、viewer 零覆盖，于是"只读成员可以建/改任务"
 * 长期无人发现。
 */

interface TestFixture {
  owner: { user: { id: string; email: string }; accessToken: string; workspace: { id: string } };
  admin: { user: { id: string; email: string }; accessToken: string };
  member: { user: { id: string; email: string }; accessToken: string };
  viewer: { user: { id: string; email: string }; accessToken: string };
  outsider: { user: { id: string; email: string }; accessToken: string; workspace: { id: string } };
  wid: string;
}

let fixture: TestFixture;

beforeAll(async () => {
  // Arrange - 创建 owner 工作区
  const owner = await registerUser({ prefix: "rbac-owner", workspaceName: "RBAC 工作区" });
  const adminUser = await registerUser({ prefix: "rbac-admin" });
  const memberUser = await registerUser({ prefix: "rbac-member" });
  const outsider = await registerUser({ prefix: "rbac-outsider" });

  // owner 邀请 admin 和 member 加入工作区（默认 role=member）
  const inviteAdmin = await inviteMember(
    owner.accessToken,
    owner.workspace.id,
    adminUser.user.email,
  );
  expect(inviteAdmin.status).toBe(201);
  const inviteMemberRes = await inviteMember(
    owner.accessToken,
    owner.workspace.id,
    memberUser.user.email,
  );
  expect(inviteMemberRes.status).toBe(201);

  // owner 把 adminUser 的角色升级为 admin
  const promoteRes = await fetch(
    `${BASE}/workspaces/${owner.workspace.id}/members/${adminUser.user.id}`,
    {
      method: "PATCH",
      headers: { ...authHeader(owner.accessToken), "Content-Type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    },
  );
  expect(promoteRes.status).toBe(200);

  // admin/member 需要刷新 token 才能拿到新角色的 access_token
  // 用 login 重新登录获取带新角色的 token
  const adminLogin = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: adminUser.user.email, password: "Test123456!" }),
  });

  const adminCookies = adminLogin.headers.getSetCookie?.() ?? [];
  const adminToken = adminCookies
    .find((c) => c.startsWith("access_token="))
    ?.split("=")[1]
    ?.split(";")[0];

  // admin 的 access_token 仍指向其自有工作区，需要 refresh 切换到 owner 工作区
  const adminRefresh = await fetch(`${BASE}/auth/refresh`, {
    method: "POST",
    headers: { Cookie: adminCookies.join("; "), "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId: owner.workspace.id }),
  });
  const adminRefreshCookies = adminRefresh.headers.getSetCookie?.() ?? [];
  const adminWidToken = adminRefreshCookies
    .find((c) => c.startsWith("access_token="))
    ?.split("=")[1]
    ?.split(";")[0];

  const memberLogin = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: memberUser.user.email, password: "Test123456!" }),
  });

  const memberCookies = memberLogin.headers.getSetCookie?.() ?? [];

  const memberRefresh = await fetch(`${BASE}/auth/refresh`, {
    method: "POST",
    headers: { Cookie: memberCookies.join("; "), "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId: owner.workspace.id }),
  });
  const memberRefreshCookies = memberRefresh.headers.getSetCookie?.() ?? [];
  const memberWidToken = memberRefreshCookies
    .find((c) => c.startsWith("access_token="))
    ?.split("=")[1]
    ?.split(";")[0];

  // viewer 只读成员：矩阵声明 viewer 对 tasks 只有 "r"，此前整条矩阵没有 viewer 用例，
  // 所以"只读成员可写"这个缺陷长期无人发现。
  const viewerUser = await registerUser({ prefix: "rbac-viewer" });
  const inviteViewer = await inviteMember(
    owner.accessToken,
    owner.workspace.id,
    viewerUser.user.email,
  );
  expect(inviteViewer.status).toBe(201);
  const setViewerRes = await fetch(
    `${BASE}/workspaces/${owner.workspace.id}/members/${viewerUser.user.id}`,
    {
      method: "PATCH",
      headers: { ...authHeader(owner.accessToken), "Content-Type": "application/json" },
      body: JSON.stringify({ role: "viewer" }),
    },
  );
  expect(setViewerRes.status).toBe(200);

  const viewerLogin = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: viewerUser.user.email, password: "Test123456!" }),
  });
  const viewerCookies = viewerLogin.headers.getSetCookie?.() ?? [];
  const viewerRefresh = await fetch(`${BASE}/auth/refresh`, {
    method: "POST",
    headers: { Cookie: viewerCookies.join("; "), "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId: owner.workspace.id }),
  });
  const viewerRefreshCookies = viewerRefresh.headers.getSetCookie?.() ?? [];
  const viewerWidToken = viewerRefreshCookies
    .find((c) => c.startsWith("access_token="))
    ?.split("=")[1]
    ?.split(";")[0];

  fixture = {
    owner: {
      user: { id: owner.user.id, email: owner.user.email },
      accessToken: owner.accessToken,
      workspace: owner.workspace,
    },
    admin: {
      user: { id: adminUser.user.id, email: adminUser.user.email },
      accessToken: adminWidToken ?? adminToken ?? "",
    },
    member: {
      user: { id: memberUser.user.id, email: memberUser.user.email },
      accessToken: memberWidToken ?? "",
    },
    viewer: {
      user: { id: viewerUser.user.id, email: viewerUser.user.email },
      accessToken: viewerWidToken ?? "",
    },
    outsider: {
      user: { id: outsider.user.id, email: outsider.user.email },
      accessToken: outsider.accessToken,
      workspace: outsider.workspace,
    },
    wid: owner.workspace.id,
  };
});

describe("RBAC: 邀请成员权限", () => {
  it("owner 可以邀请成员", async () => {
    const newUser = await registerUser({ prefix: "rbac-invite-by-owner" });
    const res = await inviteMember(fixture.owner.accessToken, fixture.wid, newUser.user.email);
    expect(res.status).toBe(201);
  });

  it("admin 可以邀请成员", async () => {
    const newUser = await registerUser({ prefix: "rbac-invite-by-admin" });
    const res = await inviteMember(fixture.admin.accessToken, fixture.wid, newUser.user.email);
    expect(res.status).toBe(201);
  });

  it("member 邀请成员返回 403", async () => {
    const newUser = await registerUser({ prefix: "rbac-invite-by-member" });
    const res = await inviteMember(fixture.member.accessToken, fixture.wid, newUser.user.email);
    expect(res.status).toBe(403);
  });

  it("外部用户（非成员）邀请返回 401", async () => {
    const newUser = await registerUser({ prefix: "rbac-invite-by-outsider" });
    const res = await inviteMember(fixture.outsider.accessToken, fixture.wid, newUser.user.email);
    expect([401, 403]).toContain(res.status);
  });
});

describe("RBAC: 修改成员角色权限", () => {
  it("owner 可以修改成员角色", async () => {
    const res = await fetch(`${BASE}/workspaces/${fixture.wid}/members/${fixture.member.user.id}`, {
      method: "PATCH",
      headers: { ...authHeader(fixture.owner.accessToken), "Content-Type": "application/json" },
      body: JSON.stringify({ role: "member" }),
    });
    expect(res.status).toBe(200);
  });

  it("admin 可以修改成员角色", async () => {
    const res = await fetch(`${BASE}/workspaces/${fixture.wid}/members/${fixture.member.user.id}`, {
      method: "PATCH",
      headers: { ...authHeader(fixture.admin.accessToken), "Content-Type": "application/json" },
      body: JSON.stringify({ role: "member" }),
    });
    expect(res.status).toBe(200);
  });

  it("member 修改他人角色返回 403", async () => {
    const res = await fetch(`${BASE}/workspaces/${fixture.wid}/members/${fixture.admin.user.id}`, {
      method: "PATCH",
      headers: { ...authHeader(fixture.member.accessToken), "Content-Type": "application/json" },
      body: JSON.stringify({ role: "member" }),
    });
    expect(res.status).toBe(403);
  });

  it("不能修改 owner 的角色", async () => {
    const res = await fetch(`${BASE}/workspaces/${fixture.wid}/members/${fixture.owner.user.id}`, {
      method: "PATCH",
      headers: { ...authHeader(fixture.admin.accessToken), "Content-Type": "application/json" },
      body: JSON.stringify({ role: "member" }),
    });
    expect(res.status).toBe(403);
  });

  it("角色值非法返回 400", async () => {
    const res = await fetch(`${BASE}/workspaces/${fixture.wid}/members/${fixture.member.user.id}`, {
      method: "PATCH",
      headers: { ...authHeader(fixture.owner.accessToken), "Content-Type": "application/json" },
      body: JSON.stringify({ role: "superadmin" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("RBAC: 移除成员权限", () => {
  it("member 移除他人返回 403", async () => {
    const res = await fetch(`${BASE}/workspaces/${fixture.wid}/members/${fixture.admin.user.id}`, {
      method: "DELETE",
      headers: authHeader(fixture.member.accessToken),
    });
    expect(res.status).toBe(403);
  });

  it("不能移除自己", async () => {
    // 用 admin 删自己：admin 有移除权限，才会命中"不能移除自己"守卫返回 400
    // （若用 member，会先被权限检查拦截返回 403，测不到该守卫）
    const res = await fetch(`${BASE}/workspaces/${fixture.wid}/members/${fixture.admin.user.id}`, {
      method: "DELETE",
      headers: authHeader(fixture.admin.accessToken),
    });
    expect(res.status).toBe(400);
  });

  it("不能移除 owner", async () => {
    const res = await fetch(`${BASE}/workspaces/${fixture.wid}/members/${fixture.owner.user.id}`, {
      method: "DELETE",
      headers: authHeader(fixture.admin.accessToken),
    });
    expect(res.status).toBe(403);
  });

  it("owner 可以移除普通成员", async () => {
    // Arrange - 先邀请一个临时成员
    const tempUser = await registerUser({ prefix: "rbac-remove-temp" });
    await inviteMember(fixture.owner.accessToken, fixture.wid, tempUser.user.email);

    // Act
    const res = await fetch(`${BASE}/workspaces/${fixture.wid}/members/${tempUser.user.id}`, {
      method: "DELETE",
      headers: authHeader(fixture.owner.accessToken),
    });

    // Assert
    expect(res.status).toBe(200);
  });
});

describe("RBAC: 计费权限（仅 owner）", () => {
  it("member 访问计费返回 403", async () => {
    const res = await fetch(`${BASE}/workspaces/${fixture.wid}/billing/checkout`, {
      method: "POST",
      headers: { ...authHeader(fixture.member.accessToken), "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });

  it("admin 访问计费返回 403", async () => {
    const res = await fetch(`${BASE}/workspaces/${fixture.wid}/billing/checkout`, {
      method: "POST",
      headers: { ...authHeader(fixture.admin.accessToken), "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });
});

describe("RBAC: 任务读权限（所有成员可读）", () => {
  it("owner 可以读任务列表", async () => {
    const res = await fetch(`${BASE}/workspaces/${fixture.wid}/tasks`, {
      headers: authHeader(fixture.owner.accessToken),
    });
    expect(res.status).toBe(200);
  });

  it("admin 可以读任务列表", async () => {
    const res = await fetch(`${BASE}/workspaces/${fixture.wid}/tasks`, {
      headers: authHeader(fixture.admin.accessToken),
    });
    expect(res.status).toBe(200);
  });

  it("member 可以读任务列表", async () => {
    const res = await fetch(`${BASE}/workspaces/${fixture.wid}/tasks`, {
      headers: authHeader(fixture.member.accessToken),
    });
    expect(res.status).toBe(200);
  });

  it("外部用户读任务返回 401/403/404", async () => {
    const res = await fetch(`${BASE}/workspaces/${fixture.wid}/tasks`, {
      headers: authHeader(fixture.outsider.accessToken),
    });
    expect([401, 403, 404]).toContain(res.status);
  });
});

describe("RBAC: viewer 只读角色（矩阵 tasks=r，此前零覆盖）", () => {
  let taskId: string;

  beforeAll(async () => {
    const created = await createTask(fixture.owner.accessToken, fixture.wid, {
      title: "viewer 权限用例目标任务",
    });
    taskId = created.body?.data?.id ?? "";
    expect(taskId, `owner 建任务应成功，实际 ${created.status}`).toBeTruthy();
  });

  it("viewer 可以读任务列表（r 权限应放行）", async () => {
    const res = await fetch(`${BASE}/workspaces/${fixture.wid}/tasks`, {
      headers: authHeader(fixture.viewer.accessToken),
    });
    expect(res.status).toBe(200);
  });

  it("viewer 创建任务返回 403", async () => {
    const res = await fetch(`${BASE}/workspaces/${fixture.wid}/tasks`, {
      method: "POST",
      headers: { ...authHeader(fixture.viewer.accessToken), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "viewer 不该建成的任务" }),
    });
    expect(res.status).toBe(403);
  });

  it("viewer 修改任务字段返回 403（PATCH 本体，非改指派人）", async () => {
    const res = await fetch(`${BASE}/workspaces/${fixture.wid}/tasks/${taskId}`, {
      method: "PATCH",
      headers: { ...authHeader(fixture.viewer.accessToken), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "viewer 不该改动的标题" }),
    });
    expect(res.status).toBe(403);
  });

  it("viewer 删除任务返回 403", async () => {
    const res = await fetch(`${BASE}/workspaces/${fixture.wid}/tasks/${taskId}`, {
      method: "DELETE",
      headers: authHeader(fixture.viewer.accessToken),
    });
    expect(res.status).toBe(403);
  });

  it("member 仍可创建任务（回归锚点：别把 member 一起锁死）", async () => {
    const res = await fetch(`${BASE}/workspaces/${fixture.wid}/tasks`, {
      method: "POST",
      headers: { ...authHeader(fixture.member.accessToken), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "member 应可创建" }),
    });
    expect([200, 201]).toContain(res.status);
  });
});

describe("RBAC: viewer 对多维表格数据面只读（databaseRecords 矩阵）", () => {
  let dbId = "";
  let recordId = "";

  beforeAll(async () => {
    // owner 建库（容器级 owner/admin 门禁保持原样，未改动）
    const db = await fetch(`${BASE}/workspaces/${fixture.wid}/databases`, {
      method: "POST",
      headers: { ...authHeader(fixture.owner.accessToken), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "viewer 权限用例库" }),
    });
    expect(db.status, "owner 建多维表格应成功").toBe(201);
    const dbJson = await db.json();
    dbId = dbJson?.data?.id ?? "";
    expect(dbId).toBeTruthy();

    // owner 建一条记录供 viewer 改/删
    const rec = await fetch(`${BASE}/workspaces/${fixture.wid}/databases/${dbId}/records`, {
      method: "POST",
      headers: { ...authHeader(fixture.owner.accessToken), "Content-Type": "application/json" },
      body: JSON.stringify({ data: { 标题: "owner 的记录" } }),
    });
    expect(rec.status, "owner 建记录应成功").toBe(201);
    const recJson = await rec.json();
    recordId = recJson?.data?.id ?? "";
    expect(recordId).toBeTruthy();
  });

  it("viewer 可读记录（r 权限放行）", async () => {
    const res = await fetch(`${BASE}/workspaces/${fixture.wid}/databases/${dbId}/records`, {
      headers: authHeader(fixture.viewer.accessToken),
    });
    expect(res.status).toBe(200);
  });

  it("viewer 创建记录返回 403（此前仅有成员资格校验，可直接写入）", async () => {
    const res = await fetch(`${BASE}/workspaces/${fixture.wid}/databases/${dbId}/records`, {
      method: "POST",
      headers: { ...authHeader(fixture.viewer.accessToken), "Content-Type": "application/json" },
      body: JSON.stringify({ data: { 标题: "viewer 不该建成的记录" } }),
    });
    expect(res.status).toBe(403);
  });

  it("viewer 改记录返回 403", async () => {
    const res = await fetch(
      `${BASE}/workspaces/${fixture.wid}/databases/${dbId}/records/${recordId}`,
      {
        method: "PATCH",
        headers: { ...authHeader(fixture.viewer.accessToken), "Content-Type": "application/json" },
        body: JSON.stringify({ data: { 标题: "viewer 不该改动的记录" } }),
      },
    );
    expect(res.status).toBe(403);
  });

  it("viewer 删记录返回 403", async () => {
    const res = await fetch(
      `${BASE}/workspaces/${fixture.wid}/databases/${dbId}/records/${recordId}`,
      { method: "DELETE", headers: authHeader(fixture.viewer.accessToken) },
    );
    expect(res.status).toBe(403);
  });

  it("member 仍可创建记录（回归锚点：矩阵给 member 的是 crud，别一并锁死）", async () => {
    const res = await fetch(`${BASE}/workspaces/${fixture.wid}/databases/${dbId}/records`, {
      method: "POST",
      headers: { ...authHeader(fixture.member.accessToken), "Content-Type": "application/json" },
      body: JSON.stringify({ data: { 标题: "member 应可写入" } }),
    });
    expect([200, 201]).toContain(res.status);
  });

  it("viewer 仍不能建多维表格（容器级 owner/admin 门禁未被放宽）", async () => {
    const res = await fetch(`${BASE}/workspaces/${fixture.wid}/databases`, {
      method: "POST",
      headers: { ...authHeader(fixture.viewer.accessToken), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "viewer 不该建成的库" }),
    });
    expect(res.status).toBe(403);
  });
});

/**
 * AI 落位面（ai/tools/execute、ai/orchestrate）此前只做成员资格校验，
 * 只读成员可经"AI 建议 → 用户确认"这条链路写任务，绕过矩阵里 tasks=r 的声明。
 * 修法是与手工路由共用同一条规则（requirePermission("tasks","create")），
 * 并把鉴权判定提到"AI 服务是否配置"之前——否则无 key 环境（含 CI）永远测不到这条分支。
 */
describe("RBAC: viewer 不能经 AI 落位绕过只读", () => {
  it("viewer 经 ai/tools/execute 建任务返回 403", async () => {
    const res = await fetch(`${BASE}/ai/tools/execute`, {
      method: "POST",
      headers: { ...authHeader(fixture.viewer.accessToken), "Content-Type": "application/json" },
      body: JSON.stringify({
        toolName: "create_task",
        args: { title: "viewer 不该经 AI 建成的任务" },
        workspaceId: fixture.wid,
      }),
    });
    expect(res.status).toBe(403);
  });

  it("member 经 ai/tools/execute 可建任务（回归锚点：别把 member 一起锁死）", async () => {
    const res = await fetch(`${BASE}/ai/tools/execute`, {
      method: "POST",
      headers: { ...authHeader(fixture.member.accessToken), "Content-Type": "application/json" },
      body: JSON.stringify({
        toolName: "create_task",
        args: { title: "member 应可经 AI 落位的任务" },
        workspaceId: fixture.wid,
      }),
    });
    expect(res.status, "member 不该被 403").toBe(200);
  });

  it("viewer 经 ai/orchestrate 落位 createTask 返回 403", async () => {
    const res = await fetch(`${BASE}/ai/orchestrate`, {
      method: "PATCH",
      headers: { ...authHeader(fixture.viewer.accessToken), "Content-Type": "application/json" },
      body: JSON.stringify({
        wid: fixture.wid,
        actions: [
          {
            type: "createTask",
            title: "viewer 不该经联动建成的任务",
            description: "",
            priority: "medium",
          },
        ],
      }),
    });
    expect(res.status).toBe(403);
  });

  it("member 经 ai/orchestrate 不被鉴权拦截（无 AI key 时到 503，说明已过权限门禁）", async () => {
    const res = await fetch(`${BASE}/ai/orchestrate`, {
      method: "PATCH",
      headers: { ...authHeader(fixture.member.accessToken), "Content-Type": "application/json" },
      body: JSON.stringify({
        wid: fixture.wid,
        actions: [
          {
            type: "createTask",
            title: "member 应通过鉴权段的联动任务",
            description: "",
            priority: "medium",
          },
        ],
      }),
    });
    // 断言的是"权限段没拦住"：403 才是回归；后续 503（无 key）/200（有 key）都不算失败
    expect(res.status, `member 不该被 403，实际 ${res.status}`).not.toBe(403);
  });
});
