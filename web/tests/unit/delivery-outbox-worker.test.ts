import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimNext: vi.fn(),
  complete: vi.fn(),
  reschedule: vi.fn(),
  fail: vi.fn(),
  getLoomTask: vi.fn(),
  release: vi.fn(),
  sync: vi.fn(),
  readDecision: vi.fn(),
  deliverableFindFirst: vi.fn(),
  runWithWorkspace: vi.fn(),
}));

vi.mock("@/lib/delivery/outbox", () => ({
  claimNextDeliveryOutbox: mocks.claimNext,
  completeDeliveryOutbox: mocks.complete,
  rescheduleDeliveryOutbox: mocks.reschedule,
  failDeliveryOutbox: mocks.fail,
  DELIVERY_OUTBOX_MAX_ATTEMPTS: 5,
}));

vi.mock("@/lib/ai/nexusloom", () => ({ getLoomTask: mocks.getLoomTask }));

vi.mock("@/lib/ai/deliverable-sync", () => ({
  isTerminalDeliverableStatus: (status: string) =>
    ["done", "completed", "failed", "error", "cancelled"].includes(status),
  releaseDeliverableGate: mocks.release,
  syncDeliverableFromLoom: mocks.sync,
}));

vi.mock("@/lib/approval/deliverable-gate", () => ({
  readDeliverableGateDecision: mocks.readDecision,
}));

vi.mock("@/lib/auth", () => ({ runWithWorkspace: mocks.runWithWorkspace }));

import { processDeliveryOutboxBatch } from "@/lib/delivery/outbox-worker";

const deliverable = {
  id: "deliverable-1",
  taskId: "task-1",
  title: "测试交付",
  pipeline: "docgen-review",
  status: "awaiting_approval",
  outputPath: null,
  outputSummary: null,
  approvalInstanceId: "instance-1",
  createdBy: "user-1",
};

function outboxRow(kind: "sync" | "approve" | "reject", attempts = 0) {
  return {
    id: "outbox-1",
    workspaceId: "wid-1",
    deliverableId: "deliverable-1",
    taskId: "task-1",
    kind,
    attempts,
    status: "processing",
    leaseUntil: new Date("2026-01-01T00:00:00Z"),
  };
}

describe("delivery outbox worker", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.runWithWorkspace.mockImplementation(async (_wid, fn) =>
      fn({ deliverable: { findFirst: mocks.deliverableFindFirst } }),
    );
    mocks.deliverableFindFirst.mockResolvedValue(deliverable);
    mocks.claimNext.mockResolvedValue(null);
    mocks.complete.mockResolvedValue(1);
    mocks.reschedule.mockResolvedValue(1);
    mocks.fail.mockResolvedValue(1);
    mocks.release.mockResolvedValue(true);
    mocks.sync.mockResolvedValue({ status: "done" });
  });

  it("待审任务：读取原审批备注，放行后同步完成", async () => {
    const row = outboxRow("approve");
    mocks.claimNext.mockResolvedValueOnce(row).mockResolvedValueOnce(null);
    mocks.getLoomTask.mockResolvedValue({ awaiting_approval: { nodes: ["approval_gate"] } });
    mocks.readDecision.mockResolvedValue({ status: "approved", comment: "验收通过" });

    const stats = await processDeliveryOutboxBatch(5);

    expect(mocks.release).toHaveBeenCalledWith("task-1", {
      status: "approved",
      comment: "验收通过",
    });
    expect(mocks.sync).toHaveBeenCalledWith(
      expect.objectContaining({ source: "worker", row: deliverable }),
    );
    expect(mocks.complete).toHaveBeenCalledWith("outbox-1", row.leaseUntil);
    expect(stats).toEqual({ claimed: 1, completed: 1, rescheduled: 0, failed: 0, deadLetter: 0 });
  });

  it("其他 worker 已放行：不重复决策，只同步现有结果", async () => {
    mocks.claimNext.mockResolvedValueOnce(outboxRow("approve")).mockResolvedValueOnce(null);
    mocks.getLoomTask.mockResolvedValue({ awaiting_approval: null });

    const stats = await processDeliveryOutboxBatch(1);

    expect(mocks.release).not.toHaveBeenCalled();
    expect(mocks.readDecision).not.toHaveBeenCalled();
    expect(mocks.sync).toHaveBeenCalledOnce();
    expect(stats.completed).toBe(1);
  });

  it("交付物已是终态：直接完成，不再调用 sidecar", async () => {
    mocks.claimNext.mockResolvedValueOnce(outboxRow("approve")).mockResolvedValueOnce(null);
    mocks.deliverableFindFirst.mockResolvedValue({ ...deliverable, status: "done" });

    const stats = await processDeliveryOutboxBatch(1);

    expect(mocks.getLoomTask).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.complete).toHaveBeenCalledOnce();
    expect(stats.completed).toBe(1);
  });

  it("第 5 次连续失败进入 dead_letter 统计，不继续正常完成", async () => {
    mocks.claimNext.mockResolvedValueOnce(outboxRow("sync", 4)).mockResolvedValueOnce(null);
    mocks.sync.mockRejectedValue(new Error("sidecar unavailable"));

    const stats = await processDeliveryOutboxBatch(1);

    expect(mocks.fail).toHaveBeenCalledOnce();
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(stats).toEqual({ claimed: 1, completed: 0, rescheduled: 0, failed: 1, deadLetter: 1 });
  });
});
