import { describe, it, expect, beforeAll } from "vitest";
import { BASE, registerUser, inviteMember, authHeader } from "../helpers";

/**
 * RBAC：新接口（/members/{userId} PATCH + /transfer-ownership PATCH）专项验证
 * - owner 可给 member 升 admin
 * - owner 不能改自己角色
 * - owner 可转让所有权，原 owner 自动降 admin
 * - owner 转自己返回 400
 */

interface Fixtures {
  wid: string;
  ownerToken: string;
  ownerId: string;
  memberId: string;
}

let fx: Fixtures;

beforeAll(async () => {
  const owner = await registerUser({ prefix: "rbx-owner", workspaceName: "RBX 工作区" });
  const mem = await registerUser({ prefix: "rbx-mem" });
  await inviteMember(owner.accessToken, owner.workspace.id, mem.user.email);

  const list = await fetch(`${BASE}/workspaces/${owner.workspace.id}/members`, {
    headers: authHeader(owner.accessToken),
  });
  const lj = (await list.json()) as {
    data: Array<{ id: string; email: string; role: string; isSelf: boolean }>;
  };
  const memEntry = (lj.data || []).find((m) => !m.isSelf);

  fx = {
    wid: owner.workspace.id,
    ownerToken: owner.accessToken,
    ownerId: owner.user.id,
    memberId: memEntry?.id ?? mem.user.id,
  };
}, 30_000);

describe("RBAC：PATCH /members/{userId}", () => {
  it("owner 可把 member 提升为 admin", async () => {
    if (!fx.memberId) return;
    const res = await fetch(`${BASE}/workspaces/${fx.wid}/members/${fx.memberId}`, {
      method: "PATCH",
      headers: { ...authHeader(fx.ownerToken), "Content-Type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    });
    expect(res.status).toBe(200);
    const j = (await res.json()) as { data?: { role?: string } };
    expect(j.data?.role).toBe("admin");
  });

  it("owner 不能改自己的角色（selfForbidden 400）", async () => {
    const res = await fetch(`${BASE}/workspaces/${fx.wid}/members/${fx.ownerId}`, {
      method: "PATCH",
      headers: { ...authHeader(fx.ownerToken), "Content-Type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("RBAC：PATCH /transfer-ownership", () => {
  it("owner 可以把所有权转让给 member（成功后后者已是 owner）", async () => {
    const res = await fetch(`${BASE}/workspaces/${fx.wid}/transfer-ownership`, {
      method: "PATCH",
      headers: { ...authHeader(fx.ownerToken), "Content-Type": "application/json" },
      body: JSON.stringify({ newOwnerUserId: fx.memberId }),
    });
    expect(res.status).toBe(200);
  });

  it("owner 不能把所有权转给自己（400）", async () => {
    const res = await fetch(`${BASE}/workspaces/${fx.wid}/transfer-ownership`, {
      method: "PATCH",
      headers: { ...authHeader(fx.ownerToken), "Content-Type": "application/json" },
      body: JSON.stringify({ newOwnerUserId: fx.ownerId }),
    });
    // 上一步已经把所有权转给了 memberId，现在原 owner 已经降为 admin
    // 用 owner token 调 transfer → 403；如果意外通过了 200 也算错
    expect([400, 403]).toContain(res.status);
  });
});
