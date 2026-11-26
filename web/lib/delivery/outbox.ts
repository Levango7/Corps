/**
 * 交付同步 outbox 的持久化状态机。
 *
 * 幂等键：(workspaceId, kind, deliverableId)。同一交付物的同步/审批意图
 * 无论由 UI、webhook 还是 worker 重复发现，都只有一行。
 * attempts 只记录连续失败次数，正常长任务的多次同步不会走向死信。
 */

import { Prisma } from "@prisma/client";
import { runWithAuthOp, runWithAuthOpTx } from "@/lib/auth";

export type DeliveryOutboxKind = "sync" | "approve" | "reject";
export type DeliveryOutboxRow = Prisma.DeliveryOutboxGetPayload<object>;

export const DELIVERY_OUTBOX_LEASE_MS = 60_000;
export const DELIVERY_OUTBOX_MAX_ATTEMPTS = 5;

export function deliveryOutboxBackoffMs(attempts: number): number {
  const n = Math.max(1, Math.min(attempts, 5));
  return Math.min(60_000, 5_000 * 2 ** (n - 1));
}

/** 幂等入队。已有行时保留 worker 当前状态，绝不把 processing 强行重置。 */
export async function enqueueDeliveryOutbox(
  tx: Prisma.TransactionClient,
  args: {
    workspaceId: string;
    deliverableId: string;
    taskId: string;
    kind: DeliveryOutboxKind;
    payload?: Prisma.InputJsonValue;
  },
): Promise<DeliveryOutboxRow> {
  const { workspaceId, deliverableId, taskId, kind, payload } = args;
  const dedupeKey = `${kind}:${deliverableId}`;
  return runWithAuthOpTx(tx, "cron", async (tx2) => {
    const existing = await tx2.deliveryOutbox.findUnique({
      where: { workspaceId_dedupeKey: { workspaceId, dedupeKey } },
    });
    if (existing) return existing;
    try {
      return await tx2.deliveryOutbox.create({
        data: {
          workspaceId,
          deliverableId,
          taskId,
          kind,
          dedupeKey,
          payload: payload ?? {},
        },
      });
    } catch (error) {
      // 并发发现同一意图时 unique 约束裁决，后到者直接复用已建行。
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return tx2.deliveryOutbox.findUniqueOrThrow({
          where: { workspaceId_dedupeKey: { workspaceId, dedupeKey } },
        });
      }
      throw error;
    }
  });
}

/** 条件认领：状态与旧租约必须同时匹配；并发/过期 worker 只有一个能成功。 */
export async function claimNextDeliveryOutbox(now = new Date()): Promise<DeliveryOutboxRow | null> {
  return runWithAuthOp("cron", async (tx) => {
    const candidate = await tx.deliveryOutbox.findFirst({
      where: {
        OR: [
          { status: "pending", nextAttemptAt: { lte: now } },
          { status: "processing", leaseUntil: { lte: now } },
        ],
      },
      orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
    });
    if (!candidate) return null;

    const leaseUntil = new Date(now.getTime() + DELIVERY_OUTBOX_LEASE_MS);
    const claimed = await tx.deliveryOutbox.updateMany({
      where: {
        id: candidate.id,
        status: candidate.status,
        leaseUntil: candidate.leaseUntil,
      },
      data: { status: "processing", leaseUntil, lastError: null },
    });
    if (claimed.count !== 1) return null;
    return tx.deliveryOutbox.findUnique({ where: { id: candidate.id } });
  });
}

/** 终态完成；旧租约不匹配表示已被其他 worker 接管，不再允许老 worker 写终态。 */
export async function completeDeliveryOutbox(id: string, leaseUntil: Date): Promise<number> {
  return runWithAuthOp("cron", async (tx) => {
    const result = await tx.deliveryOutbox.updateMany({
      where: { id, status: "processing", leaseUntil },
      data: {
        status: "done",
        attempts: 0,
        leaseUntil: null,
        lastError: null,
      },
    });
    return result.count;
  });
}

/** 正常同步后仍未终态：短周期再试，同时清零连续失败计数。 */
export async function rescheduleDeliveryOutbox(
  id: string,
  leaseUntil: Date,
  nextAttemptAt: Date,
): Promise<number> {
  return runWithAuthOp("cron", async (tx) => {
    const result = await tx.deliveryOutbox.updateMany({
      where: { id, status: "processing", leaseUntil },
      data: {
        status: "pending",
        attempts: 0,
        nextAttemptAt,
        leaseUntil: null,
        lastError: null,
      },
    });
    return result.count;
  });
}

/** 失败退避；达到上限进入 dead_letter，old lease 仍严格防旧 worker 覆盖。 */
export async function failDeliveryOutbox(row: DeliveryOutboxRow, error: unknown): Promise<number> {
  const attempts = row.attempts + 1;
  const dead = attempts >= DELIVERY_OUTBOX_MAX_ATTEMPTS;
  const nextAttemptAt = new Date(Date.now() + deliveryOutboxBackoffMs(attempts));
  return runWithAuthOp("cron", async (tx) => {
    const result = await tx.deliveryOutbox.updateMany({
      where: { id: row.id, status: "processing", leaseUntil: row.leaseUntil },
      data: {
        status: dead ? "dead_letter" : "pending",
        attempts: { increment: 1 },
        nextAttemptAt,
        leaseUntil: null,
        lastError: (error instanceof Error ? error.message : String(error)).slice(0, 2000),
      },
    });
    return result.count;
  });
}
