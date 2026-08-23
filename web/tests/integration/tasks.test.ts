import { describe, it, expect, beforeAll } from "vitest";
import { BASE, registerUser, authHeader, createTask } from "../helpers";

/**
 * 任务 CRUD 集成测试
 *
 * 覆盖：
 * 1. 创建任务（POST）— 字段校验、默认值、assignee 校验
 * 2. 查询任务（GET 列表 / GET 详情）— 隔离、404
 * 3. 更新任务（PATCH）— 部分更新、状态枚举、sortOrder
 * 4. 删除任务（DELETE）— 404、跨工作区防护
 * 5. 跨工作区防护 — A 的 token 不能操作 B 的任务
 */

let token: string;
let wid: string;
let otherToken: string;
let otherWid: string;

beforeAll(async () => {
  const owner = await registerUser({ prefix: "task-owner", workspaceName: "任务 CRUD 工作区" });
  token = owner.accessToken;
  wid = owner.workspace.id;

  const other = await registerUser({ prefix: "task-other" });
  otherToken = other.accessToken;
  otherWid = other.workspace.id;
});

describe("任务创建 POST /tasks", () => {
  it("创建任务成功，返回 201 并带默认 status=pending 和 priority=medium", async () => {
    // Act
    const res = await fetch(`${BASE}/workspaces/${wid}/tasks`, {
      method: "POST",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "测试任务1" }),
    });
    const json = await res.json();

    // Assert
    expect(res.status).toBe(201);
    expect(json.code).toBe(201);
    expect(json.data.id).toBeDefined();
    expect(json.data.title).toBe("测试任务1");
    expect(json.data.status).toBe("todo");
    expect(json.data.priority).toBe("medium");
    expect(json.data.sortOrder).toBeDefined();
  });

  it("创建任务时指定 status 和 priority", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/tasks`, {
      method: "POST",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "指定状态任务", status: "in_progress", priority: "urgent" }),
    });
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.data.status).toBe("in_progress");
    expect(json.data.priority).toBe("urgent");
  });

  it("标题为空返回 400", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/tasks`, {
      method: "POST",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("标题超长（>255）返回 400", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/tasks`, {
      method: "POST",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "x".repeat(256) }),
    });
    expect(res.status).toBe(400);
  });

  it("status 非法枚举值返回 400", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/tasks`, {
      method: "POST",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "非法状态", status: "doing" }),
    });
    expect(res.status).toBe(400);
  });

  it("priority 非法枚举值返回 400", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/tasks`, {
      method: "POST",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "非法优先级", priority: "critical" }),
    });
    expect(res.status).toBe(400);
  });

  it("assigneeId 指向非工作区成员返回 400", async () => {
    // otherUser 不属于 wid 工作区
    const other = await registerUser({ prefix: "task-nonmember" });
    const res = await fetch(`${BASE}/workspaces/${wid}/tasks`, {
      method: "POST",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "非法指派", assigneeId: other.user.id }),
    });
    expect(res.status).toBe(400);
  });

  it("未认证返回 401", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "无 token" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("任务查询 GET /tasks", () => {
  it("GET 列表返回数组", async () => {
    // Arrange - 先创建一个任务
    await createTask(token, wid, { title: "查询测试任务" });

    // Act
    const res = await fetch(`${BASE}/workspaces/${wid}/tasks`, {
      headers: authHeader(token),
    });
    const json = await res.json();

    // Assert
    expect(res.status).toBe(200);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.length).toBeGreaterThan(0);
  });

  it("GET 详情返回单个任务", async () => {
    // Arrange
    const created = await createTask(token, wid, { title: "详情测试任务" });
    const taskId = created.body.data!.id;

    // Act
    const res = await fetch(`${BASE}/workspaces/${wid}/tasks/${taskId}`, {
      headers: authHeader(token),
    });
    const json = await res.json();

    // Assert
    expect(res.status).toBe(200);
    expect(json.data.id).toBe(taskId);
    expect(json.data.title).toBe("详情测试任务");
  });

  it("GET 不存在的任务 ID 返回 404", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/tasks/00000000-0000-0000-0000-000000000000`, {
      headers: authHeader(token),
    });
    expect(res.status).toBe(404);
  });

  it("assignee=me 过滤仅返回指派给当前用户的任务", async () => {
    // Arrange - 创建指派给自己的任务和未指派的任务
    const owner = await registerUser({ prefix: "task-assignee-me" });
    const assignedToMe = await createTask(owner.accessToken, owner.workspace.id, {
      title: "指派给我",
      assigneeId: owner.user.id,
    });
    expect(assignedToMe.status).toBe(201);
    await createTask(owner.accessToken, owner.workspace.id, { title: "未指派" });

    // Act
    const res = await fetch(
      `${BASE}/workspaces/${owner.workspace.id}/tasks?assignee=me`,
      { headers: authHeader(owner.accessToken) },
    );
    const json = await res.json();

    // Assert
    expect(res.status).toBe(200);
    expect(json.data.every((t: { assigneeId?: string }) => t.assigneeId === owner.user.id)).toBe(true);
    expect(json.data.some((t: { id: string }) => t.id === assignedToMe.body.data!.id)).toBe(true);
  });
});

describe("任务更新 PATCH /tasks/:id", () => {
  it("部分更新 title", async () => {
    // Arrange
    const created = await createTask(token, wid, { title: "更新前" });
    const taskId = created.body.data!.id;

    // Act
    const res = await fetch(`${BASE}/workspaces/${wid}/tasks/${taskId}`, {
      method: "PATCH",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "更新后" }),
    });
    const json = await res.json();

    // Assert
    expect(res.status).toBe(200);
    expect(json.data.title).toBe("更新后");
  });

  it("更新 status 和 sortOrder 持久化", async () => {
    const created = await createTask(token, wid, { title: "拖拽测试" });
    const taskId = created.body.data!.id;

    const patchRes = await fetch(`${BASE}/workspaces/${wid}/tasks/${taskId}`, {
      method: "PATCH",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ status: "done", sortOrder: 42.5 }),
    });
    expect(patchRes.status).toBe(200);

    // 重新拉取确认持久化
    const getRes = await fetch(`${BASE}/workspaces/${wid}/tasks/${taskId}`, {
      headers: authHeader(token),
    });
    const json = await getRes.json();
    expect(json.data.status).toBe("done");
    expect(json.data.sortOrder).toBe(42.5);
  });

  it("PATCH 不存在的任务返回 404", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/tasks/00000000-0000-0000-0000-000000000000`, {
      method: "PATCH",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "不存在" }),
    });
    expect(res.status).toBe(404);
  });

  it("PATCH status 非法值返回 400", async () => {
    const created = await createTask(token, wid, { title: "非法状态更新" });
    const res = await fetch(`${BASE}/workspaces/${wid}/tasks/${created.body.data!.id}`, {
      method: "PATCH",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ status: "archived" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("任务删除 DELETE /tasks/:id", () => {
  it("删除任务成功返回 200", async () => {
    // Arrange
    const created = await createTask(token, wid, { title: "待删除" });
    const taskId = created.body.data!.id;

    // Act
    const res = await fetch(`${BASE}/workspaces/${wid}/tasks/${taskId}`, {
      method: "DELETE",
      headers: authHeader(token),
    });

    // Assert
    expect(res.status).toBe(200);

    // 验证已删除
    const getRes = await fetch(`${BASE}/workspaces/${wid}/tasks/${taskId}`, {
      headers: authHeader(token),
    });
    expect(getRes.status).toBe(404);
  });

  it("DELETE 不存在的任务返回 404", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/tasks/00000000-0000-0000-0000-000000000000`, {
      method: "DELETE",
      headers: authHeader(token),
    });
    expect(res.status).toBe(404);
  });
});

describe("跨工作区防护", () => {
  it("A 的 token 不能读 B 工作区的任务列表", async () => {
    const res = await fetch(`${BASE}/workspaces/${otherWid}/tasks`, {
      headers: authHeader(token),
    });
    expect([401, 403, 404]).toContain(res.status);
  });

  it("A 的 token 不能读 B 工作区的任务详情", async () => {
    // 在 B 创建任务
    const bTask = await createTask(otherToken, otherWid, { title: "B 的任务" });
    const taskId = bTask.body.data!.id;

    // A 尝试读
    const res = await fetch(`${BASE}/workspaces/${otherWid}/tasks/${taskId}`, {
      headers: authHeader(token),
    });
    expect([401, 403, 404]).toContain(res.status);
  });

  it("A 的 token 不能更新 B 工作区的任务", async () => {
    const bTask = await createTask(otherToken, otherWid, { title: "B 的待更新任务" });
    const taskId = bTask.body.data!.id;

    const res = await fetch(`${BASE}/workspaces/${otherWid}/tasks/${taskId}`, {
      method: "PATCH",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "被 A 篡改" }),
    });
    expect([401, 403, 404]).toContain(res.status);

    // 验证 B 的任务未被改动
    const getRes = await fetch(`${BASE}/workspaces/${otherWid}/tasks/${taskId}`, {
      headers: authHeader(otherToken),
    });
    const json = await getRes.json();
    expect(json.data.title).toBe("B 的待更新任务");
  });

  it("A 的 token 不能删除 B 工作区的任务", async () => {
    const bTask = await createTask(otherToken, otherWid, { title: "B 的待删除任务" });
    const taskId = bTask.body.data!.id;

    const res = await fetch(`${BASE}/workspaces/${otherWid}/tasks/${taskId}`, {
      method: "DELETE",
      headers: authHeader(token),
    });
    expect([401, 403, 404]).toContain(res.status);

    // 验证 B 的任务仍存在
    const getRes = await fetch(`${BASE}/workspaces/${otherWid}/tasks/${taskId}`, {
      headers: authHeader(otherToken),
    });
    expect(getRes.status).toBe(200);
  });
});