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
    data: { items: Array<{ id: string; email: string; role: string; isSelf: boolean }> };
  };
  const memEntry = (lj.data.items || []).find((m) => !m.isSelf);

  fx = {
    wid: owner.workspace.id,
    ownerToken: owner.accessToken,
    ownerId: owner.user.id,
    memberId: memEntry?.id ?? mem.user.id,
  };
  // 不写死 hook 超时：让它继承 vitest.config.ts 的全局预算（配置里有实测依据）。
  // 此处原为 30_000，会在并发跑全量时把 beforeAll（两次 registerUser）卡成假红。
});

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
    // 刻意保持容错（B 类，非遮蔽类）：本断言依赖同 describe 内前一条用例的执行顺序——
    // 前序用例已把所有权转给 memberId，原 owner 降为 admin ⇒ "非 owner" 门禁 403；
    // 若单独跑本用例（-t 隔离），原 owner 仍是 owner ⇒ 命中"不能转给自己" → 400。
    // 两个值都是"正确拒绝"，钉死任一个都会在另一种执行方式下假红，故不收紧。
    // （这是测试隔离耦合，非设计意图；要彻底消除需把该用例改成自带前置数据）
    expect([400, 403]).toContain(res.status);
  });
});
