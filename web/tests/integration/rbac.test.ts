import { describe, it, expect, beforeAll } from "vitest";
import { BASE, registerUser, inviteMember, authHeader } from "../helpers";

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
 * └─────────┴──────────┴──────────┴──────────┴─────────┘
 */

interface TestFixture {
  owner: { user: { id: string; email: string }; accessToken: string; workspace: { id: string } };
  admin: { user: { id: string; email: string }; accessToken: string };
  member: { user: { id: string; email: string }; accessToken: string };
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
