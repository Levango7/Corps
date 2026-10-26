import { describe, it, expect, beforeAll } from "vitest";
import { BASE, registerUser, authHeader, inviteMember, wsBoundToken } from "../helpers";

/**
 * approvals 域**写入侧**角色门禁的方向性测试（permission-gate T3 清债的反向证据）
 *
 * 背景：lib/permissions.ts 此前没有 approvals 模块，本域 14 个写 handler 完全在矩阵外
 * （check_permission_gates.py 的 T3 挂账）。2026-10-26 把 approvals 纳入矩阵后，
 * owner/admin/member 拿到 crud、viewer 只拿 r，写 handler 逐条接上 requirePermission。
 *
 * 本套件要钉的是**门禁确实会拦**，也就是"删掉那行 requirePermission 就会红"：
 * 1. viewer 发起审批（POST .../instances）→ 403
 * 2. viewer 写审批评论（POST .../instances/{aid}/comment）→ 403
 *
 * 以及**没有误伤**的正向对照：
 * 3. member/owner 仍可以发起审批、写评论 → 201 / 200
 *    —— 这条同样重要：member 在矩阵里必须含 u，否则
 *    approval-cross-user.test.ts 的 approve/reject/transfer/delegate/add-sign 五个
 *    动作端点会一起 403。这里用 comment 代表"同属 update 语义的动作端点"做最小确认。
 *
 * 只读方向（viewer 能读各种 GET）不在此处覆盖：见 approval-cc.test.ts 的最后一条断言。
 */

let ownerToken: string;
let wid: string;
let instanceId: string;
let viewerToken: string;
let memberToken: string;

async function createInstance(token: string, workspaceId: string, title: string) {
  const res = await fetch(`${BASE}/workspaces/${workspaceId}/approvals/instances`, {
    method: "POST",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      content: { reason: "写入侧门禁测试" },
      nodes: [{ name: "一级审批", order: 0 }],
    }),
  });
  return {
    status: res.status,
    body: (await res.json().catch(() => null)) as { code?: number; data?: { id: string } } | null,
  };
}

async function postComment(token: string, workspaceId: string, aid: string, comment: string) {
  const res = await fetch(`${BASE}/workspaces/${workspaceId}/approvals/instances/${aid}/comment`, {
    method: "POST",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: JSON.stringify({ comment }),
  });
  return {
    status: res.status,
    body: (await res.json().catch(() => null)) as { code?: number } | null,
  };
}

beforeAll(async () => {
  const owner = await registerUser({
    prefix: "approval-gate-owner",
    workspaceName: "审批写入门禁测试",
  });
  ownerToken = owner.accessToken;
  wid = owner.workspace.id;

  const created = await createInstance(ownerToken, wid, "写入侧门禁用申请");
  expect(created.status).toBe(201);
  instanceId = created.body!.data!.id;

  // viewer：只读成员，所有写动作必须被 requirePermission 挡住
  const viewer = await registerUser({ prefix: "approval-gate-viewer" });
  expect((await inviteMember(ownerToken, wid, viewer.user.email)).status).toBe(201);
  const demote = await fetch(`${BASE}/workspaces/${wid}/members/${viewer.user.id}`, {
    method: "PATCH",
    headers: { ...authHeader(ownerToken), "Content-Type": "application/json" },
    body: JSON.stringify({ role: "viewer" }),
  });
  expect(demote.status).toBe(200);
  viewerToken = (await wsBoundToken(viewer.cookies, wid)) ?? "";
  expect(viewerToken).toBeTruthy();

  // member：inviteMember 默认即是 member，写动作必须**仍然放行**
  const member = await registerUser({ prefix: "approval-gate-member" });
  expect((await inviteMember(ownerToken, wid, member.user.email)).status).toBe(201);
  memberToken = (await wsBoundToken(member.cookies, wid)) ?? "";
  expect(memberToken).toBeTruthy();
});

describe("approvals 写入侧角色门禁", () => {
  it("viewer 发起审批返回 403（此前是 201：本域完全在矩阵外）", async () => {
    const { status, body } = await createInstance(viewerToken, wid, "viewer 不应发起成功");
    expect(status).toBe(403);
    expect(body?.code).toBe(403);
  });

  it("viewer 写审批评论返回 403（viewer 对 approvals 仅 r，不得 update）", async () => {
    const { status, body } = await postComment(viewerToken, wid, instanceId, "访客不应能评论");
    expect(status).toBe(403);
    expect(body?.code).toBe(403);
  });

  it("member 仍能发起审批（member 必须含 u/c，不是 r）", async () => {
    const { status } = await createInstance(memberToken, wid, "member 发起的申请");
    expect(status).toBe(201);
  });

  it("member 仍能写审批评论（同属 update 语义的动作端点未被误伤）", async () => {
    const { status } = await postComment(memberToken, wid, instanceId, "member 的正常评论");
    expect(status).toBe(200);
  });

  it("owner 仍能写审批评论（正向对照：门禁只挡 viewer）", async () => {
    const { status } = await postComment(ownerToken, wid, instanceId, "owner 的正常评论");
    expect(status).toBe(200);
  });
});
