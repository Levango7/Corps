import { describe, it, expect, beforeAll } from "vitest";
import { BASE, registerUser, authHeader } from "../helpers";

/**
 * 子任务与阻塞标记集成测试（v0.4.0 队列第 1 项）
 *
 * 覆盖：
 * 1. 创建子任务（parentId）— 成功路径、同工作区校验、层级限制（仅一层）
 * 2. 列表接口 — 顶层任务不含子任务行、subtaskTotal/subtaskDone 进度汇总
 * 3. 详情接口 — children 关联返回
 * 4. 阻塞标记 — PATCH blocked/blockedReason 设置与清除
 * 5. 跨工作区防护 — parentId 指向其他工作区的任务应 400
 */

let token: string;
let wid: string;
let otherToken: string;
let otherWid: string;

beforeAll(async () => {
  const owner = await registerUser({ prefix: "subtask-owner", workspaceName: "子任务工作区" });
  token = owner.accessToken;
  wid = owner.workspace.id;

  const other = await registerUser({ prefix: "subtask-other" });
  otherToken = other.accessToken;
  otherWid = other.workspace.id;
});

async function createTask(title: string, extra: Record<string, unknown> = {}) {
  const res = await fetch(`${BASE}/workspaces/${wid}/tasks`, {
    method: "POST",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: JSON.stringify({ title, ...extra }),
  });
  return { res, json: await res.json() };
}

describe("子任务创建与校验", () => {
  let parentId: string;

  it("先创建父任务", async () => {
    const { res, json } = await createTask("父任务");
    expect(res.status).toBe(201);
    parentId = json.data.id;
    expect(json.data.parentId).toBeNull();
  });

  it("带 parentId 创建子任务成功（201）", async () => {
    const { res, json } = await createTask("子任务A", { parentId });
    expect(res.status).toBe(201);
    expect(json.data.parentId).toBe(parentId);
  });

  it("父级本身不能是子任务（仅一层层级）返回 400", async () => {
    const { res: r1, json: j1 } = await createTask("子任务B", { parentId });
    expect(r1.status).toBe(201);
    const subtaskBId = j1.data.id;

    // 以子任务 B 为父级再建——应被拒（nested）
    const { res, json } = await createTask("孙任务", { parentId: subtaskBId });
    expect(res.status).toBe(400);
    expect(json.message).toContain("一层");
  });

  it("parentId 指向不存在的任务返回 400", async () => {
    const { res, json } = await createTask("孤儿任务", {
      parentId: "00000000-0000-0000-0000-000000000000",
    });
    expect(res.status).toBe(400);
    expect(json.message).toContain("父任务不存在");
  });

  it("跨工作区 parentId 返回 400（A 的 token 不能引用 B 的任务）", async () => {
    // otherToken 在 otherWid 下创建任务
    const r2 = await fetch(`${BASE}/workspaces/${otherWid}/tasks`, {
      method: "POST",
      headers: { ...authHeader(otherToken), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "对方父任务" }),
    });
    const j2 = await r2.json();
    expect(r2.status).toBe(201);

    // token 用对方任务的 id 作为 parentId → 跨租户，应 400
    const { res, json } = await createTask("跨租户子任务", { parentId: j2.data.id });
    expect(res.status).toBe(400);
    expect(json.message).toContain("父任务不存在");
  });
});

describe("子任务进度汇总与列表", () => {
  let parentId: string;

  beforeAll(async () => {
    const { json } = await createTask("进度父任务");
    parentId = json.data.id;
    // 建 3 个子任务
    for (const t of ["进度子1", "进度子2", "进度子3"]) {
      await createTask(t, { parentId });
    }
  });

  it("列表接口顶层任务不含子任务行，且父任务带 subtaskTotal/subtaskDone", async () => {
    // 先把 2 个子任务标为 done
    const detail = await fetch(`${BASE}/workspaces/${wid}/tasks/${parentId}`, {
      headers: authHeader(token),
    });
    const detailJson = await detail.json();
    expect(detailJson.data.children).toHaveLength(3);

    for (const child of detailJson.data.children.slice(0, 2)) {
      const res = await fetch(`${BASE}/workspaces/${wid}/tasks/${child.id}`, {
        method: "PATCH",
        headers: { ...authHeader(token), "Content-Type": "application/json" },
        body: JSON.stringify({ status: "done" }),
      });
      expect(res.status).toBe(200);
    }

    const list = await fetch(`${BASE}/workspaces/${wid}/tasks`, {
      headers: authHeader(token),
    });
    const listJson = await list.json();
    const parent = listJson.data.find((t: { id: string }) => t.id === parentId);
    expect(parent).toBeDefined();
    expect(parent.subtaskTotal).toBe(3);
    expect(parent.subtaskDone).toBe(2);

    // 子任务行不出现在顶层列表
    const childIds = detailJson.data.children.map((c: { id: string }) => c.id);
    for (const row of listJson.data) {
      expect(childIds).not.toContain(row.id);
    }
  });

  it("详情接口 children 按创建时间正序返回", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/tasks/${parentId}`, {
      headers: authHeader(token),
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.children.length).toBe(3);
    const titles = json.data.children.map((c: { title: string }) => c.title);
    expect(titles).toEqual(["进度子1", "进度子2", "进度子3"]);
  });
});

describe("阻塞标记", () => {
  let taskId: string;

  beforeAll(async () => {
    const { json } = await createTask("阻塞测试任务");
    taskId = json.data.id;
  });

  it("PATCH 设置 blocked + blockedReason", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/tasks/${taskId}`, {
      method: "PATCH",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ blocked: true, blockedReason: "等待外部 API 审批" }),
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.blocked).toBe(true);
    expect(json.data.blockedReason).toBe("等待外部 API 审批");
  });

  it("PATCH 清除 blocked 并清空原因", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/tasks/${taskId}`, {
      method: "PATCH",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ blocked: false, blockedReason: null }),
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.blocked).toBe(false);
    expect(json.data.blockedReason).toBeNull();
  });

  it("新建任务默认 blocked=false", async () => {
    const { json } = await createTask("默认非阻塞");
    expect(json.data.blocked).toBe(false);
    expect(json.data.blockedReason).toBeNull();
  });
});
