/**
 * 交付物审批联动 — corps approvals 引擎终态回写 Deliverable.approvalStatus
 *
 * 两类实例共用同一回写：
 *  - entityType="deliverable"：交付完成后的验收（submit-approval 创建）；
 *  - entityType="deliverable_gate"：docgen-review 产出前的人审闸门。
 *
 * 当 ApprovalInstance 到达终态（approved/rejected）时，把审批结论写回
 * 交付物记录（approvalStatus/approvedBy/approvedAt/approvalNote）。
 * 对闸门实例额外返回 sidecar taskId，供调用方放行/驳回运行。
 * 幂等：已写过的结论不重复覆盖（重复审批由实例状态 409 拦截）。
 */

import type { Prisma } from "@prisma/client";
import { DELIVERABLE_GATE_ENTITY } from "./deliverable-gate";
import { enqueueDeliveryOutbox } from "@/lib/delivery/outbox";

type Tx = Prisma.TransactionClient;

const DELIVERABLE_ENTITY_TYPES = new Set(["deliverable", DELIVERABLE_GATE_ENTITY]);

interface DeliverableLinkedInstance {
  workspaceId: string;
  entityType: string | null;
  entityId: string | null;
  status: string;
  title: string;
  content?: unknown;
}

export interface DeliverableLinkResult {
  /** 闸门实例关联的 sidecar 任务 id；非闸门实例为 null */
  gateTaskId: string | null;
}

/** 从审批实例快照里取 sidecar taskId（只认字符串；其他形状视为缺失） */
function gateTaskIdOf(instance: DeliverableLinkedInstance): string | null {
  if (instance.entityType !== DELIVERABLE_GATE_ENTITY) return null;
  if (!instance.content || typeof instance.content !== "object") return null;
  const taskId = (instance.content as Record<string, unknown>).taskId;
  return typeof taskId === "string" && taskId.length > 0 ? taskId : null;
}

/**
 * 审批实例终态回写交付物。
 * @param tx 事务客户端（调用方已在 runWithWorkspace 作用域内）
 * @param instance 刚完成状态推进的审批实例（含 entityType/entityId/status/content）
 * @param operatorId 执行审批操作的用户（approvedBy 取值）
 * @param comment 审批备注（驳回原因写入 approvalNote）
 */
export async function syncDeliverableApproval(
  tx: Tx,
  instance: DeliverableLinkedInstance,
  operatorId: string,
  comment?: string,
): Promise<DeliverableLinkResult> {
  if (
    !instance.entityType ||
    !DELIVERABLE_ENTITY_TYPES.has(instance.entityType) ||
    !instance.entityId
  ) {
    return { gateTaskId: null };
  }
  if (instance.status !== "approved" && instance.status !== "rejected") {
    return { gateTaskId: null };
  }

  await tx.deliverable.update({
    where: { id: instance.entityId },
    data: {
      approvalStatus: instance.status,
      approvedBy: operatorId,
      approvedAt: new Date(),
      ...(comment ? { approvalNote: comment } : {}),
    },
  });

  const gateTaskId = gateTaskIdOf(instance);
  if (gateTaskId) {
    // 审批终态与 sidecar 执行意图同事务落库，后台 worker 负责重放。
    await enqueueDeliveryOutbox(tx, {
      workspaceId: instance.workspaceId,
      deliverableId: instance.entityId,
      taskId: gateTaskId,
      kind: instance.status === "approved" ? "approve" : "reject",
    });
  }
  return { gateTaskId };
}
