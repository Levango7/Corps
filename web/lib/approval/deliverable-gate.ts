/**
 * 交付流水线人审闸门 ↔ corps approvals 引擎的桥接。
 *
 * docgen-review 流水线在产出前停在 sidecar 的 approval_gate（status=paused，
 * awaiting_approval 有值）。corps 轮询发现该状态时为交付物惰性创建一条
 * ApprovalInstance（entityType="deliverable_gate"），审批人仍在标准
 * approvals 页操作；审批终态由 approve/reject 路由回写并放行 sidecar。
 *
 * 与 deliverable-linkage 的分工：
 *  - 本模块负责“创建闸门实例”和“读取闸门终态”；
 *  - deliverable-linkage 负责把任一终态写回 Deliverable 字段。
 */

import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/** 闸门实例的 entityType（与交付后验收的 "deliverable" 区分） */
export const DELIVERABLE_GATE_ENTITY = "deliverable_gate";

export interface GateDeliverable {
  id: string;
  taskId: string;
  title: string;
  pipeline: string;
  outputPath: string | null;
  outputSummary: string | null;
  createdBy: string;
}

export interface GateDecision {
  status: "approved" | "rejected";
  comment: string;
}

/**
 * 惰性创建交付闸门审批实例并关联到 Deliverable。
 *
 * 并发保护：列表轮询与详情轮询可能同时发现 paused，事务级 advisory lock
 * 按交付物 id 串行化，后到者读到已有 approvalInstanceId 直接复用——
 * 同一次运行在审批收件箱里不会出现两条待办。
 */
export async function ensureDeliverableGateApproval(
  tx: Tx,
  wid: string,
  row: GateDeliverable,
): Promise<string> {
  const lockKey = `deliverable-gate:${row.id}`;
  // pg_advisory_xact_lock 返回 void；$queryRaw 会尝试反序列化该列并抛
  // "Failed to deserialize column of type 'void'"。$executeRaw 不读结果集，
  // 既能拿到同事务锁，又不会产生伪 running（2026-11-24 真链路实测）。
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

  const current = await tx.deliverable.findFirst({
    where: { id: row.id, workspaceId: wid },
    select: { approvalInstanceId: true },
  });
  if (current?.approvalInstanceId) return current.approvalInstanceId;

  let template = await tx.approvalTemplate.findFirst({
    where: { workspaceId: wid, name: "deliverable_review", active: true },
    select: { id: true },
  });
  if (!template) {
    template = await tx.approvalTemplate.create({
      data: {
        workspaceId: wid,
        name: "deliverable_review",
        description: "AI 交付物的质量验收（通过/驳回，单节点）",
        nodes: [{ approverRole: "owner", name: "交付验收", order: 0 }],
        flowType: "sequential",
        category: "deliverable",
        isBuiltin: false,
        createdBy: row.createdBy,
      },
      select: { id: true },
    });
  }

  const instance = await tx.approvalInstance.create({
    data: {
      workspaceId: wid,
      templateId: template.id,
      title: `交付前审批：${row.title}`,
      description: `AI 交付物（pipeline=${row.pipeline}，task=${row.taskId}）在产出前等待人工放行`,
      nodes: [{ approverRole: "owner", name: "交付验收", order: 0 }],
      content: {
        mode: "gate",
        deliverableId: row.id,
        taskId: row.taskId,
        outputPath: row.outputPath,
        summary: (row.outputSummary ?? "").slice(0, 500),
      },
      applicantId: row.createdBy,
      status: "pending",
      entityType: DELIVERABLE_GATE_ENTITY,
      entityId: row.id,
    },
    select: { id: true },
  });

  await tx.deliverable.update({
    where: { id: row.id },
    data: { approvalInstanceId: instance.id },
  });
  return instance.id;
}

/**
 * 读取闸门实例的终态（未决返回 null）。
 * note 取最后一条审批操作的 comment，用于放行/驳回时透传给 sidecar 审计。
 */
export async function readDeliverableGateDecision(
  tx: Tx,
  wid: string,
  instanceId: string,
): Promise<GateDecision | null> {
  const instance = await tx.approvalInstance.findFirst({
    where: {
      id: instanceId,
      workspaceId: wid,
      entityType: DELIVERABLE_GATE_ENTITY,
    },
    select: { status: true },
  });
  if (!instance) return null;
  if (instance.status !== "approved" && instance.status !== "rejected") return null;

  const lastOperation = await tx.approvalOperation.findFirst({
    where: { instanceId, action: instance.status },
    orderBy: { createdAt: "desc" },
    select: { comment: true },
  });
  return {
    status: instance.status,
    comment: lastOperation?.comment ?? "",
  };
}
