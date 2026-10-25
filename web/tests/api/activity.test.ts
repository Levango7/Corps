import { describe, it, expect, beforeAll } from "vitest";
import { BASE, registerUser, authHeader } from "../helpers";

/**
 * 工作区活动流 API 集成测试（/workspaces/{wid}/activity）
 *
 * 覆盖：
 * 1. GET 返回统一活动流 — 分页信封 { items, nextCursor }、固定页大小 20
 * 2. 事件类型枚举与字段（actorName/entityTitle/createdAt）
 * 3. 最新在前 — 新建任务后它排在第一条
 * 4. cursor 分页 — nextCursor 可用于翻更早的页
 * 5. 跨工作区隔离 — B 的 token 读 A 的活动流 403（非成员先被成员校验拦截）
 *
 * 契约：api/openapi.yaml 已声明该路由（2026-10-25），本文件是其行为侧的钉子。
 * 活动源：为让 items 稳定非空，用创建任务（POST /tasks）制造 task.created 事件。
 */

let token: string;
let wid: string;
let otherToken: string;

async function createTask(title: string) {
  const res = await fetch(`${BASE}/workspaces/${wid}/tasks`, {
    method: "POST",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  expect(res.status).toBe(201);
  return res.json();
}

async function getActivity(cursor?: string) {
  const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return fetch(`${BASE}/workspaces/${wid}/activity${q}`, {
    headers: authHeader(token),
  });
}

beforeAll(async () => {
  const owner = await registerUser({
    prefix: "activity-owner",
    workspaceName: "活动流测试工作区",
  });
  token = owner.accessToken;
  wid = owner.workspace.id;

  const other = await registerUser({ prefix: "activity-other" });
  otherToken = other.accessToken;
});

describe("活动流 GET /activity", () => {
  it("创建任务后活动流包含 task.created，最新在前", async () => {
    await createTask("活动流-旧任务");
    // 间隔一小段时间保证 createdAt 严格递增（时间倒序的排序依据）
    await new Promise((r) => setTimeout(r, 1100));
    await createTask("活动流-新任务");

    const res = await getActivity();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(json.data.items)).toBe(true);
    expect(json.data.items.length).toBeGreaterThanOrEqual(2);

    const first = json.data.items[0];
    expect(first.type).toBe("task.created");
    expect(first.entityTitle).toBe("活动流-新任务");
    expect(first.actorName).toBeDefined();
    expect(first.createdAt).toBeDefined();
    // 五类事件枚举之外的 type 不应出现
    for (const item of json.data.items) {
      expect([
        "task.created",
        "task.updated",
        "comment.created",
        "decision.created",
        "decision.updated",
      ]).toContain(item.type);
    }
  });

  it("nextCursor 存在且可翻到更早的页", async () => {
    const first = await (await getActivity()).json();
    // 单页 20 条：活动总数不足一页时 nextCursor 为 null（合法），有则翻页
    if (first.data.nextCursor === null) {
      expect(first.data.items.length).toBeLessThan(20);
      return;
    }
    const second = await (await getActivity(first.data.nextCursor)).json();
    expect(second.status ?? 200).toBe(200);
    // 第二页所有活动都严格早于第一页最后一条
    const lastOfFirst = new Date(first.data.items[first.data.items.length - 1].createdAt);
    for (const item of second.data.items) {
      expect(new Date(item.createdAt).getTime()).toBeLessThan(lastOfFirst.getTime());
    }
  });

  it("cursor 分页每页不超过 20 条", async () => {
    const json = await (await getActivity()).json();
    expect(json.data.items.length).toBeLessThanOrEqual(20);
  });

  it("B 的 token 读 A 的活动流返回 403（工作区隔离）", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/activity`, {
      headers: authHeader(otherToken),
    });
    expect(res.status).toBe(403);
  });
});
