/**
 * 交付 outbox 后台处理器：claim → sidecar 执行 → complete/reschedule/fail。
 * 每个阶段都是独立短事务，网络 IO 不进入 RLS 事务；UI 不参与推进。
 */

import { runWithWorkspace } from "@/lib/auth";
import { getLoomTask } from "@/lib/ai/nexusloom";
import {
  isTerminalDeliverableStatus,
  releaseDeliverableGate,
  syncDeliverableFromLoom,
  type SyncableDeliverable,
} from "@/lib/ai/deliverable-sync";
import { readDeliverableGateDecision } from "@/lib/approval/deliverable-gate";
import {
  claimNextDeliveryOutbox,
  completeDeliveryOutbox,
  failDeliveryOutbox,
  rescheduleDeliveryOutbox,
  DELIVERY_OUTBOX_MAX_ATTEMPTS,
  type DeliveryOutboxRow,
} from "./outbox";

export interface DeliveryOutboxBatchStats {
  claimed: number;
  completed: number;
  rescheduled: number;
  failed: number;
  deadLetter: number;
}

const RESCHEDULE_MS = 10_000;

async function loadDeliverable(row: DeliveryOutboxRow): Promise<SyncableDeliverable | null> {
  return runWithWorkspace(row.workspaceId, async (tx) =>
    tx.deliverable.findFirst({
      where: { id: row.deliverableId, workspaceId: row.workspaceId },
      select: {
        id: true,
        taskId: true,
        title: true,
        pipeline: true,
        status: true,
        outputPath: true,
        outputSummary: true,
        approvalInstanceId: true,
        createdBy: true,
      },
    }),
  );
}

async function processSync(row: DeliveryOutboxRow): Promise<"done" | "reschedule"> {
  const deliverable = await loadDeliverable(row);
  // 交付物被清理是终态事实，不应无限重试。
  if (!deliverable || isTerminalDeliverableStatus(deliverable.status)) return "done";
  const synced = await syncDeliverableFromLoom({
    wid: row.workspaceId,
    userId: deliverable.createdBy,
    row: deliverable,
    source: "worker",
  });
  return isTerminalDeliverableStatus(synced.status) ? "done" : "reschedule";
}

async function processDecision(row: DeliveryOutboxRow): Promise<"done" | "reschedule"> {
  const deliverable = await loadDeliverable(row);
  if (!deliverable || isTerminalDeliverableStatus(deliverable.status)) return "done";
  if (!deliverable.approvalInstanceId) {
    throw new Error("审批实例尚未关联，等待同步器建单后重试");
  }

  const detail = await getLoomTask(row.taskId);
  if (detail.awaiting_approval) {
    const decision = await runWithWorkspace(row.workspaceId, async (tx) =>
      readDeliverableGateDecision(tx, row.workspaceId, deliverable.approvalInstanceId!),
    );
    if (!decision) throw new Error("审批实例仍未决，等待审批人处理后重试");
    const released = await releaseDeliverableGate(row.taskId, decision);
    if (!released) throw new Error("sidecar 审批放行失败");
  }

  const synced = await syncDeliverableFromLoom({
    wid: row.workspaceId,
    userId: deliverable.createdBy,
    row: deliverable,
    source: "worker",
  });
  return isTerminalDeliverableStatus(synced.status) ? "done" : "reschedule";
}

/** 有界批处理。返回计数供 cron 路由与指标/日志使用。 */
export async function processDeliveryOutboxBatch(limit = 20): Promise<DeliveryOutboxBatchStats> {
  const stats: DeliveryOutboxBatchStats = {
    claimed: 0,
    completed: 0,
    rescheduled: 0,
    failed: 0,
    deadLetter: 0,
  };
  const boundedLimit = Math.max(1, Math.min(50, Math.trunc(limit)));

  for (let i = 0; i < boundedLimit; i++) {
    const row = await claimNextDeliveryOutbox();
    if (!row || !row.leaseUntil) break;
    stats.claimed++;
    try {
      const outcome = row.kind === "sync" ? await processSync(row) : await processDecision(row);
      if (outcome === "done") {
        await completeDeliveryOutbox(row.id, row.leaseUntil);
        stats.completed++;
      } else {
        await rescheduleDeliveryOutbox(
          row.id,
          row.leaseUntil,
          new Date(Date.now() + RESCHEDULE_MS),
        );
        stats.rescheduled++;
      }
    } catch (error) {
      await failDeliveryOutbox(row, error);
      stats.failed++;
      if (row.attempts + 1 >= DELIVERY_OUTBOX_MAX_ATTEMPTS) stats.deadLetter++;
    }
  }
  return stats;
}

/** cron 路由的并发保护：同一进程内不重叠跑批；跨进程靠条件认领防重。 */
let workerRunning = false;
export async function runDeliveryOutboxWorker(limit = 20): Promise<DeliveryOutboxBatchStats> {
  if (workerRunning) {
    return { claimed: 0, completed: 0, rescheduled: 0, failed: 0, deadLetter: 0 };
  }
  workerRunning = true;
  try {
    return await processDeliveryOutboxBatch(limit);
  } finally {
    workerRunning = false;
  }
}
