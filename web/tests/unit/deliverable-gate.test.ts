import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureDeliverableGateApproval } from "@/lib/approval/deliverable-gate";

const row = {
  id: "deliverable-1",
  taskId: "task-1",
  title: "测试交付",
  pipeline: "docgen-review",
  outputPath: null,
  outputSummary: null,
  createdBy: "user-1",
};

describe("ensureDeliverableGateApproval", () => {
  const executeRaw = vi.fn();
  const deliverableFindFirst = vi.fn();
  const deliverableUpdate = vi.fn();
  const templateFindFirst = vi.fn();
  const templateCreate = vi.fn();
  const instanceCreate = vi.fn();
  const tx = {
    $executeRaw: executeRaw,
    deliverable: { findFirst: deliverableFindFirst, update: deliverableUpdate },
    approvalTemplate: { findFirst: templateFindFirst, create: templateCreate },
    approvalInstance: { create: instanceCreate },
  } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    executeRaw.mockResolvedValue(1);
    deliverableUpdate.mockResolvedValue({});
    templateFindFirst.mockResolvedValue({ id: "template-1" });
    instanceCreate.mockResolvedValue({ id: "instance-1" });
  });

  it("已有实例时复用，不重复创建", async () => {
    deliverableFindFirst.mockResolvedValue({ approvalInstanceId: "instance-old" });
    await expect(ensureDeliverableGateApproval(tx, "wid-1", row)).resolves.toBe("instance-old");
    expect(executeRaw).toHaveBeenCalledOnce();
    expect(instanceCreate).not.toHaveBeenCalled();
  });

  it("首次发现闸门时用 executeRaw 加锁并创建 deliverable_gate 实例", async () => {
    deliverableFindFirst.mockResolvedValue({ approvalInstanceId: null });
    await expect(ensureDeliverableGateApproval(tx, "wid-1", row)).resolves.toBe("instance-1");
    expect(executeRaw).toHaveBeenCalledOnce();
    expect(instanceCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: "deliverable_gate",
        entityId: "deliverable-1",
        status: "pending",
        applicantId: "user-1",
        content: expect.objectContaining({ mode: "gate", taskId: "task-1" }),
      }),
      select: { id: true },
    });
    expect(deliverableUpdate).toHaveBeenCalledWith({
      where: { id: "deliverable-1" },
      data: { approvalInstanceId: "instance-1" },
    });
  });
});