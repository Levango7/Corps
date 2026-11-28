/**
 * 交付任务状态同步：sidecar 详情 → corps 落库 → 人审闸门联动。
 *
 * 列表轮询与详情读取共用这一条路径（避免两处状态机漂移）：
 *  1. 拉 sidecar 详情；
 *  2. 若停在 approval 节点：惰性创建闸门 ApprovalInstance 并把展示态置为
 *     awaiting_approval；已有终态决策则写入 outbox，由后台 worker 放行；
 *  3. 其他状态原样回写（done/failed/cancelled/paused/running），UI 活跃任务
 *     同时补一条幂等同步意图，后续不依赖用户继续打开页面。
 */

import { runWithWorkspace } from "@/lib/auth";
import {
  approveLoomTask,
  getLoomPendingApproval,
  getLoomTask,
  rejectLoomTask,
  type LoomAwaitingApproval,
  type LoomTaskDetail,
} from "@/lib/ai/nexusloom";
import {
  ensureDeliverableGateApproval,
  readDeliverableGateDecision,
  type GateDecision,
} from "@/lib/approval/deliverable-gate";
import { enqueueDeliveryOutbox } from "@/lib/delivery/outbox";

export interface SyncableDeliverable {
  id: string;
  taskId: string;
  title: string;
  pipeline: string;
  status: string;
  outputPath: string | null;
  outputSummary: string | null;
  approvalInstanceId: string | null;
  createdBy: string;
}

export interface DeliverableSyncResult {
  detail: LoomTaskDetail;
  status: string;
  finishedAt: Date | null;
  outputPath: string | null;
  outputSummary: string | null;
  approvalInstanceId: string | null;
  awaitingApproval: LoomAwaitingApproval | null;
}

/** 终态（不再轮询 sidecar） */
export function isTerminalDeliverableStatus(status: string): boolean {
  return ["done", "completed", "failed", "error", "cancelled"].includes(status.toLowerCase());
}

/** 把审批终态转成 sidecar 决策；失败只记录，下一次轮询会重试 */
export async function releaseDeliverableGate(
  taskId: string,
  decision: GateDecision,
): Promise<boolean> {
  try {
    if (decision.status === "approved") {
      await approveLoomTask(taskId, decision.comment);
    } else {
      await rejectLoomTask(taskId, decision.comment);
    }
    return true;
  } catch (error) {
    console.error(
      `[deliverable-sync] 审批已记录但 sidecar 放行失败 task=${taskId} decision=${decision.status}:`,
      error,
    );
    return false;
  }
}

/**
 * 同步一条交付任务。调用方负责按 isTerminalDeliverableStatus 决定是否调用。
 * sidecar 不可达时抛出 LoomUnavailableError，由路由层映射 502/404。
 */
export async function syncDeliverableFromLoom(args: {
  wid: string;
  userId: string;
  row: SyncableDeliverable;
  /** UI 访问会补充后续同步意图；worker 自身处理时不重复自生产。 */
  source?: "ui" | "worker";
}): Promise<DeliverableSyncResult> {
  const { wid, userId, row, source = "ui" } = args;
  const detail = await getLoomTask(row.taskId);
  const awaiting = detail.awaiting_approval ?? null;
  // 独立 worker / 重启后的详情都来自 RunStore 投影：内存 awaiting 不在 API 进程，
  // 但持久待批仍在。普通任务的首次建单与灾后恢复必须共用这份事实。
  const persistedGate =
    !awaiting && !isTerminalDeliverableStatus(detail.status)
      ? await getLoomPendingApproval(row.taskId)
      : null;
  const gatePending =
    Boolean(awaiting || persistedGate) ||
    (detail.status === "paused" && Boolean(row.approvalInstanceId));
  const displayStatus = gatePending ? "awaiting_approval" : detail.status;

  const outcome = await runWithWorkspace(
    wid,
    async (tx) => {
      let approvalInstanceId = row.approvalInstanceId;

      // 内存 awaiting 与持久 pending 都是真实人审事实；仅 paused 投影不建单，
      // 避免把普通暂停误编成审批。
      if ((awaiting || persistedGate) && !approvalInstanceId) {
        approvalInstanceId = await ensureDeliverableGateApproval(tx, wid, {
          id: row.id,
          taskId: row.taskId,
          title: row.title,
          pipeline: row.pipeline,
          outputPath: detail.output_path ?? row.outputPath,
          outputSummary: (detail.output_content ?? "").slice(0, 2000) || row.outputSummary,
          createdBy: row.createdBy,
        });
      }

      // 已有终态而 sidecar 仍停在闸门：说明上次放行调用失败，读出来重试。
      const decision =
        gatePending && approvalInstanceId
          ? await readDeliverableGateDecision(tx, wid, approvalInstanceId)
          : null;

      const finishedAt = detail.finished_at ? new Date(detail.finished_at) : null;
      const outputPath = detail.output_path ?? row.outputPath;
      const outputSummary = (detail.output_content ?? "").slice(0, 2000) || row.outputSummary;

      await tx.deliverable.update({
        where: { id: row.id },
        data: {
          status: displayStatus,
          ...(finishedAt ? { finishedAt } : {}),
          ...(outputPath ? { outputPath } : {}),
          outputSummary,
        },
      });

      // 决策与后续同步都持久化为 outbox 意图，由后台 worker 执行。
      if (decision) {
        await enqueueDeliveryOutbox(tx, {
          workspaceId: wid,
          deliverableId: row.id,
          taskId: row.taskId,
          kind: decision.status === "approved" ? "approve" : "reject",
        });
      }
      if (source === "ui" && !isTerminalDeliverableStatus(displayStatus)) {
        await enqueueDeliveryOutbox(tx, {
          workspaceId: wid,
          deliverableId: row.id,
          taskId: row.taskId,
          kind: "sync",
        });
      }

      return { approvalInstanceId, decision };
    },
    userId,
  );

  return {
    detail,
    status: displayStatus,
    finishedAt: detail.finished_at ? new Date(detail.finished_at) : null,
    outputPath: detail.output_path ?? row.outputPath,
    outputSummary: (detail.output_content ?? "").slice(0, 2000) || row.outputSummary,
    approvalInstanceId: outcome.approvalInstanceId,
    awaitingApproval: awaiting ?? persistedGate,
  };
}
