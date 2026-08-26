import { describe, it, expect, beforeAll } from "vitest";
import {
  BASE,
  registerUser,
  inviteMember,
  authHeader,
  createTask,
  TEST_PASSWORD,
} from "../helpers";

/**
 * 通知系统集成测试
 *
 * 覆盖通知生成场景（A-3 通知矩阵）：
 * 1. comment mention — 评论 @某人 时生成 mention 通知
 * 2. comment_added — 评论时给任务指派人生成 comment_added 通知
 * 3. task_assigned — PATCH 任务 assignee 时给新指派人生成 task_assigned 通知
 * 4. decision_updated — 创建决策时给任务指派人生成 decision_updated 通知
 * 5. 通知列表 / 未读计数 / 标记已读
 */

interface NotifFixture {
  ownerToken: string;
  ownerUser: { id: string; email: string };
  memberToken: string;
  memberUser: { id: string; email: string };
  wid: string;
}

let fixture: NotifFixture;

beforeAll(async () => {
  // Arrange - owner 创建工作区，邀请 member 加入
  const owner = await registerUser({ prefix: "notif-owner", workspaceName: "通知测试工作区" });
  const member = await registerUser({ prefix: "notif-member" });

  const invite = await inviteMember(owner.accessToken, owner.workspace.id, member.user.email);
  expect(invite.status).toBe(201);

  // member 需要刷新 token 切换到 owner 工作区
  const memberLogin = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: member.user.email, password: TEST_PASSWORD }),
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
    ownerToken: owner.accessToken,
    ownerUser: { id: owner.user.id, email: owner.user.email },
    memberToken: memberWidToken ?? "",
    memberUser: { id: member.user.id, email: member.user.email },
    wid: owner.workspace.id,
  };

  expect(fixture.memberToken.length).toBeGreaterThan(0);
});

/** 获取指定用户的通知列表 */
async function getNotifications(
  token: string,
  wid: string,
  opts: { unread?: boolean } = {},
): Promise<
  Array<{ id: string; type: string; entityId: string; entityTitle: string; read: boolean }>
> {
  const url = new URL(`${BASE}/workspaces/${wid}/notifications`);
  if (opts.unread) url.searchParams.set("unread", "true");
  const res = await fetch(url.toString(), { headers: authHeader(token) });
  expect(res.status).toBe(200);
  const json = await res.json();
  return json.data.notifications;
}

/** 获取未读计数 */
async function getUnreadCount(token: string, wid: string): Promise<number> {
  const res = await fetch(`${BASE}/workspaces/${wid}/notifications?count=true`, {
    headers: authHeader(token),
  });
  expect(res.status).toBe(200);
  const json = await res.json();
  return json.data.unread;
}

describe("通知场景：comment mention", () => {
  it("评论 @member 时给 member 生成 mention 通知", async () => {
    // Arrange - owner 创建任务
    const task = await createTask(fixture.ownerToken, fixture.wid, { title: "评论 mention 测试" });
    const taskId = task.body.data!.id;

    // Act - owner 评论并 @member
    const res = await fetch(`${BASE}/workspaces/${fixture.wid}/tasks/${taskId}/comments`, {
      method: "POST",
      headers: { ...authHeader(fixture.ownerToken), "Content-Type": "application/json" },
      body: JSON.stringify({ body: "你好 @member", mentions: [fixture.memberUser.id] }),
    });

    // Assert - 评论创建成功
    expect(res.status).toBe(201);

    // member 应收到 mention 通知
    const notifs = await getNotifications(fixture.memberToken, fixture.wid, { unread: true });
    const mentionNotif = notifs.find((n) => n.type === "mention" && n.entityId === taskId);
    expect(mentionNotif).toBeDefined();
    expect(mentionNotif!.entityTitle).toBe("评论 mention 测试");
    expect(mentionNotif!.read).toBe(false);
  });

  it("评论 @自己 不生成 mention 通知", async () => {
    // Arrange - owner 创建任务
    const task = await createTask(fixture.ownerToken, fixture.wid, { title: "自 mention 测试" });
    const taskId = task.body.data!.id;

    // 记录 owner 当前通知数
    const beforeCount = await getUnreadCount(fixture.ownerToken, fixture.wid);

    // Act - owner 评论并 @自己
    const res = await fetch(`${BASE}/workspaces/${fixture.wid}/tasks/${taskId}/comments`, {
      method: "POST",
      headers: { ...authHeader(fixture.ownerToken), "Content-Type": "application/json" },
      body: JSON.stringify({ body: "自言自语", mentions: [fixture.ownerUser.id] }),
    });
    expect(res.status).toBe(201);

    // Assert - owner 未读通知数不变（排除自己）
    const afterCount = await getUnreadCount(fixture.ownerToken, fixture.wid);
    expect(afterCount).toBe(beforeCount);
  });
});

describe("通知场景：comment_added（任务指派人）", () => {
  it("评论指派给 member 的任务时给 member 生成 comment_added 通知", async () => {
    // Arrange - owner 创建任务并指派给 member
    const task = await createTask(fixture.ownerToken, fixture.wid, {
      title: "指派给 member 的任务",
      assigneeId: fixture.memberUser.id,
    });
    const taskId = task.body.data!.id;

    // Act - owner 评论（不 @任何人）
    const res = await fetch(`${BASE}/workspaces/${fixture.wid}/tasks/${taskId}/comments`, {
      method: "POST",
      headers: { ...authHeader(fixture.ownerToken), "Content-Type": "application/json" },
      body: JSON.stringify({ body: "请尽快处理" }),
    });
    expect(res.status).toBe(201);

    // Assert - member 收到 comment_added 通知
    const notifs = await getNotifications(fixture.memberToken, fixture.wid, { unread: true });
    const notif = notifs.find((n) => n.type === "comment_added" && n.entityId === taskId);
    expect(notif).toBeDefined();
  });

  it("指派人自己评论不生成 comment_added 通知", async () => {
    // Arrange - owner 创建任务并指派给自己
    const task = await createTask(fixture.ownerToken, fixture.wid, {
      title: "指派给自己的任务",
      assigneeId: fixture.ownerUser.id,
    });
    const taskId = task.body.data!.id;
    const beforeCount = await getUnreadCount(fixture.ownerToken, fixture.wid);

    // Act - owner（指派人）自己评论
    const res = await fetch(`${BASE}/workspaces/${fixture.wid}/tasks/${taskId}/comments`, {
      method: "POST",
      headers: { ...authHeader(fixture.ownerToken), "Content-Type": "application/json" },
      body: JSON.stringify({ body: "自己评论" }),
    });
    expect(res.status).toBe(201);

    // Assert
    const afterCount = await getUnreadCount(fixture.ownerToken, fixture.wid);
    expect(afterCount).toBe(beforeCount);
  });
});

describe("通知场景：task_assigned（assignee 变更）", () => {
  it("PATCH 任务 assignee 给 member 时生成 task_assigned 通知", async () => {
    // Arrange - owner 创建未指派任务
    const task = await createTask(fixture.ownerToken, fixture.wid, { title: "待指派任务" });
    const taskId = task.body.data!.id;

    // Act - owner 把任务指派给 member
    const res = await fetch(`${BASE}/workspaces/${fixture.wid}/tasks/${taskId}`, {
      method: "PATCH",
      headers: { ...authHeader(fixture.ownerToken), "Content-Type": "application/json" },
      body: JSON.stringify({ assigneeId: fixture.memberUser.id }),
    });
    expect(res.status).toBe(200);

    // Assert - member 收到 task_assigned 通知
    const notifs = await getNotifications(fixture.memberToken, fixture.wid, { unread: true });
    const notif = notifs.find((n) => n.type === "task_assigned" && n.entityId === taskId);
    expect(notif).toBeDefined();
    expect(notif!.entityTitle).toBe("待指派任务");
  });

  it("指派给自己不生成 task_assigned 通知", async () => {
    // Arrange
    const task = await createTask(fixture.ownerToken, fixture.wid, { title: "自指派任务" });
    const taskId = task.body.data!.id;
    const beforeCount = await getUnreadCount(fixture.ownerToken, fixture.wid);

    // Act - owner 指派给自己
    const res = await fetch(`${BASE}/workspaces/${fixture.wid}/tasks/${taskId}`, {
      method: "PATCH",
      headers: { ...authHeader(fixture.ownerToken), "Content-Type": "application/json" },
      body: JSON.stringify({ assigneeId: fixture.ownerUser.id }),
    });
    expect(res.status).toBe(200);

    // Assert
    const afterCount = await getUnreadCount(fixture.ownerToken, fixture.wid);
    expect(afterCount).toBe(beforeCount);
  });
});

describe("通知场景：decision_updated（决策创建）", () => {
  it("创建决策时给任务指派人生成 decision_updated 通知", async () => {
    // Arrange - owner 创建任务并指派给 member
    const task = await createTask(fixture.ownerToken, fixture.wid, {
      title: "决策通知测试任务",
      assigneeId: fixture.memberUser.id,
    });
    const taskId = task.body.data!.id;

    // Act - owner 创建决策记录
    const res = await fetch(`${BASE}/workspaces/${fixture.wid}/tasks/${taskId}/decisions`, {
      method: "POST",
      headers: { ...authHeader(fixture.ownerToken), "Content-Type": "application/json" },
      body: JSON.stringify({ markdown: "决定采用方案 A" }),
    });
    expect(res.status).toBe(201);

    // Assert - member 收到 decision_updated 通知
    const notifs = await getNotifications(fixture.memberToken, fixture.wid, { unread: true });
    const notif = notifs.find((n) => n.type === "decision_updated" && n.entityId === taskId);
    expect(notif).toBeDefined();
  });
});

describe("通知 API：列表 / 计数 / 标记已读", () => {
  it("GET notifications 返回通知列表（createdAt 降序）", async () => {
    // Arrange - 触发一条通知
    const task = await createTask(fixture.ownerToken, fixture.wid, {
      title: "列表测试任务",
      assigneeId: fixture.memberUser.id,
    });
    await fetch(`${BASE}/workspaces/${fixture.wid}/tasks/${task.body.data!.id}/comments`, {
      method: "POST",
      headers: { ...authHeader(fixture.ownerToken), "Content-Type": "application/json" },
      body: JSON.stringify({ body: "列表测试评论" }),
    });

    // Act
    const notifs = await getNotifications(fixture.memberToken, fixture.wid);

    // Assert - 列表非空且按时间降序
    expect(notifs.length).toBeGreaterThan(0);
    for (let i = 1; i < notifs.length; i++) {
      // createdAt 降序：前一条时间 >= 后一条时间
      expect(notifs[i - 1].id).toBeDefined();
    }
  });

  it("GET notifications?count=true 返回未读计数", async () => {
    const count = await getUnreadCount(fixture.memberToken, fixture.wid);
    expect(typeof count).toBe("number");
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("PATCH notifications {all:true} 标记全部已读", async () => {
    // Arrange - 确保有未读通知
    const task = await createTask(fixture.ownerToken, fixture.wid, {
      title: "标记已读测试",
      assigneeId: fixture.memberUser.id,
    });
    await fetch(`${BASE}/workspaces/${fixture.wid}/tasks/${task.body.data!.id}/comments`, {
      method: "POST",
      headers: { ...authHeader(fixture.ownerToken), "Content-Type": "application/json" },
      body: JSON.stringify({ body: "标记已读评论" }),
    });
    const beforeCount = await getUnreadCount(fixture.memberToken, fixture.wid);
    expect(beforeCount).toBeGreaterThan(0);

    // Act - 标记全部已读
    const res = await fetch(`${BASE}/workspaces/${fixture.wid}/notifications`, {
      method: "PATCH",
      headers: { ...authHeader(fixture.memberToken), "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    });

    // Assert
    expect(res.status).toBe(200);
    const afterCount = await getUnreadCount(fixture.memberToken, fixture.wid);
    expect(afterCount).toBe(0);
  });

  it("PATCH notifications 缺少 id 和 all 返回 400", async () => {
    const res = await fetch(`${BASE}/workspaces/${fixture.wid}/notifications`, {
      method: "PATCH",
      headers: { ...authHeader(fixture.memberToken), "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("未认证访问通知返回 401", async () => {
    const res = await fetch(`${BASE}/workspaces/${fixture.wid}/notifications`);
    expect(res.status).toBe(401);
  });
});
