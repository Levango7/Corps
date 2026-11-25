import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  tx: {
    deliverable: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
  getWorkspaceContextV2: vi.fn(),
  getLoomTask: vi.fn(),
  listLoomTasks: vi.fn(),
}));

vi.mock("@/lib/ai/shared", () => ({
  getUserId: vi.fn(async () => "user-1"),
  unauthorizedResponse: vi.fn(() => new Response(null, { status: 401 })),
}));
vi.mock("@/lib/auth", () => ({
  getWorkspaceContextV2: mocks.getWorkspaceContextV2,
  runWithWorkspace: vi.fn(async (_wid: string, fn: (tx: unknown) => unknown) => fn(mocks.tx)),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => null) }));
vi.mock("@/lib/api-messages", () => ({ apiMsg: (_req: unknown, key: string) => key }));
vi.mock("@/lib/auth-response", () => ({ authFailure: vi.fn() }));
vi.mock("@/lib/red-metrics", () => ({ withRed: (handler: unknown) => handler }));
vi.mock("@/lib/ai/nexusloom", () => ({
  LoomUnavailableError: class LoomUnavailableError extends Error {},
  getLoomTask: mocks.getLoomTask,
  listLoomTasks: mocks.listLoomTasks,
  submitLoomTask: vi.fn(),
  decodeLoomTitle: vi.fn((value: string) => ({ title: value })),
  encodeLoomTitle: vi.fn((_wid: string, title: string) => title),
}));

import { GET as listDeliverables } from "@/app/api/v1/ai/deliverables/route";
import { GET as getDeliverable } from "@/app/api/v1/ai/deliverables/[id]/route";
import { POST as approveDeliverable } from "@/app/api/v1/ai/deliverables/[id]/approve/route";

const WID = "63acadde-1111-4222-8333-444455556666";
const OTHER_WID = "63acadde-1111-4222-8333-444455556667";
const DELIVERABLE_ID = "7d0dc2af-2222-4333-8444-555566667777";

function makeRow() {
  return {
    id: DELIVERABLE_ID,
    taskId: "loom-task-1",
    title: "交付报告",
    pipeline: "docgen",
    status: "done",
    outputPath: "/tmp/report.md",
    outputSummary: "# 交付正文",
    approvalStatus: null as string | null,
    approvalNote: null as string | null,
    approvedBy: null as string | null,
    approvedAt: null as Date | null,
    createdAt: new Date("2026-11-24T00:00:00Z"),
    finishedAt: new Date("2026-11-24T00:05:00Z"),
  };
}

function listRequest(wid = WID) {
  return new NextRequest(`http://localhost/api/v1/ai/deliverables?wid=${wid}`);
}

function detailRequest(wid = WID) {
  return new NextRequest(`http://localhost/api/v1/ai/deliverables/${DELIVERABLE_ID}?wid=${wid}`);
}

function approvalRequest(wid = WID) {
  return new NextRequest(
    `http://localhost/api/v1/ai/deliverables/${DELIVERABLE_ID}/approve?wid=${wid}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve", note: "验收通过" }),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getWorkspaceContextV2.mockResolvedValue({ ok: true, payload: { sub: "user-1" } });
  mocks.listLoomTasks.mockResolvedValue([]);
  mocks.getLoomTask.mockResolvedValue({ status: "done" });
  mocks.tx.deliverable.findFirst.mockReset();
  mocks.tx.deliverable.findMany.mockReset();
  mocks.tx.deliverable.update.mockReset();
});

describe("交付审批状态回显", () => {
  it("审批后立即读取，列表与详情返回完整审批字段", async () => {
    const row = makeRow();
    mocks.tx.deliverable.findFirst.mockImplementation(async () => row);
    mocks.tx.deliverable.findMany.mockImplementation(async () => [row]);
    mocks.tx.deliverable.update.mockImplementation(async ({ data }) => {
      Object.assign(row, data);
      return {
        id: row.id,
        approvalStatus: row.approvalStatus,
        approvedAt: row.approvedAt,
      };
    });

    const approved = await approveDeliverable(approvalRequest(), {
      params: Promise.resolve({ id: DELIVERABLE_ID }),
    });
    expect(approved.status).toBe(200);

    const detail = await getDeliverable(detailRequest(), {
      params: Promise.resolve({ id: DELIVERABLE_ID }),
    });
    expect(detail.status).toBe(200);
    const detailJson = (await detail.json()) as { data: Record<string, unknown> };
    expect(detailJson.data).toMatchObject({
      approvalStatus: "approved",
      approvalNote: "验收通过",
      approvedBy: "user-1",
      approvedAt: row.approvedAt?.toISOString(),
    });

    const list = await listDeliverables(listRequest());
    expect(list.status).toBe(200);
    const listJson = (await list.json()) as {
      data: { items: Array<Record<string, unknown>> };
    };
    expect(listJson.data.items[0]).toMatchObject({
      approvalStatus: "approved",
      approvalNote: "验收通过",
      approvedBy: "user-1",
      approvedAt: row.approvedAt?.toISOString(),
    });
  });

  it("重复审批返回 409，不产生第二次写入", async () => {
    mocks.tx.deliverable.findFirst.mockResolvedValue({
      id: DELIVERABLE_ID,
      status: "done",
      approvalStatus: "approved",
    });

    const res = await approveDeliverable(approvalRequest(), {
      params: Promise.resolve({ id: DELIVERABLE_ID }),
    });

    expect(res.status).toBe(409);
    expect(mocks.tx.deliverable.update).not.toHaveBeenCalled();
  });

  it("跨 workspace 读取返回 404，查询始终限定当前 workspace", async () => {
    mocks.tx.deliverable.findFirst.mockResolvedValue(null);

    const res = await getDeliverable(detailRequest(OTHER_WID), {
      params: Promise.resolve({ id: DELIVERABLE_ID }),
    });

    expect(res.status).toBe(404);
    expect(mocks.tx.deliverable.findFirst).toHaveBeenCalledWith({
      where: { id: DELIVERABLE_ID, workspaceId: OTHER_WID },
    });
  });
});
