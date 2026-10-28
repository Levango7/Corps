import { describe, it, expect, beforeAll } from "vitest";
import { BASE, registerUser, authHeader } from "../helpers";

/**
 * 工作流 API 集成测试（/workspaces/{wid}/workflows）
 *
 * 覆盖：
 * 1. 列表 — data 为 { items, total, skip, take }，skip/take 真的生效
 * 2. 创建 — 201 且带回 id/name/trigger/actions；缺 trigger 400；actions 空数组 400
 * 3. 隔离与认证 — 跨工作区 403；无 token 401
 *
 * ⚠ 本域的成功响应是 `code: 0`（见 route.ts 的 `NextResponse.json({ code: 0, ... })`），
 *   而全仓其余端点一律 `code === HTTP 状态码`（200/201）。这里**按现状钉住 0**，
 *   并把不一致写明：如果哪天真统一成 200，这两条断言会红——那是预期中的红，
 *   改断言的同时才是真正"统一口径"的时刻。错误响应本身用的是 400/500，与全仓一致。
 *
 * 契约：api/openapi.yaml 尚未声明该域，本文件钉实现侧行为。
 */

let token: string;
let wid: string;
let otherToken: string;

const auth = () => ({ ...authHeader(token), "Content-Type": "application/json" });
const TAG = Date.now();

/** 一个最小可用的工作流体（trigger 是任意记录、actions 至少一条） */
const FLOW = {
  name: `pinflow-${TAG}`,
  description: "由 tests/api 钉住",
  trigger: { type: "manual" },
  actions: [{ type: "noop" }],
};

async function createFlow(body: Record<string, unknown>) {
  const res = await fetch(`${BASE}/workspaces/${wid}/workflows`, {
    method: "POST",
    headers: auth(),
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

beforeAll(async () => {
  const owner = await registerUser({ prefix: "flow-owner", workspaceName: "工作流测试工作区" });
  token = owner.accessToken;
  wid = owner.workspace.id;
  const other = await registerUser({ prefix: "flow-other" });
  otherToken = other.accessToken;
});

describe("GET /workflows", () => {
  it("返回 { items, total, skip, take }，成功码是 0（与全仓不一致，见文件头）", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/workflows`, {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.code).toBe(0);
    expect(Array.isArray(json.data.items)).toBe(true);
    expect(typeof json.data.total).toBe("number");
    expect(typeof json.data.skip).toBe("number");
    expect(typeof json.data.take).toBe("number");
  });

  it("take=1 时最多回一条，total 不受 take 影响", async () => {
    await createFlow({ ...FLOW, name: `pinflow-a-${TAG}` });
    await createFlow({ ...FLOW, name: `pinflow-b-${TAG}` });

    const res = await fetch(`${BASE}/workspaces/${wid}/workflows?take=1`, {
      headers: authHeader(token),
    });
    const json = await res.json();
    expect(json.data.items.length).toBe(1);
    expect(json.data.total).toBeGreaterThanOrEqual(2);
  });
});

describe("POST /workflows", () => {
  it("创建成功返回 201，带回 id/name/trigger/actions", async () => {
    const { status, json } = await createFlow(FLOW);
    expect(status).toBe(201);
    expect(json.code).toBe(0);
    expect(json.data.id).toBeTruthy();
    expect(json.data.name).toBe(FLOW.name);
    expect(json.data.trigger).toEqual(FLOW.trigger);
    expect(Array.isArray(json.data.actions)).toBe(true);
    expect(json.data.active).toBe(false);
  });

  it("缺 trigger → 400（错误码仍用 400，与全仓一致）", async () => {
    const { name, actions } = FLOW;
    const { status, json } = await createFlow({ name, actions });
    expect(status).toBe(400);
    expect(json.code).toBe(400);
    expect(Array.isArray(json.errors)).toBe(true);
  });

  it("actions 为空数组 → 400（min 1）", async () => {
    const { status } = await createFlow({
      name: `${FLOW.name}-noaction`,
      trigger: FLOW.trigger,
      actions: [],
    });
    expect(status).toBe(400);
  });

  it("name 超过 200 字符 → 400", async () => {
    const { status } = await createFlow({
      name: "f".repeat(201),
      trigger: FLOW.trigger,
      actions: FLOW.actions,
    });
    expect(status).toBe(400);
  });
});

describe("隔离与认证", () => {
  it("跨工作区读 A 的工作流 → 403", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/workflows`, {
      headers: authHeader(otherToken),
    });
    expect(res.status).toBe(403);
  });

  it("不带 token → 401", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/workflows`);
    expect(res.status).toBe(401);
  });
});
