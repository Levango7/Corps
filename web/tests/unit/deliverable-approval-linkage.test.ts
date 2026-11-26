import { beforeEach, describe, expect, it, vi } from "vitest";

const update = vi.fn();
const outboxCreate = vi.fn();
const outboxFindUnique = vi.fn();
const tx = {
  deliverable: { update },
  deliveryOutbox: { create: outboxCreate, findUnique: outboxFindUnique },
} as never;

vi.mock("@/lib/auth", () => ({
  runWithAuthOpTx: vi.fn((value, _op, fn) => fn(value)),
}));

import { syncDeliverableApproval } from "@/lib/approval/deliverable-linkage";

describe("deliverable approval linkage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    update.mockResolvedValue({});
    outboxCreate.mockResolvedValue({});
    outboxFindUnique.mockResolvedValue(null);
  });

  it("交付后验收终态回写交付物，不返回闸门任务", async () => {
    const result = await syncDeliverableApproval(
      tx,
      {
        workspaceId: "wid-1",
        entityType: "deliverable",
        entityId: "deliverable-1",
        status: "approved",
        title: "交付验收",
      },
      "owner-1",
      "通过",
    );

    expect(result).toEqual({ gateTaskId: null });
    expect(update).toHaveBeenCalledWith({
      where: { id: "deliverable-1" },
      data: expect.objectContaining({
        approvalStatus: "approved",
        approvedBy: "owner-1",
        approvalNote: "通过",
      }),
    });
    expect(outboxCreate).not.toHaveBeenCalled();
  });

  it("人审闸门驳回回写交付物并写入 reject outbox", async () => {
    const result = await syncDeliverableApproval(
      tx,
      {
        workspaceId: "wid-1",
        entityType: "deliverable_gate",
        entityId: "deliverable-1",
        status: "rejected",
        title: "交付前审批",
        content: { mode: "gate", taskId: "task-1" },
      },
      "owner-1",
      "内容需修改",
    );

    expect(result).toEqual({ gateTaskId: "task-1" });
    expect(update).toHaveBeenCalledWith({
      where: { id: "deliverable-1" },
      data: expect.objectContaining({ approvalStatus: "rejected", approvalNote: "内容需修改" }),
    });
    expect(outboxCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "wid-1",
        deliverableId: "deliverable-1",
        taskId: "task-1",
        kind: "reject",
        dedupeKey: "reject:deliverable-1",
      }),
    });
  });

  it("非交付实例与未决实例都不写交付物", async () => {
    await syncDeliverableApproval(
      tx,
      {
        workspaceId: "wid-1",
        entityType: "document",
        entityId: "doc-1",
        status: "approved",
        title: "文档",
      },
      "owner-1",
    );
    await syncDeliverableApproval(
      tx,
      {
        workspaceId: "wid-1",
        entityType: "deliverable",
        entityId: "deliverable-1",
        status: "pending",
        title: "交付",
      },
      "owner-1",
    );
    expect(update).not.toHaveBeenCalled();
    expect(outboxCreate).not.toHaveBeenCalled();
  });
});
