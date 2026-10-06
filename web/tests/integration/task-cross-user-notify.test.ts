import { describe, it, expect, beforeAll } from "vitest";
import {
  BASE,
  registerUser,
  authHeader,
  inviteMember,
  wsBoundToken,
  createTask,
  notificationsOfType,
} from "../helpers";

/**
 * 任务族「给他人发通知」的回归钉：改派 / 评论 / 决议
 *
 * 与 approval-cross-user.test.ts 同一条机理，但**这一族当前是绿的**（2026-10-06 hardened
 * 腿实测 3/3 通过）。原因：这些调用点是 `runWithWorkspace(wid, fn)`——没传第三个参数
 * userId ⇒ `app.user_id` 未设置 ⇒ notifications 的 SELECT 策略走容错分支放行 RETURNING，
 * `notification.create()` 侥幸可用。
 *
 * 所以本文件的价值不是报缺陷，而是钉住这个隐含前提：一旦有人给任务族补上 user 作用域
 * （安全上是对的方向），这三条就会变红，届时应改走 lib/notification/record.ts 的
 * notifyUsers，而不是回退成"不传 userId"。判据仍是两条：动作不 5xx + 接收方读得到。
 */

let ownerToken: string; // 操作者（工作区 owner）
let assigneeToken: string; // 被指派人 = 通知接收者
let assigneeId: string;
let wid: string;

async function newTask(title: string): Promise<string> {
  const created = await createTask(ownerToken, wid, { title });
  expect(created.status, `建任务应 201，实得 ${created.status}`).toBe(201);
  const id = created.body?.data?.id;
  expect(id, `建任务响应缺 id：${JSON.stringify(created.body).slice(0, 200)}`).toBeTruthy();
  return id as string;
}

async function postJson(path: string, token: string, payload: Record<string, unknown>) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: res.status, text: await res.text().catch(() => "") };
}

async function patchTask(taskId: string, payload: Record<string, unknown>) {
  const res = await fetch(`${BASE}/workspaces/${wid}/tasks/${taskId}`, {
    method: "PATCH",
    headers: { ...authHeader(ownerToken), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: res.status, text: await res.text().catch(() => "") };
}

beforeAll(async () => {
  const owner = await registerUser({ prefix: "taskx-owner", workspaceName: "任务跨用户通知测试" });
  ownerToken = owner.accessToken;
  wid = owner.workspace.id;

  const assignee = await registerUser({ prefix: "taskx-assignee" });
  assigneeId = assignee.user.id;
  expect((await inviteMember(ownerToken, wid, assignee.user.email)).status).toBe(201);
  assigneeToken = (await wsBoundToken(assignee.cookies, wid)) ?? "";
  expect(assigneeToken).toBeTruthy();
});

describe("任务族跨用户通知（FORCE RLS 生产形态）", () => {
  it("改派任务给他人 → 被指派人收到 task_assigned", async () => {
    const taskId = await newTask("跨用户-改派");
    const r = await patchTask(taskId, { assigneeId });
    expect(r.status, `改派不应 5xx：${r.text.slice(0, 300)}`).toBeLessThan(500);
    expect([200, 201]).toContain(r.status);
    const rows = await notificationsOfType(assigneeToken, wid, "task_assigned");
    expect(rows.length, "被指派人应收到改派通知；0 条=写入没落地或发给了别人").toBeGreaterThan(0);
  });

  it("他人评论任务 → 被指派人收到 comment_added", async () => {
    const taskId = await newTask("跨用户-评论");
    expect((await patchTask(taskId, { assigneeId })).status).toBeLessThan(500);
    const r = await postJson(`/workspaces/${wid}/tasks/${taskId}/comments`, ownerToken, {
      body: "跨用户通知测试评论",
    });
    expect(r.status, `评论不应 5xx：${r.text.slice(0, 300)}`).toBeLessThan(500);
    expect([200, 201]).toContain(r.status);
    expect((await notificationsOfType(assigneeToken, wid, "comment_added")).length).toBeGreaterThan(
      0,
    );
  });

  it("他人立决议 → 被指派人收到 decision_updated", async () => {
    const taskId = await newTask("跨用户-决议");
    expect((await patchTask(taskId, { assigneeId })).status).toBeLessThan(500);
    const r = await postJson(`/workspaces/${wid}/tasks/${taskId}/decisions`, ownerToken, {
      markdown: "## 决议\n跨用户通知测试",
    });
    expect(r.status, `决议不应 5xx：${r.text.slice(0, 300)}`).toBeLessThan(500);
    expect([200, 201]).toContain(r.status);
    expect(
      (await notificationsOfType(assigneeToken, wid, "decision_updated")).length,
    ).toBeGreaterThan(0);
  });
});
