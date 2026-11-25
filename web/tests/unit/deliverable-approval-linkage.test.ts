import { beforeEach, describe, expect, it, vi } from "vitest";
import { syncDeliverableApproval } from "@/lib/approval/deliverable-linkage";

const update = vi.fn();
const tx = { deliverable: { update } } as never;

describe("deliverable approval linkage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    update.mockResolvedValue({});
  });

  it("交付后验收终态回写交付物，不返回闸门任务", async () => {
    const result = await syncDeliverableApproval(
      tx,
      {
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
  });

  it("人审闸门驳回回写交付物并带出 sidecar taskId", async () => {
    const result = await syncDeliverableApproval(
      tx,
      {
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
  });

  it("非交付实例与未决实例都不写交付物", async () => {
    await syncDeliverableApproval(
      tx,
      { entityType: "document", entityId: "doc-1", status: "approved", title: "文档" },
      "owner-1",
    );
    await syncDeliverableApproval(
      tx,
      { entityType: "deliverable", entityId: "deliverable-1", status: "pending", title: "交付" },
      "owner-1",
    );
    expect(update).not.toHaveBeenCalled();
  });
});