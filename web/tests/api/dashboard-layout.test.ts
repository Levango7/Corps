import { describe, it, expect, beforeAll } from "vitest";
import { BASE, registerUser, authHeader } from "../helpers";

/**
 * 仪表盘布局偏好 API 集成测试（/workspaces/{wid}/dashboard/layout）
 *
 * 覆盖：
 * 1. GET 无记录 → 返回角色默认布局（非空、每项含 i/x/y/w/h），breakpoint 恒为 "lg"
 * 2. PUT 合法布局 → 200，返回体回读一致
 * 3. 持久化往返 — PUT 后再 GET，布局项还在；但 GET 的 breakpoint 仍为 "lg"
 *    （实现里 breakpoint 只在 PUT 响应回显、不落库，这条差异必须钉住，
 *     否则将来有人误以为 GET 会回显上次提交的断点）
 * 4. 校验 — layout 空数组 400；布局项坐标越界（x=-1 / w=0）400
 * 5. 跨工作区 — B 的 token PUT A 的布局 403
 * 6. 未认证 — 不带 token 401
 *
 * 契约：api/openapi.yaml **尚未**声明该域（契约覆盖率是另一条单独的债），
 * 本文件钉的是实现侧行为；putLayoutSchema 见 lib/dashboard-layout-helpers.ts。
 */

let token: string;
let wid: string;
let otherToken: string;

const auth = () => ({ ...authHeader(token), "Content-Type": "application/json" });

/** 一个合法的最小布局项（i/x/y/w/h 五字段，坐标非负、宽高 ≥1） */
const ITEM = { i: "pin-layout-widget", x: 0, y: 0, w: 4, h: 3 };

beforeAll(async () => {
  const owner = await registerUser({
    prefix: "layout-owner",
    workspaceName: "布局测试工作区",
  });
  token = owner.accessToken;
  wid = owner.workspace.id;

  const other = await registerUser({ prefix: "layout-other" });
  otherToken = other.accessToken;
});

describe("GET /dashboard/layout", () => {
  it("无记录时返回角色默认布局，且每个布局项字段齐全", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/dashboard/layout`, {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.code).toBe(200);
    expect(Array.isArray(json.data.layout)).toBe(true);
    expect(json.data.layout.length).toBeGreaterThan(0);
    for (const item of json.data.layout) {
      expect(typeof item.i).toBe("string");
      expect(Number.isInteger(item.x)).toBe(true);
      expect(Number.isInteger(item.y)).toBe(true);
      expect(Number.isInteger(item.w)).toBe(true);
      expect(Number.isInteger(item.h)).toBe(true);
    }
    expect(json.data.breakpoint).toBe("lg");
    expect(typeof json.data.widgetConfigs).toBe("object");
  });
});

describe("PUT /dashboard/layout", () => {
  it("提交合法布局 → 200 且回读一致", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/dashboard/layout`, {
      method: "PUT",
      headers: auth(),
      body: JSON.stringify({ layout: [ITEM], widgetConfigs: {} }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.code).toBe(200);
    expect(json.data.layout).toHaveLength(1);
    expect(json.data.layout[0]).toMatchObject(ITEM);
  });

  it("提交的 breakpoint 只在响应里回显，GET 仍返回 lg（未落库）", async () => {
    const put = await fetch(`${BASE}/workspaces/${wid}/dashboard/layout`, {
      method: "PUT",
      headers: auth(),
      body: JSON.stringify({ layout: [ITEM], widgetConfigs: {}, breakpoint: "md" }),
    });
    expect(put.status).toBe(200);
    const putJson = await put.json();
    expect(putJson.data.breakpoint).toBe("md");

    const get = await fetch(`${BASE}/workspaces/${wid}/dashboard/layout`, {
      headers: authHeader(token),
    });
    const getJson = await get.json();
    expect(getJson.data.breakpoint).toBe("lg");
  });

  it("持久化往返：PUT 之后再 GET，布局项还在", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/dashboard/layout`, {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.layout).toHaveLength(1);
    expect(json.data.layout[0].i).toBe(ITEM.i);
    expect(json.data.layout[0].w).toBe(ITEM.w);
  });

  it("layout 空数组 → 400（min(1)）", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/dashboard/layout`, {
      method: "PUT",
      headers: auth(),
      body: JSON.stringify({ layout: [], widgetConfigs: {} }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe(400);
    expect(Array.isArray(json.errors)).toBe(true);
  });

  it("布局项坐标越界（x=-1）→ 400", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/dashboard/layout`, {
      method: "PUT",
      headers: auth(),
      body: JSON.stringify({ layout: [{ ...ITEM, x: -1 }], widgetConfigs: {} }),
    });
    expect(res.status).toBe(400);
  });

  it("布局项宽度为 0 → 400（w 必须 ≥1）", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/dashboard/layout`, {
      method: "PUT",
      headers: auth(),
      body: JSON.stringify({ layout: [{ ...ITEM, w: 0 }], widgetConfigs: {} }),
    });
    expect(res.status).toBe(400);
  });
});

describe("隔离与认证", () => {
  it("跨工作区：B 的 token PUT A 的布局 403", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/dashboard/layout`, {
      method: "PUT",
      headers: { ...authHeader(otherToken), "Content-Type": "application/json" },
      body: JSON.stringify({ layout: [ITEM], widgetConfigs: {} }),
    });
    expect(res.status).toBe(403);
  });

  it("不带 token → 401", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/dashboard/layout`);
    expect(res.status).toBe(401);
  });
});
