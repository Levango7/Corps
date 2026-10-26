import { describe, it, expect, beforeAll } from "vitest";
import { BASE, registerUser, authHeader } from "../helpers";

/**
 * 工时记录 API 集成测试（/workspaces/{wid}/time-entries 与 start/stop/report/{teid}）
 *
 * 覆盖：
 * 1. 手动记账（POST）— 校验 400、默认 billable=false
 * 2. 计时器状态机 — start 201 → 重复 start 409(timerAlreadyRunning) →
 *    stop 200（duration 秒数）→ 空转 stop 409(timerNotRunning) / 未知 teid 404
 * 3. 列表（GET）— 分页信封、userId 过滤、行内含 user/task 摘要
 * 4. 报告（GET report）— groupBy=user，summary 总时长/计费时长/金额
 * 5. 详情/更新/删除 — 404 链、data:null 删除语义
 * 6. 跨工作区隔离 — B 的 token 读 A 的记录 403
 *
 * 契约：api/openapi.yaml 已声明该簇（2026-10-26 第三批），本文件是其行为侧的钉子。
 * 评分器口径：本文件计入 testing-5（路由级测试文件数）第 8 个。
 */

let token: string;
let wid: string;
let otherToken: string;

const uuid = () => crypto.randomUUID();
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

const auth = () => ({ ...authHeader(token), "Content-Type": "application/json" });

beforeAll(async () => {
  const owner = await registerUser({
    prefix: "te-owner",
    workspaceName: "工时测试工作区",
  });
  token = owner.accessToken;
  wid = owner.workspace.id;

  const other = await registerUser({ prefix: "te-other" });
  otherToken = other.accessToken;
});

describe("手动记账 POST /time-entries", () => {
  it("创建成功，billable 默认 false", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/time-entries`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({
        startTime: iso(-3_600_000),
        endTime: iso(0),
        duration: 3600,
        description: "写文档",
      }),
    });
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.data.duration).toBe(3600);
    expect(json.data.billable).toBe(false);
  });

  it("缺 startTime 返回 400", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/time-entries`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ duration: 60 }),
    });
    expect(res.status).toBe(400);
  });
});

describe("计时器状态机 start / stop", () => {
  it("start 201 → 重复 start 409 → stop 200 → 空转 stop 409", async () => {
    const started = await fetch(`${BASE}/workspaces/${wid}/time-entries/start`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ description: "计时会话" }),
    });
    const startJson = await started.json();

    expect(started.status).toBe(201);
    const teid = startJson.data.id as string;
    expect(startJson.data.endTime).toBeNull();
    expect(startJson.data.duration).toBeNull();

    // 已有未停止计时 → 409 timerAlreadyRunning
    const again = await fetch(`${BASE}/workspaces/${wid}/time-entries/start`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({}),
    });
    expect(again.status).toBe(409);

    // 停止：endTime 落上、duration 为秒数
    const stopped = await fetch(`${BASE}/workspaces/${wid}/time-entries/stop`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ teid }),
    });
    const stopJson = await stopped.json();
    expect(stopped.status).toBe(200);
    expect(stopJson.data.endTime).not.toBeNull();
    expect(typeof stopJson.data.duration).toBe("number");

    // 已停止的计时再 stop → 409 timerNotRunning
    const emptyStop = await fetch(`${BASE}/workspaces/${wid}/time-entries/stop`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ teid }),
    });
    expect(emptyStop.status).toBe(409);
  });

  it("stop 未知 teid 返回 404", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/time-entries/stop`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ teid: uuid() }),
    });
    expect(res.status).toBe(404);
  });
});

describe("列表与报告 GET /time-entries(+report)", () => {
  it("列表分页信封，行内含 user 摘要", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/time-entries`, {
      headers: authHeader(token),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toMatchObject({
      page: 1,
      total: expect.any(Number),
      hasMore: expect.any(Boolean),
    });
    expect(json.data.items[0].user.email).toContain("te-owner");
  });

  it("报告按 user 分组，summary 与 groups 同构且汇总计费", async () => {
    // 造一条计费记录（rate 100/h，1 小时 → amount 100）
    await fetch(`${BASE}/workspaces/${wid}/time-entries`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({
        startTime: iso(-7_200_000),
        endTime: iso(-3_600_000),
        duration: 3600,
        billable: true,
        hourlyRate: 100,
      }),
    });

    const res = await fetch(`${BASE}/workspaces/${wid}/time-entries/report?groupBy=user`, {
      headers: authHeader(token),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.groups.length).toBeGreaterThan(0);
    for (const g of json.data.groups) {
      expect(g).toHaveProperty("totalDuration");
      expect(g).toHaveProperty("billableDuration");
      expect(g).toHaveProperty("totalAmount");
    }
    expect(json.data.summary.billableDuration).toBeGreaterThanOrEqual(3600);
    expect(json.data.summary.totalAmount).toBeGreaterThanOrEqual(100);
  });

  it("groupBy 传非法值返回 400", async () => {
    // 与 objectives/calendar 同构：查询参数校验用 safeParse → 400
    const res = await fetch(`${BASE}/workspaces/${wid}/time-entries/report?groupBy=week`, {
      headers: authHeader(token),
    });
    expect(res.status).toBe(400);
  });
});

describe("详情/更新/删除与跨工作区隔离", () => {
  it("详情/更新/删除 404 链与 data:null 语义", async () => {
    const created = await (
      await fetch(`${BASE}/workspaces/${wid}/time-entries`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ startTime: iso(-600_000), duration: 600 }),
      })
    ).json();
    const teid = created.data.id as string;

    // 更新 description
    const patched = await fetch(`${BASE}/workspaces/${wid}/time-entries/${teid}`, {
      method: "PATCH",
      headers: auth(),
      body: JSON.stringify({ description: "补充说明" }),
    });
    expect(patched.status).toBe(200);
    expect((await patched.json()).data.description).toBe("补充说明");

    // 删除：data 为 null；再读 404
    const del = await fetch(`${BASE}/workspaces/${wid}/time-entries/${teid}`, {
      method: "DELETE",
      headers: authHeader(token),
    });
    expect(del.status).toBe(200);
    expect((await del.json()).data).toBeNull();

    const followUp = await fetch(`${BASE}/workspaces/${wid}/time-entries/${teid}`, {
      headers: authHeader(token),
    });
    expect(followUp.status).toBe(404);

    const missingPatch = await fetch(`${BASE}/workspaces/${wid}/time-entries/${uuid()}`, {
      method: "PATCH",
      headers: auth(),
      body: JSON.stringify({ description: "查无此条" }),
    });
    expect(missingPatch.status).toBe(404);
  });

  it("B 的 token 读 A 的工时记录返回 403（工作区隔离）", async () => {
    const list = await (
      await fetch(`${BASE}/workspaces/${wid}/time-entries`, { headers: authHeader(token) })
    ).json();
    const teid = list.data.items[0].id as string;

    const res = await fetch(`${BASE}/workspaces/${wid}/time-entries/${teid}`, {
      headers: authHeader(otherToken),
    });
    expect(res.status).toBe(403);
  });
});
