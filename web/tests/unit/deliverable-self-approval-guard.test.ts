// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/ai/shared", () => ({
  getUserId: vi.fn().mockResolvedValue("user-1"),
  unauthorizedResponse: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getWorkspaceContextV2: vi.fn().mockResolvedValue({ ok: true, payload: { sub: "user-1" } }),
  runWithWorkspace: vi.fn(async (_wid: string, fn: (tx: unknown) => unknown) =>
    fn({ deliverable: { findFirst: mocks.findFirst, update: mocks.update } }),
  ),
}));

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/red-metrics", () => ({ withRed: (fn: unknown) => fn }));

import { POST } from "@/app/api/v1/ai/deliverables/[id]/approve/route";

function request(action: "approve" | "reject") {
  return new NextRequest(
    "http://localhost/api/v1/ai/deliverables/deliverable-1/approve?wid=wid-1",
    { method: "POST", body: JSON.stringify({ action, note: "test note" }) },
  );
}

describe("deliverable self approval guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirst.mockResolvedValue({
      id: "deliverable-1",
      status: "done",
      approvalStatus: null,
      approvalInstanceId: "instance-1",
    });
    mocks.update.mockResolvedValue({ id: "deliverable-1", approvalStatus: "approved" });
  });

  it("已送标准审批流时拒绝自含审批绕过，且不写交付物", async () => {
    const response = await POST(request("approve"), {
      params: Promise.resolve({ id: "deliverable-1" }),
    });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.data).toEqual({ instanceId: "instance-1" });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("未送审的完成交付物仍保留原自含审批能力", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "deliverable-1",
      status: "done",
      approvalStatus: null,
      approvalInstanceId: null,
    });
    const response = await POST(request("approve"), {
      params: Promise.resolve({ id: "deliverable-1" }),
    });
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledOnce();
  });
});
