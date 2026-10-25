// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

import { PATCH } from "@/app/api/v1/workspaces/[wid]/settings/modules/route";
import { API_MESSAGES } from "@/lib/api-messages";

/**
 * PATCH /settings/modules 的路由级测试（P1-B2）。
 *
 * 钉三件事：
 *  1. **非法 id 不许静默丢弃**——必须 400 并把非法项列出来，否则前端会以为存成功了；
 *  2. 落库前合并（保留 settings 里的其它键），不是整对象覆盖；
 *  3. 权限拒绝时**不碰库**。
 *
 * 补强（第二轮）：鉴权三态与两条 400 分支
 *  4. **401 与 403 必须分开**——401 是「没身份」，403 是「有身份但无权」；
 *  5. **V2 返回 null 必须 fail-closed 成 500，不能伪装成 401**：`lib/api.ts` 见 401
 *     会先做一次 token refresh 再重试，伪装会让客户端对着永远刷不好的 token 白重试一轮；
 *  6. body 解析失败（非 JSON）与 zod 校验失败是**两条不同分支**，文案也不同
 *     （invalidBody / validationError），只测后者等于放过前者；
 *  7. RLS 身份必须取 `ctx.payload.sub`，不是 URL 上的 wid。
 */

const h = vi.hoisted(() => ({
  role: "owner",
  denied: false,
  existing: { settings: { future: { x: 1 } } } as { settings: unknown } | null,
  updates: [] as unknown[],
  /** granted = 有身份有权；null 是 V2 契约外的返回，按 500 处理 */
  auth: "granted" as "granted" | "unauthenticated" | "forbidden" | "null",
  subs: [] as string[],
  writeThrows: false,
}));

vi.mock("@/lib/auth", () => ({
  getWorkspaceContextV2: async () => {
    if (h.auth === "unauthenticated") return { ok: false, status: 401, reason: "unauthenticated" };
    if (h.auth === "forbidden") return { ok: false, status: 403, reason: "not_a_member" };
    if (h.auth === "null") return null;
    return {
      ok: true,
      member: { role: h.role, workspaceId: "w1" },
      payload: { sub: "u1", wid: "w1" },
    };
  },
  runWithWorkspace: async (_wid: string, fn: (tx: unknown) => Promise<unknown>, sub: string) => {
    h.subs.push(sub);
    return fn(tx);
  },
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
      if (h.writeThrows) throw new Error("db down");
      h.updates.push(data.settings);
      return {};
    },
  },
};

function send(raw: string) {
  return PATCH(
    new NextRequest("http://localhost/api/v1/workspaces/w1/settings/modules", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: raw,
    }),
    { params: Promise.resolve({ wid: "w1" }) },
  );
}

function call(body: unknown) {
  return send(JSON.stringify(body));
}

beforeEach(() => {
  h.role = "owner";
  h.denied = false;
  h.existing = { settings: { future: { x: 1 } } };
  h.updates = [];
  h.auth = "granted";
  h.subs = [];
  h.writeThrows = false;
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

  it("body 形状不对：400（zod 分支，文案是 validationError）", async () => {
    const res = await call({ enabledModules: "wiki" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe(API_MESSAGES.validationError.zh);
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

describe("PATCH settings/modules · 鉴权三态", () => {
  it("未认证：401（「没身份」不能与「有身份但无权」混为一谈）", async () => {
    h.auth = "unauthenticated";
    const res = await call({ enabledModules: ["wiki"] });
    expect(res.status).toBe(401);
    expect(h.updates).toEqual([]);
  });

  it("非成员：403，且不是 401", async () => {
    h.auth = "forbidden";
    const res = await call({ enabledModules: ["wiki"] });
    expect(res.status).toBe(403);
    expect(res.status).not.toBe(401);
    expect(h.updates).toEqual([]);
  });

  it("V2 返回 null（契约外）：500，绝不伪装成 401", async () => {
    // 伪装的代价是具体的：lib/api.ts 见 401 会先 token refresh 再重试一次，
    // 而这个 500 是服务端契约坏了、重试也不会好 —— 白跑一轮还把真实原因盖住。
    h.auth = "null";
    const res = await call({ enabledModules: ["wiki"] });
    expect(res.status).toBe(500);
    expect(res.status).not.toBe(401);
    expect(h.updates).toEqual([]);
  });
});

describe("PATCH settings/modules · 两条 400 分支与写入身份", () => {
  it("body 不是合法 JSON：400 且文案是 invalidBody（不是 zod 那条 validationError）", async () => {
    const res = await send("{ not json");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe(API_MESSAGES.invalidBody.zh);
    expect(h.updates).toEqual([]);
  });

  it("RLS 身份取 ctx.payload.sub，不是 URL 上的 wid", async () => {
    // runWithWorkspace 的第三个参数是 SET LOCAL 用的主体；传错就等于整条 RLS 白设。
    await call({ enabledModules: ["wiki"] });
    expect(h.subs).toEqual(["u1"]);
  });

  it("落库抛错：500，且不把异常透给用户", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    h.writeThrows = true;
    const res = await call({ enabledModules: ["wiki"] });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe(API_MESSAGES.internalError.zh);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
