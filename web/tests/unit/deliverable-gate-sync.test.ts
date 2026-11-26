import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getLoomTask: vi.fn(),
  approveLoomTask: vi.fn(),
  rejectLoomTask: vi.fn(),
  runWithWorkspace: vi.fn(),
  ensureGate: vi.fn(),
  readDecision: vi.fn(),
  outboxCreate: vi.fn(),
  outboxFindUnique: vi.fn(),
}));

vi.mock("@/lib/ai/nexusloom", () => ({
  getLoomTask: mocks.getLoomTask,
  approveLoomTask: mocks.approveLoomTask,
  rejectLoomTask: mocks.rejectLoomTask,
}));

vi.mock("@/lib/auth", () => ({
  runWithWorkspace: mocks.runWithWorkspace,
  runWithAuthOpTx: vi.fn((tx, _op, fn) => fn(tx)),
}));

vi.mock("@/lib/approval/deliverable-gate", () => ({
  ensureDeliverableGateApproval: mocks.ensureGate,
  readDeliverableGateDecision: mocks.readDecision,
}));

import { syncDeliverableFromLoom } from "@/lib/ai/deliverable-sync";

const baseRow = {
  id: "deliverable-1",
  taskId: "task-1",
  title: "测试交付",
  pipeline: "docgen-review",
  status: "running",
  outputPath: null,
  outputSummary: null,
  approvalInstanceId: null,
  createdBy: "user-1",
};

describe("deliverable gate sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const tx = {
      deliverable: { update: vi.fn().mockResolvedValue({}) },
      deliveryOutbox: {
        findUnique: mocks.outboxFindUnique.mockResolvedValue(null),
        create: mocks.outboxCreate.mockResolvedValue({}),
      },
    };
    mocks.runWithWorkspace.mockImplementation(
      async (_wid: string, fn: (value: unknown) => unknown) => fn(tx),
    );
    mocks.ensureGate.mockResolvedValue("instance-1");
    mocks.readDecision.mockResolvedValue(null);
  });

  it("发现 awaiting_approval 时惰性建审批实例并落待审展示态", async () => {
    mocks.getLoomTask.mockResolvedValue({
      id: "task-1",
      status: "paused",
      pipeline: "docgen-review",
      created_at: null,
      finished_at: null,
      error: null,
      result: {},
      output_path: null,
      output_content: null,
      awaiting_approval: { nodes: ["approval_gate"] },
    });

    const result = await syncDeliverableFromLoom({ wid: "wid-1", userId: "user-1", row: baseRow });

    expect(mocks.ensureGate).toHaveBeenCalledOnce();
    expect(result.status).toBe("awaiting_approval");
    expect(result.approvalInstanceId).toBe("instance-1");
    expect(result.awaitingApproval?.nodes).toEqual(["approval_gate"]);
  });

  it("审批已通过但 sidecar 仍等待时写入放行 outbox，不由 UI 直接放行", async () => {
    mocks.getLoomTask.mockResolvedValue({
      id: "task-1",
      status: "paused",
      pipeline: "docgen-review",
      created_at: null,
      finished_at: null,
      error: null,
      result: {},
      output_path: null,
      output_content: null,
      awaiting_approval: { nodes: ["approval_gate"] },
    });
    mocks.readDecision.mockResolvedValue({ status: "approved", comment: "验收通过" });
    mocks.approveLoomTask.mockResolvedValue({ approved: true });

    await syncDeliverableFromLoom({
      wid: "wid-1",
      userId: "user-1",
      row: { ...baseRow, approvalInstanceId: "instance-1", status: "awaiting_approval" },
    });

    expect(mocks.ensureGate).not.toHaveBeenCalled();
    expect(mocks.outboxCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: "approve", taskId: "task-1" }),
    });
    expect(mocks.approveLoomTask).not.toHaveBeenCalled();
    expect(mocks.rejectLoomTask).not.toHaveBeenCalled();
  });

  it("sidecar 投影只剩 paused 时仍按既有审批终态写入 outbox", async () => {
    mocks.getLoomTask.mockResolvedValue({
      id: "task-1",
      status: "paused",
      pipeline: "docgen-review",
      created_at: null,
      finished_at: null,
      error: null,
      result: {},
      output_path: null,
      output_content: null,
      awaiting_approval: null,
    });
    mocks.readDecision.mockResolvedValue({ status: "approved", comment: "重启前已批准" });
    mocks.approveLoomTask.mockResolvedValue({ approved: true });

    const result = await syncDeliverableFromLoom({
      wid: "wid-1",
      userId: "user-1",
      row: { ...baseRow, approvalInstanceId: "instance-1", status: "awaiting_approval" },
    });

    expect(result.status).toBe("awaiting_approval");
    expect(mocks.outboxCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: "approve", taskId: "task-1" }),
    });
    expect(mocks.approveLoomTask).not.toHaveBeenCalled();
  });

  it("普通完成任务不创建审批，也不会触发闸门放行", async () => {
    mocks.getLoomTask.mockResolvedValue({
      id: "task-1",
      status: "done",
      pipeline: "docgen",
      created_at: null,
      finished_at: "2026-11-24T00:00:00Z",
      error: null,
      result: {},
      output_path: "/app/output/task-1.md",
      output_content: "正文",
      awaiting_approval: null,
    });

    const result = await syncDeliverableFromLoom({
      wid: "wid-1",
      userId: "user-1",
      row: { ...baseRow, pipeline: "docgen" },
    });

    expect(result.status).toBe("done");
    expect(mocks.ensureGate).not.toHaveBeenCalled();
    expect(mocks.approveLoomTask).not.toHaveBeenCalled();
    expect(mocks.rejectLoomTask).not.toHaveBeenCalled();
  });
});
