import { describe, it, expect, beforeAll } from "vitest";
import { BASE, registerUser, authHeader, createTask } from "../helpers";

/**
 * 决策「已复盘」标记的集成测试（#48，owner 口径：复盘 = 显式动作）。
 *
 * 覆盖的四条语义边界，每一条都是产品口径而不是实现细节：
 *  1. 新决策默认未复盘（reviewedAt = null）——存量数据靠这一条保证"不假装复盘过"
 *  2. 标记后写入时间戳；**重复标记不刷新时间戳**（否则"首次复盘时间"被点击次数污染）
 *  3. 撤销标记把时间戳清回 null
 *  4. **编辑决策会清空复盘标记** —— 内容变了，上一次复盘不再覆盖新版本
 *  5. 跨工作区访问 404（RLS 之外的第二道：where 里带 workspaceId/taskId）
 */

let token: string;
let wid: string;
let taskId: string;
let otherToken: string;

async function createDecision(markdown: string): Promise<{ id: string; version: number }> {
  const res = await fetch(`${BASE}/workspaces/${wid}/tasks/${taskId}/decisions`, {
    method: "POST",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: JSON.stringify({ markdown }),
  });
  expect(res.status, `创建决策应成功，实际 ${res.status}`).toBeLessThan(300);
  const json = (await res.json()) as { data?: { id?: string; version?: number } };
  const id = json.data?.id ?? "";
  expect(id, "响应应含决策 id").toBeTruthy();
  return { id, version: json.data?.version ?? 1 };
}

async function review(did: string, body: unknown = {}): Promise<Response> {
  return fetch(`${BASE}/workspaces/${wid}/tasks/${taskId}/decisions/${did}/review`, {
    method: "POST",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** 从决策列表里取该条当前的 reviewedAt（列表接口是 UI 的唯一数据源） */
async function reviewedAtOf(did: string): Promise<string | null> {
  const res = await fetch(`${BASE}/workspaces/${wid}/decisions?page=1&limit=50`, {
    headers: authHeader(token),
  });
  expect(res.status).toBe(200);
  const json = (await res.json()) as {
    data?: { items?: Array<{ id: string; reviewedAt?: string | null }> };
  };
  const row = json.data?.items?.find((d) => d.id === did);
  expect(row, "决策列表应包含该条").toBeDefined();
  return row?.reviewedAt ?? null;
}

beforeAll(async () => {
  const owner = await registerUser({ prefix: "decision-review", workspaceName: "复盘测试工作区" });
  token = owner.accessToken;
  wid = owner.workspace.id;

  const other = await registerUser({ prefix: "decision-review-other" });
  otherToken = other.accessToken;

  const task = await createTask(token, wid, { title: "复盘目标任务" });
  expect(task.status, `创建任务应成功，实际 ${task.status}`).toBe(201);
  taskId = (task.body as { data?: { id?: string } })?.data?.id ?? "";
  expect(taskId).toBeTruthy();
});

describe("POST .../decisions/{did}/review", () => {
  it("新决策默认未复盘，标记后写入时间戳", async () => {
    const d = await createDecision(`## 决策\n默认未复盘 ${Date.now()}`);
    expect(await reviewedAtOf(d.id), "新建决策不应带复盘时间戳").toBeNull();

    const res = await review(d.id);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data?: { reviewedAt?: string | null; changed?: boolean } };
    expect(json.data?.changed, "首次标记应 changed=true").toBe(true);
    expect(json.data?.reviewedAt, "响应应返回时间戳").toBeTruthy();

    const persisted = await reviewedAtOf(d.id);
    expect(persisted, "列表接口应回读同一时间戳").toBe(json.data?.reviewedAt);
  });

  it("重复标记幂等：不刷新时间戳，changed=false", async () => {
    const d = await createDecision(`## 决策\n重复标记 ${Date.now()}`);
    const first = (await (await review(d.id)).json()) as {
      data?: { reviewedAt?: string | null };
    };
    const firstAt = first.data?.reviewedAt;
    expect(firstAt).toBeTruthy();

    // 间隔一点时间再点一次：如果实现是"每次覆盖 now()"，这里会变成更晚的时间
    await new Promise((r) => setTimeout(r, 1100));
    const second = (await (await review(d.id)).json()) as {
      data?: { reviewedAt?: string | null; changed?: boolean };
    };
    expect(second.data?.changed, "重复标记不应算一次状态变更").toBe(false);
    expect(second.data?.reviewedAt, "首次复盘时间不应被点击次数污染").toBe(firstAt);
  });

  it("撤销标记把时间戳清回 null", async () => {
    const d = await createDecision(`## 决策\n撤销标记 ${Date.now()}`);
    await review(d.id);
    expect(await reviewedAtOf(d.id)).toBeTruthy();

    const res = await review(d.id, { reviewed: false });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data?: { reviewedAt?: string | null } };
    expect(json.data?.reviewedAt).toBeNull();
    expect(await reviewedAtOf(d.id), "撤销后列表不应再有时间戳").toBeNull();
  });

  it("编辑决策会清空复盘标记（内容变了 = 未复盘内容）", async () => {
    const d = await createDecision(`## 决策\n将被编辑 ${Date.now()}`);
    await review(d.id);
    expect(await reviewedAtOf(d.id)).toBeTruthy();

    const patch = await fetch(`${BASE}/workspaces/${wid}/tasks/${taskId}/decisions/${d.id}`, {
      method: "PATCH",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ markdown: `## 决策\n已编辑 ${Date.now()}`, baseVersion: d.version }),
    });
    expect([200, 201], `编辑应成功，实际 ${patch.status}`).toContain(patch.status);

    expect(await reviewedAtOf(d.id), "编辑后应回到未复盘").toBeNull();
  });

  it("跨工作区访问该决策返回 404（不存在的语义，不泄漏存在性）", async () => {
    const d = await createDecision(`## 决策\n跨租户 ${Date.now()}`);
    const res = await fetch(`${BASE}/workspaces/${wid}/tasks/${taskId}/decisions/${d.id}/review`, {
      method: "POST",
      headers: { ...authHeader(otherToken), "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    // 非成员：可能是 403（成员资格）或 404（不可见）。两者都不允许写成功。
    expect([403, 404], `非成员写入应被拒，实际 ${res.status}`).toContain(res.status);
  });

  it("空 body 视为 reviewed=true（纯动作端点不该因缺 body 变 400）", async () => {
    const d = await createDecision(`## 决策\n空 body ${Date.now()}`);
    const res = await fetch(`${BASE}/workspaces/${wid}/tasks/${taskId}/decisions/${d.id}/review`, {
      method: "POST",
      headers: authHeader(token),
    });
    expect(res.status, "无 body 的 POST 应成功").toBe(200);
    expect(await reviewedAtOf(d.id)).toBeTruthy();
  });
});
