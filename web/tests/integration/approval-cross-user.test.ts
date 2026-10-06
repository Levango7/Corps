import { describe, it, expect, beforeAll } from "vitest";
import {
  BASE,
  registerUser,
  authHeader,
  inviteMember,
  wsBoundToken,
  notificationsOfType,
} from "../helpers";

/**
 * 审批族「给他人发通知」的集成测试：approve / reject / transfer / delegate / add-sign
 *
 * 起因（2026-10-06 在 hardened 腿实测）：这五个端点都往 notifications 写**别人**的通知，
 * 用的都是 `tx.notification.create()`。Prisma 的 create 发的是 `INSERT … RETURNING`，
 * 而 PostgreSQL 对 RETURNING 出来的行还要再过一遍该表的 SELECT 策略
 * （notifications 的 SELECT 策略要求 `user_id = app.user_id`，见 db/rls-activate.sql DL-17）。
 * 事务里的 app.user_id 是**操作者**，接收者是别人 ⇒ 在 FORCE RLS 的生产形态下
 * INSERT 直接 42501 ⇒ 端点 500。
 *
 * 为什么 CI 一直没抓到：非硬化的 Test 腿用 postgres 连库（BYPASSRLS），策略整个被绕过；
 * 而旧用例把"申请人"和"审批人"设成同一个人，`applicantId !== payload.sub` 那条分支从未走过。
 *
 * 每条用例都断两件事，缺一不算修好：
 *  1) 动作本身 2xx（不是 5xx）——钉住 42501→500 那类回归；
 *  2) **接收方**用自己的票据能在通知列表里看到这条——钉住"写成但发给了错的人"，
 *     也钉住"为了让 1 变绿而把写入悄悄删掉"。
 */

let ownerToken: string; // 申请人（建单者）+ 工作区 owner
let wid: string;
let actorId: string; // 审批人 / 转交发起人（区别于申请人）
let actorToken: string;
let targetId: string; // 转交 / 委托 / 加签的接收人
let targetToken: string;

async function newInstanceId(title: string, approverUserId: string): Promise<string> {
  const res = await fetch(`${BASE}/workspaces/${wid}/approvals/instances`, {
    method: "POST",
    headers: { ...authHeader(ownerToken), "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      content: { reason: "跨用户通知测试" },
      nodes: [{ name: "一级审批", order: 0, approverUserId }],
    }),
  });
  expect(res.status, `建审批单应 201，实得 ${res.status}`).toBe(201);
  const body = (await res.json()) as { data?: { id: string } };
  return body.data!.id;
}

async function act(
  token: string,
  aid: string,
  action: string,
  payload: Record<string, unknown> = {},
): Promise<{ status: number; text: string }> {
  const res = await fetch(`${BASE}/workspaces/${wid}/approvals/instances/${aid}/${action}`, {
    method: "POST",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: res.status, text: await res.text().catch(() => "") };
}

function expectNoServerFailure(label: string, status: number, text: string) {
  // 本用例集的靶心是 42501→500；其余 4xx 属于角色/权限语义，由别的用例负责
  expect(status, `${label} 不应 5xx，响应体：${text.slice(0, 300)}`).toBeLessThan(500);
  expect([200, 201], `${label} 应成功，响应体：${text.slice(0, 300)}`).toContain(status);
}

beforeAll(async () => {
  const owner = await registerUser({ prefix: "xuser-owner", workspaceName: "跨用户通知测试" });
  ownerToken = owner.accessToken;
  wid = owner.workspace.id;

  const actor = await registerUser({ prefix: "xuser-actor" });
  const target = await registerUser({ prefix: "xuser-target" });
  actorId = actor.user.id;
  targetId = target.user.id;
  expect((await inviteMember(ownerToken, wid, actor.user.email)).status).toBe(201);
  expect((await inviteMember(ownerToken, wid, target.user.email)).status).toBe(201);

  // 二人默认工作区不是 wid，必须换一张绑到 wid 的票（见 helpers.wsBoundToken 注释）
  actorToken = (await wsBoundToken(actor.cookies, wid)) ?? "";
  targetToken = (await wsBoundToken(target.cookies, wid)) ?? "";
  expect(actorToken).toBeTruthy();
  expect(targetToken).toBeTruthy();
});

describe("审批族跨用户通知（FORCE RLS 生产形态）", () => {
  it("审批人同意 → 申请人（≠审批人）收到 approval_result", async () => {
    const aid = await newInstanceId("跨用户-同意", actorId);
    const r = await act(actorToken, aid, "approve", { comment: "同意" });
    expectNoServerFailure("approve", r.status, r.text);
    const rows = await notificationsOfType(ownerToken, wid, "approval_result");
    expect(rows.length, "申请人应收到审批结果通知；0 条=写入没落地或发给了别人").toBeGreaterThan(0);
  });

  it("审批人驳回 → 申请人收到 approval_result", async () => {
    const aid = await newInstanceId("跨用户-驳回", actorId);
    const r = await act(actorToken, aid, "reject", { comment: "不同意" });
    expectNoServerFailure("reject", r.status, r.text);
    expect((await notificationsOfType(ownerToken, wid, "approval_result")).length).toBeGreaterThan(
      0,
    );
  });

  it("审批人转交 → 接收人收到 approval_transfer", async () => {
    const aid = await newInstanceId("跨用户-转交", actorId);
    const r = await act(actorToken, aid, "transfer", { transferToId: targetId });
    expectNoServerFailure("transfer", r.status, r.text);
    expect(
      (await notificationsOfType(targetToken, wid, "approval_transfer")).length,
    ).toBeGreaterThan(0);
  });

  it("审批人委托 → 接收人收到 approval_delegate", async () => {
    const aid = await newInstanceId("跨用户-委托", actorId);
    const r = await act(actorToken, aid, "delegate", { delegateToId: targetId });
    expectNoServerFailure("delegate", r.status, r.text);
    expect(
      (await notificationsOfType(targetToken, wid, "approval_delegate")).length,
    ).toBeGreaterThan(0);
  });

  it("审批人加签 → 接收人收到 approval_add_sign", async () => {
    const aid = await newInstanceId("跨用户-加签", actorId);
    const r = await act(actorToken, aid, "add-sign", { addSignToId: targetId });
    expectNoServerFailure("add-sign", r.status, r.text);
    expect(
      (await notificationsOfType(targetToken, wid, "approval_add_sign")).length,
    ).toBeGreaterThan(0);
  });
});
