// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

import { PATCH } from "@/app/api/v1/workspaces/[wid]/settings/modules/route";

/**
 * PATCH /settings/modules 的路由级测试（P1-B2）。
 *
 * 钉三件事：
 *  1. **非法 id 不许静默丢弃**——必须 400 并把非法项列出来，否则前端会以为存成功了；
 *  2. 落库前合并（保留 settings 里的其它键），不是整对象覆盖；
 *  3. 权限拒绝时**不碰库**。
 */

const h = vi.hoisted(() => ({
  role: "owner",
  denied: false,
  existing: { settings: { future: { x: 1 } } } as { settings: unknown } | null,
  updates: [] as unknown[],
}));

vi.mock("@/lib/auth", () => ({
  getWorkspaceContextV2: async () => ({
    ok: true,
    member: { role: h.role, workspaceId: "w1" },
    payload: { sub: "u1", wid: "w1" },
  }),
  runWithWorkspace: async (_wid: string, fn: (tx: unknown) => Promise<unknown>) => fn(tx),
}));

vi.mock("@/lib/permissions", () => ({
  requirePermission: async () =>
    h.denied
      ? NextResponse.json({ code: 403, message: "forbidden", data: null }, { status: 403 })
      : null,
}));

const tx = {
  workspace: {
    findUnique: async () => h.existing,
    update: async ({ data }: { data: { settings: unknown } }) => {
      h.updates.push(data.settings);
      return {};
    },
  },
};

function call(body: unknown) {
  return PATCH(
    new NextRequest("http://localhost/api/v1/workspaces/w1/settings/modules", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ wid: "w1" }) },
  );
}

beforeEach(() => {
  h.role = "owner";
  h.denied = false;
  h.existing = { settings: { future: { x: 1 } } };
  h.updates = [];
});

describe("PATCH settings/modules", () => {
  it("合法 id：落库合并（保留未知键），返回收口后的启用集合", async () => {
    const res = await call({ enabledModules: ["wiki", "okr", "wiki"] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { enabledModules: string[] } };
    expect(body.data.enabledModules).toEqual(["wiki", "okr"]);
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0]).toEqual({
      future: { x: 1 },
      sidebar: { enabledModules: ["wiki", "okr"] },
    });
  });

  it("非法 id：400 并列出非法项，且不写库", async () => {
    const res = await call({ enabledModules: ["wiki", "overview", "nope"] });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { data: { invalidModules: string[] } };
    expect(body.data.invalidModules).toEqual(["overview", "nope"]);
    expect(h.updates).toEqual([]);
  });

  it("权限不足：直接返回 403，且不写库", async () => {
    h.denied = true;
    h.role = "admin"; // 矩阵里 admin 的 settings 是 r
    const res = await call({ enabledModules: ["wiki"] });
    expect(res.status).toBe(403);
    expect(h.updates).toEqual([]);
  });

  it("body 形状不对：400", async () => {
    const res = await call({ enabledModules: "wiki" });
    expect(res.status).toBe(400);
    expect(h.updates).toEqual([]);
  });

  it("工作区不存在：404", async () => {
    h.existing = null;
    const res = await call({ enabledModules: ["wiki"] });
    expect(res.status).toBe(404);
    expect(h.updates).toEqual([]);
  });

  it("空数组 = 清空启用（保留 settings 子树）", async () => {
    const res = await call({ enabledModules: [] });
    expect(res.status).toBe(200);
    expect(h.updates[0]).toEqual({ future: { x: 1 }, sidebar: { enabledModules: [] } });
  });
});
