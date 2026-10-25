import { describe, it, expect, beforeAll } from "vitest";
import { BASE, registerUser, authHeader } from "../helpers";

/**
 * OKR 目标与关键结果 API 集成测试
 * （/workspaces/{wid}/objectives、/{oid}、/key-results/{kid}、/{oid}/key-results）
 *
 * 覆盖：
 * 1. 创建目标（POST）— 默认 status=draft、progress=0、校验 400
 * 2. 查询（GET 列表 / GET 详情）— 分页信封、period 过滤、_count、404
 * 3. 更新目标（PATCH）— 局部更新
 * 4. 关键结果链路 — 嵌套端点建 KR → 顶级 PATCH /key-results/{kid} 更新进度
 *    → 父目标 progress 按 weighted 公式重算
 * 5. 删除 — KR 200 data:null；目标删除后详情 404
 * 6. 跨工作区隔离 — B 的 token 读 A 的目标 403
 *
 * 契约：api/openapi.yaml 已声明 objectives 与 key-results/{kid}（2026-10-26 第二批）；
 * 嵌套端点 /objectives/{oid}/key-results 尚未声明，本文件只把它当测试夹具使用。
 */

let token: string;
let wid: string;
let otherToken: string;

const uuid = () => crypto.randomUUID();

async function createObjective(body: Record<string, unknown>) {
  return fetch(`${BASE}/workspaces/${wid}/objectives`, {
    method: "POST",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createKeyResult(oid: string, body: Record<string, unknown>) {
  return fetch(`${BASE}/workspaces/${wid}/objectives/${oid}/key-results`, {
    method: "POST",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const owner = await registerUser({
    prefix: "okr-owner",
    workspaceName: "OKR 测试工作区",
  });
  token = owner.accessToken;
  wid = owner.workspace.id;

  const other = await registerUser({ prefix: "okr-other" });
  otherToken = other.accessToken;
});

describe("创建目标 POST /objectives", () => {
  it("title+period 创建成功，默认 draft、progress 0", async () => {
    const res = await createObjective({ title: "Q4 拉新", period: "2026-Q4" });
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.data.title).toBe("Q4 拉新");
    expect(json.data.period).toBe("2026-Q4");
    expect(json.data.status).toBe("draft");
    expect(json.data.progress).toBe(0);
  });

  it("缺 period 返回 400", async () => {
    const res = await createObjective({ title: "没有周期" });
    expect(res.status).toBe(400);
  });

  it("非法 status 返回 400", async () => {
    const res = await createObjective({ title: "t", period: "2026-Q4", status: "boom" });
    expect(res.status).toBe(400);
  });
});

describe("查询目标 GET /objectives", () => {
  it("列表分页信封，行内含 owner 与 _count.keyResults", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/objectives`, {
      headers: authHeader(token),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toMatchObject({
      page: 1,
      total: expect.any(Number),
      hasMore: expect.any(Boolean),
    });
    expect(json.data.items[0]._count).toHaveProperty("keyResults");
  });

  it("period 过滤只返回该周期", async () => {
    await createObjective({ title: "别的周期", period: "2027-Q1" });

    const json = await (
      await fetch(`${BASE}/workspaces/${wid}/objectives?period=2026-Q4`, {
        headers: authHeader(token),
      })
    ).json();
    for (const o of json.data.items) expect(o.period).toBe("2026-Q4");
  });
});

describe("目标详情与更新 /objectives/{oid}", () => {
  it("详情含 keyResults 数组；不存在的 uuid 404", async () => {
    const created = await (await createObjective({ title: "详情目标", period: "2026-Q4" })).json();
    const oid = created.data.id as string;

    const res = await fetch(`${BASE}/workspaces/${wid}/objectives/${oid}`, {
      headers: authHeader(token),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(json.data.keyResults)).toBe(true);

    const missing = await fetch(`${BASE}/workspaces/${wid}/objectives/${uuid()}`, {
      headers: authHeader(token),
    });
    expect(missing.status).toBe(404);
  });

  it("PATCH 改 status 成功；不存在的 uuid 404", async () => {
    const created = await (await createObjective({ title: "待改目标", period: "2026-Q4" })).json();
    const oid = created.data.id as string;

    const res = await fetch(`${BASE}/workspaces/${wid}/objectives/${oid}`, {
      method: "PATCH",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ status: "active" }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.status).toBe("active");

    const missing = await fetch(`${BASE}/workspaces/${wid}/objectives/${uuid()}`, {
      method: "PATCH",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ status: "active" }),
    });
    expect(missing.status).toBe(404);
  });
});

describe("关键结果链路（建 KR → 顶级 PATCH 进度 → 父目标重算）", () => {
  it("KR 达成后父目标 progress 重算为 100", async () => {
    const obj = await (await createObjective({ title: "有进度的目标", period: "2026-Q4" })).json();
    const oid = obj.data.id as string;

    const krRes = await createKeyResult(oid, { title: "新增 100 用户", targetValue: 100 });
    expect(krRes.status).toBe(201);
    const kr = (await krRes.json()).data;
    expect(kr.targetValue).toBe(100);

    // 顶级端点：前端只持 kid 即可更新进度（免拼 oid）
    const patch = await fetch(`${BASE}/workspaces/${wid}/key-results/${kr.id}`, {
      method: "PATCH",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ currentValue: 100 }),
    });
    expect(patch.status).toBe(200);
    expect((await patch.json()).data.currentValue).toBe(100);

    // 父目标进度按 weighted 公式重算：唯一 KR 达成 → progress 100
    const detail = await (
      await fetch(`${BASE}/workspaces/${wid}/objectives/${oid}`, {
        headers: authHeader(token),
      })
    ).json();
    expect(detail.data.progress).toBe(100);
    expect(detail.data.keyResults).toHaveLength(1);

    // 删除 KR：200 且 data 为 null
    const del = await fetch(`${BASE}/workspaces/${wid}/key-results/${kr.id}`, {
      method: "DELETE",
      headers: authHeader(token),
    });
    expect(del.status).toBe(200);
    expect((await del.json()).data).toBeNull();
  });

  it("顶级 PATCH /key-results/{kid} 不存在的 uuid 返回 404", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/key-results/${uuid()}`, {
      method: "PATCH",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ currentValue: 1 }),
    });
    expect(res.status).toBe(404);
  });
});

describe("删除与跨工作区隔离", () => {
  it("B 的 token 读 A 的目标返回 403（工作区隔离）", async () => {
    const created = await (await createObjective({ title: "A 的目标", period: "2026-Q4" })).json();
    const oid = created.data.id as string;

    const res = await fetch(`${BASE}/workspaces/${wid}/objectives/${oid}`, {
      headers: authHeader(otherToken),
    });
    expect(res.status).toBe(403);
  });

  it("DELETE 目标后详情 404", async () => {
    const created = await (await createObjective({ title: "待删目标", period: "2026-Q4" })).json();
    const oid = created.data.id as string;

    const del = await fetch(`${BASE}/workspaces/${wid}/objectives/${oid}`, {
      method: "DELETE",
      headers: authHeader(token),
    });
    expect(del.status).toBe(200);
    expect((await del.json()).data).toBeNull();

    const followUp = await fetch(`${BASE}/workspaces/${wid}/objectives/${oid}`, {
      headers: authHeader(token),
    });
    expect(followUp.status).toBe(404);
  });
});
