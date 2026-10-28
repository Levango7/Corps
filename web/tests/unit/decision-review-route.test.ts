import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * POST …/decisions/{did}/review 的单测（#48）。
 *
 * 这条路由的判据都是"语义边界"，光靠集成测试（CI 才跑）覆盖不到失败分支，
 * 而且它新增后会让零覆盖文件数 592→593（maturity testing-2 直接判红）。
 * 这里用 mock 打 handler，把四条边界钉死：
 *  1. 首次标记 → 写时间戳 + 发一次 decision_reviewed
 *  2. 重复标记 → 不写、不发、时间戳原样（否则"首次复盘时间"被点击次数污染）
 *  3. 撤销 → 清空且**不发事件**（那是纠错，不是一次新的复盘）
 *  4. 撤销但本来未复盘 → 不写、不发
 * 外加：找不到 404、权限拒绝透传、空 body 视为 reviewed=true。
 */

const { mockTx, mockTrack, mockRequirePermission, mockCtx } = vi.hoisted(() => ({
  mockTx: {
    decision: { findFirst: vi.fn(), update: vi.fn() },
  },
  mockTrack: vi.fn(),
  mockRequirePermission: vi.fn(),
  mockCtx: { payload: { sub: "user-1" }, member: { role: "member" } },
}));

vi.mock("@/lib/auth", () => ({
  getWorkspaceContextV2: vi.fn(async () => ({ ok: true, ...mockCtx })),
  runWithWorkspace: (_wid: string, fn: (tx: unknown) => unknown) => fn(mockTx),
}));
vi.mock("@/lib/permissions", () => ({ requirePermission: mockRequirePermission }));
vi.mock("@/lib/analytics-server", () => ({ trackServerEvent: mockTrack }));

import { POST } from "@/app/api/v1/workspaces/[wid]/tasks/[id]/decisions/[did]/review/route";

const WID = "00000000-0000-4000-8000-000000000001";
const TID = "00000000-0000-4000-8000-000000000002";
const DID = "00000000-0000-4000-8000-000000000003";

function call(body?: unknown): Promise<Response> {
  const req = new NextRequest(
    `http://localhost/api/v1/workspaces/${WID}/tasks/${TID}/decisions/${DID}/review`,
    {
      method: "POST",
      ...(body === undefined
        ? {}
        : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
    },
  );
  return POST(req, { params: Promise.resolve({ wid: WID, id: TID, did: DID }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequirePermission.mockResolvedValue(null);
  mockTx.decision.findFirst.mockReset();
  mockTx.decision.update.mockReset();
});

describe("POST …/decisions/{did}/review", () => {
  it("首次标记：写时间戳、changed=true、发一次 decision_reviewed", async () => {
    mockTx.decision.findFirst.mockResolvedValue({ id: DID, version: 3, reviewedAt: null });
    const at = new Date("2026-10-28T00:00:00Z");
    mockTx.decision.update.mockResolvedValue({ reviewedAt: at });

    const res = await call({});
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { reviewedAt: string; changed: boolean } };
    expect(json.data.changed).toBe(true);
    expect(json.data.reviewedAt).toBe(at.toISOString());

    const upd = mockTx.decision.update.mock.calls[0][0];
    expect(upd.data.reviewedAt).toBeInstanceOf(Date);
    expect(mockTrack).toHaveBeenCalledTimes(1);
    expect(mockTrack.mock.calls[0][0]).toMatchObject({
      name: "decision_reviewed",
      workspaceId: WID,
      props: { taskId: TID, decisionId: DID, version: 3 },
    });
  });

  it("重复标记：不写、不发事件，时间戳原样返回（幂等）", async () => {
    const at = new Date("2026-10-01T00:00:00Z");
    mockTx.decision.findFirst.mockResolvedValue({ id: DID, version: 1, reviewedAt: at });

    const res = await call({ reviewed: true });
    const json = (await res.json()) as { data: { reviewedAt: string; changed: boolean } };
    expect(json.data.changed).toBe(false);
    expect(json.data.reviewedAt).toBe(at.toISOString());
    expect(mockTx.decision.update).not.toHaveBeenCalled();
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it("撤销复盘：清空时间戳，但**不发** decision_reviewed（纠错不是复盘）", async () => {
    mockTx.decision.findFirst.mockResolvedValue({
      id: DID,
      version: 2,
      reviewedAt: new Date("2026-10-01T00:00:00Z"),
    });
    mockTx.decision.update.mockResolvedValue({ reviewedAt: null });

    const res = await call({ reviewed: false });
    const json = (await res.json()) as { data: { reviewedAt: null; changed: boolean } };
    expect(json.data.changed).toBe(true);
    expect(json.data.reviewedAt).toBeNull();
    expect(mockTx.decision.update.mock.calls[0][0].data.reviewedAt).toBeNull();
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it("撤销但本来未复盘：不写、不发、changed=false", async () => {
    mockTx.decision.findFirst.mockResolvedValue({ id: DID, version: 1, reviewedAt: null });
    const res = await call({ reviewed: false });
    const json = (await res.json()) as { data: { changed: boolean } };
    expect(json.data.changed).toBe(false);
    expect(mockTx.decision.update).not.toHaveBeenCalled();
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it("决策不存在：404，且不写不发", async () => {
    mockTx.decision.findFirst.mockResolvedValue(null);
    const res = await call({});
    expect(res.status).toBe(404);
    expect(mockTx.decision.update).not.toHaveBeenCalled();
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it("权限拒绝：直接透传 403，不查库", async () => {
    mockRequirePermission.mockResolvedValue(
      new Response(JSON.stringify({ code: 403 }), { status: 403 }),
    );
    const res = await call({});
    expect(res.status).toBe(403);
    expect(mockTx.decision.findFirst).not.toHaveBeenCalled();
  });

  it("空 body 视为 reviewed=true（纯动作端点不该因缺 body 变 400）", async () => {
    mockTx.decision.findFirst.mockResolvedValue({ id: DID, version: 1, reviewedAt: null });
    mockTx.decision.update.mockResolvedValue({ reviewedAt: new Date() });
    const res = await call();
    expect(res.status).toBe(200);
    expect(mockTx.decision.update).toHaveBeenCalled();
  });
});
