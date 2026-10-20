// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { randomUUID } from "crypto";

import { POST } from "@/app/api/v1/workspaces/[wid]/tasks/batch/route";

/**
 * 批量改状态的 task_status_change 埋点（2026-10-21 P1-C 余项）。
 *
 * 为什么钉这个：批量改状态原先**只有一条客户端事件**（board 页发 `{batch:true, count}`，
 * 没有 taskId），服务端一条都不发 ⇒ "任务何时进入 done"这类**按任务**的推导根本做不了
 * （设计方案 §9.2 的闭环率要用），而客户端事件还会在页面 flush 前被关掉丢掉。
 * 本 PR 把它换成服务端逐条发（与单条 PATCH 同口径），并删掉客户端那条 —— 同一动作
 * 不能留两个真源，否则批量路径的计数翻倍。这类缺陷不报错、不变红，只让数据变形，
 * 所以必须用断言钉住。
 *
 * 关键用例是第 4 条：updated.count > 0 但**读回**的落库集合为空时，一条事件都不许发。
 * 这是"按 validIds 直接发"那种实现会骗过前 3 条用例、却造出没发生过的完成记录的地方。
 *
 * Mock 策略沿用 tests/unit/document-versions-route-guard.test.ts：只 mock 叶子依赖
 * （@/lib/auth 的事务、@/lib/analytics-server 的写入、@/lib/permissions、@/lib/uploads-cleanup），
 * 路由自身的分支与守卫逻辑走真实实现。
 */

type TxTask = {
  id: string;
};
type FindArgs = {
  where: { id?: { in: string[] }; workspaceId?: string; status?: string };
  select?: Record<string, boolean>;
};
type TxLike = {
  task: {
    findMany: (a: FindArgs) => Promise<TxTask[]>;
    updateMany: (a: unknown) => Promise<{ count: number }>;
    deleteMany: (a: unknown) => Promise<{ count: number }>;
  };
  member: { findUnique: (a: unknown) => Promise<{ userId: string } | null> };
};

const h = vi.hoisted(() => ({
  events: [] as { name: string; props: Record<string, unknown> }[],
  existing: [] as string[],
  landed: [] as string[],
  updateCount: 0,
}));

vi.mock("@/lib/analytics-server", () => ({
  trackServerEvent: async (data: { name: string; props: Record<string, unknown> }) => {
    h.events.push({ name: data.name, props: data.props });
  },
}));

vi.mock("@/lib/auth", () => ({
  getWorkspaceContextV2: async () => ({ ok: true, payload: { sub: "user-1", wid: "ws-1" } }),
  runWithWorkspace: async (_wid: string, fn: (tx: TxLike) => Promise<unknown>) =>
    fn({
      task: {
        // 带 status 过滤的那次 findMany 就是"读回落库结果"
        findMany: async ({ where }: FindArgs) =>
          where.status !== undefined
            ? h.landed.map((id) => ({ id }))
            : h.existing.map((id) => ({ id })),
        updateMany: async () => ({ count: h.updateCount }),
        deleteMany: async () => ({ count: h.existing.length }),
      },
      member: { findUnique: async () => ({ userId: "user-1" }) },
    }),
}));

vi.mock("@/lib/permissions", () => ({
  requirePermission: async () => null,
}));

vi.mock("@/lib/uploads-cleanup", () => ({
  deleteTaskFiles: async () => undefined,
}));

function makeReq(body: unknown) {
  return new NextRequest("http://localhost:3000/api/v1/workspaces/ws-1/tasks/batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function call(body: unknown) {
  return POST(makeReq(body), { params: Promise.resolve({ wid: "ws-1" }) });
}

const ids = () => [randomUUID(), randomUUID(), randomUUID()];

beforeEach(() => {
  h.events.length = 0;
  h.existing = [];
  h.landed = [];
  h.updateCount = 0;
});

describe("POST tasks/batch 的 task_status_change 埋点", () => {
  it("批量改 status：读回到几个就发几条，props 带 taskId/to/via", async () => {
    const req = ids();
    h.existing = req;
    h.updateCount = 3;
    h.landed = [req[0], req[2]];

    const res = await call({ ids: req, action: "update", status: "done" });
    expect(res.status).toBe(200);

    expect(h.events.map((e) => e.name).sort()).toEqual([
      "task_status_change",
      "task_status_change",
    ]);
    for (const e of h.events) {
      expect(e.props.to).toBe("done");
      expect(e.props.via).toBe("batch");
      expect(typeof e.props.taskId).toBe("string");
    }
    expect(h.events.map((e) => e.props.taskId).sort()).toEqual([req[0], req[2]].sort());
  });

  it("只改 priority：不发状态事件（否则留存/激活会被没发生的状态变更污染）", async () => {
    const req = ids();
    h.existing = req;
    h.updateCount = 3;
    h.landed = req; // 即便读回有值，status 未传也不该发

    const res = await call({ ids: req, action: "update", priority: "high" });
    expect(res.status).toBe(200);
    expect(h.events).toEqual([]);
  });

  it("批量删除：不发 task_status_change", async () => {
    const req = ids();
    h.existing = req;

    const res = await call({ ids: req, action: "delete" });
    expect(res.status).toBe(200);
    expect(h.events).toEqual([]);
  });

  /**
   * 这条是上面三条都覆盖不到的洞：如果实现图省事按 validIds 发事件，
   * 前 3 条照样绿，但 RLS/并发挡掉某些行时会写出**没发生过的完成事件**，
   * 而闭环率、留存这些派生指标会把它当真数用。方向上永远是虚高，最难被发现。
   */
  it("update 有影响行数但读回为空（行没真的落到该状态）：一条都不发", async () => {
    const req = ids();
    h.existing = req;
    h.updateCount = 3;
    h.landed = [];

    const res = await call({ ids: req, action: "update", status: "done" });
    expect(res.status).toBe(200);
    expect(h.events).toEqual([]);
  });

  it("响应体保持原形状：不泄露 statusLandedIds", async () => {
    const req = ids();
    h.existing = req;
    h.updateCount = 3;
    h.landed = req;

    const res = await call({ ids: req, action: "update", status: "done" });
    const body = (await res.json()) as { code: number; data: Record<string, unknown> };
    expect(Object.keys(body.data).sort()).toEqual(["deleted", "skipped", "updated"]);
    expect(body.data.updated).toBe(3);
  });
});
