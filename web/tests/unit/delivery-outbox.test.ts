import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const tx = {
  deliveryOutbox: {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  },
};

vi.mock("@/lib/auth", () => ({
  runWithAuthOp: vi.fn((_op, fn) => fn(tx)),
  runWithAuthOpTx: vi.fn((value, _op, fn) => fn(value)),
}));

import {
  claimNextDeliveryOutbox,
  completeDeliveryOutbox,
  deliveryOutboxBackoffMs,
  enqueueDeliveryOutbox,
  failDeliveryOutbox,
  rescheduleDeliveryOutbox,
} from "@/lib/delivery/outbox";

const base = {
  workspaceId: "wid-1",
  deliverableId: "deliverable-1",
  taskId: "task-1",
  kind: "sync" as const,
};

describe("delivery outbox state machine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("退避有界：5/10/20/40/60 秒，不继续指数爆炸", () => {
    expect(deliveryOutboxBackoffMs(1)).toBe(5_000);
    expect(deliveryOutboxBackoffMs(2)).toBe(10_000);
    expect(deliveryOutboxBackoffMs(3)).toBe(20_000);
    expect(deliveryOutboxBackoffMs(4)).toBe(40_000);
    expect(deliveryOutboxBackoffMs(5)).toBe(60_000);
    expect(deliveryOutboxBackoffMs(99)).toBe(60_000);
  });

  it("重复入队复用既有行，不重置 processing 或 attempts", async () => {
    const existing = { id: "outbox-1", status: "processing", attempts: 2 };
    tx.deliveryOutbox.findUnique.mockResolvedValue(existing);
    const row = await enqueueDeliveryOutbox(tx as never, base);
    expect(row).toBe(existing);
    expect(tx.deliveryOutbox.create).not.toHaveBeenCalled();
  });

  it("相同 deliverableId 跨工作区各自入队，不共享幂等行", async () => {
    tx.deliveryOutbox.findUnique.mockResolvedValue(null);
    tx.deliveryOutbox.create.mockImplementation(async (args) => args.data);
    const first = await enqueueDeliveryOutbox(tx as never, base);
    const second = await enqueueDeliveryOutbox(tx as never, { ...base, workspaceId: "wid-2" });

    expect(first.workspaceId).toBe("wid-1");
    expect(second.workspaceId).toBe("wid-2");
    expect(tx.deliveryOutbox.create).toHaveBeenCalledTimes(2);
  });

  it("并发创建撞 unique 时回读既有行，不向外抛重复键", async () => {
    const existing = { id: "outbox-1" };
    tx.deliveryOutbox.findUnique.mockResolvedValue(null);
    tx.deliveryOutbox.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("duplicate", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    tx.deliveryOutbox.findUniqueOrThrow.mockResolvedValue(existing);
    await expect(enqueueDeliveryOutbox(tx as never, base)).resolves.toBe(existing);
    expect(tx.deliveryOutbox.findUniqueOrThrow).toHaveBeenCalledOnce();
  });

  it("认领使用旧状态与旧租约做条件更新，且不增加失败计数", async () => {
    const lease = new Date("2026-01-01T00:00:00Z");
    const candidate = { id: "outbox-1", status: "processing", leaseUntil: lease, attempts: 2 };
    tx.deliveryOutbox.findFirst.mockResolvedValue(candidate);
    tx.deliveryOutbox.updateMany.mockResolvedValue({ count: 1 });
    tx.deliveryOutbox.findUnique.mockResolvedValue({ ...candidate, leaseUntil: new Date() });
    await claimNextDeliveryOutbox(new Date("2026-01-02T00:00:00Z"));

    expect(tx.deliveryOutbox.updateMany).toHaveBeenCalledWith({
      where: { id: "outbox-1", status: "processing", leaseUntil: lease },
      data: { status: "processing", leaseUntil: expect.any(Date), lastError: null },
    });
    const data = tx.deliveryOutbox.updateMany.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("attempts");
  });

  it("正常重排清零连续失败；终态完成也清零并释放租约", async () => {
    const lease = new Date();
    tx.deliveryOutbox.updateMany.mockResolvedValue({ count: 1 });
    await rescheduleDeliveryOutbox("outbox-1", lease, new Date("2026-01-02T00:00:00Z"));
    await completeDeliveryOutbox("outbox-1", lease);

    expect(tx.deliveryOutbox.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: "outbox-1", status: "processing", leaseUntil: lease },
      data: {
        status: "pending",
        attempts: 0,
        nextAttemptAt: new Date("2026-01-02T00:00:00Z"),
        leaseUntil: null,
        lastError: null,
      },
    });
    expect(tx.deliveryOutbox.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: "outbox-1", status: "processing", leaseUntil: lease },
      data: { status: "done", attempts: 0, leaseUntil: null, lastError: null },
    });
  });

  it("连续失败到第 5 次才进入 dead_letter，并保留错误原因", async () => {
    tx.deliveryOutbox.updateMany.mockResolvedValue({ count: 1 });
    const row = {
      id: "outbox-1",
      attempts: 4,
      status: "processing",
      leaseUntil: new Date(),
    } as never;
    await failDeliveryOutbox(row, new Error("sidecar unavailable"));

    expect(tx.deliveryOutbox.updateMany).toHaveBeenCalledWith({
      where: { id: "outbox-1", status: "processing", leaseUntil: expect.any(Date) },
      data: {
        status: "dead_letter",
        attempts: { increment: 1 },
        nextAttemptAt: expect.any(Date),
        leaseUntil: null,
        lastError: "sidecar unavailable",
      },
    });
  });
});
