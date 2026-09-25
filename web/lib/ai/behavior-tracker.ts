/**
 * 用户行为记录工具（方向 F）
 *
 * 设计要点：
 *  - recordBehavior：在 RLS 事务内记录用户行为（use_capability / accept_suggestion 等）
 *  - getUserBehaviors：查询用户行为历史，支持分页与 capability 过滤
 *  - getBehaviorStats：聚合统计各 capability 使用次数、接受率、拒绝率
 *
 * 所有查询均接受 tx（Prisma.TransactionClient）以在 RLS 事务内执行，
 * 保证行级安全策略生效。
 *
 * 来源：方向 F 任务 2（behavior-tracker.ts）
 */

import type { AiUserBehavior, Prisma } from "@prisma/client";

/** 合法行为类型 */
export type BehaviorAction =
  "use_capability" | "accept_suggestion" | "reject_suggestion" | "edit_output";

/** getUserBehaviors 查询选项 */
export interface GetBehaviorsOptions {
  /** 过滤特定能力 */
  capability?: string;
  /** 限制最近 N 条（默认 100，最大 500） */
  limit?: number;
  /** 起始时间过滤 */
  since?: Date;
}

/** getBehaviorStats 返回的单个能力统计 */
export interface CapabilityStat {
  /** 能力标识 */
  capability: string;
  /** 总使用次数（含所有 action） */
  total: number;
  /** use_capability 次数 */
  useCount: number;
  /** accept_suggestion 次数 */
  acceptCount: number;
  /** reject_suggestion 次数 */
  rejectCount: number;
  /** edit_output 次数 */
  editCount: number;
  /** 接受率（acceptCount / (acceptCount + rejectCount)，分母为 0 时为 0） */
  acceptRate: number;
  /** 拒绝率（rejectCount / (acceptCount + rejectCount)，分母为 0 时为 0） */
  rejectRate: number;
}

/** getBehaviorStats 返回结构 */
export interface BehaviorStats {
  /** 按能力分组的统计（按 total 降序） */
  capabilities: CapabilityStat[];
  /** 总行为数 */
  totalBehaviors: number;
  /** 涉及的能力数 */
  totalCapabilities: number;
}

/**
 * 记算接受率/拒绝率。
 *
 * 分母为 acceptCount + rejectCount（不含 use_capability / edit_output），
 * 分母为 0 时返回 0（避免除零）。
 */
function computeRates(
  acceptCount: number,
  rejectCount: number,
): {
  acceptRate: number;
  rejectRate: number;
} {
  const denom = acceptCount + rejectCount;
  if (denom === 0) return { acceptRate: 0, rejectRate: 0 };
  return {
    acceptRate: acceptCount / denom,
    rejectRate: rejectCount / denom,
  };
}

/**
 * 记算分页 limit，限制在 [1, 500] 范围内。
 */
function resolveLimit(limit?: number): number {
  if (!limit || limit < 1) return 100;
  return Math.min(limit, 500);
}

/**
 * 记算用户行为记录到 AiUserBehavior。
 *
 * 在 RLS 事务内调用，保证 workspaceId + userId 行级安全策略生效。
 *
 * @param tx Prisma 事务客户端（由 runWithWorkspace 提供）
 * @param workspaceId 工作区 ID
 * @param userId 用户 ID
 * @param action 行为类型（use_capability / accept_suggestion 等）
 * @param capability AI 能力标识（如 "knowledge-qa" / "task-breakdown"）
 * @param metadata 可选附加元数据（如 { suggestionId, output }）
 */
export async function recordBehavior(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  userId: string,
  action: BehaviorAction | string,
  capability: string,
  metadata?: Prisma.InputJsonValue,
): Promise<void> {
  await tx.aiUserBehavior.create({
    data: {
      workspaceId,
      userId,
      action,
      capability,
      metadata,
    },
  });
}

/**
 * 查询用户行为历史。
 *
 * 在 RLS 事务内调用，返回按时间倒序排列的行为列表。
 *
 * @param tx Prisma 事务客户端
 * @param userId 用户 ID
 * @param options 查询选项（capability 过滤、limit、since）
 */
export async function getUserBehaviors(
  tx: Prisma.TransactionClient,
  userId: string,
  options?: GetBehaviorsOptions,
): Promise<AiUserBehavior[]> {
  const limit = resolveLimit(options?.limit);
  const where: Prisma.AiUserBehaviorWhereInput = { userId };
  if (options?.capability) where.capability = options.capability;
  if (options?.since) where.createdAt = { gte: options.since };

  return tx.aiUserBehavior.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/**
 * 统计用户行为：各 capability 使用次数、接受率、拒绝率。
 *
 * 在 RLS 事务内调用，按 total 降序返回。
 *
 * @param tx Prisma 事务客户端
 * @param userId 用户 ID
 */
export async function getBehaviorStats(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<BehaviorStats> {
  // 拉取用户全部行为（限制 1000 条避免内存溢出，足够统计近期模式）
  const behaviors = await tx.aiUserBehavior.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 1000,
    select: { capability: true, action: true },
  });

  // 按 capability 聚合
  const statsMap = new Map<
    string,
    {
      useCount: number;
      acceptCount: number;
      rejectCount: number;
      editCount: number;
    }
  >();

  for (const b of behaviors) {
    let stat = statsMap.get(b.capability);
    if (!stat) {
      stat = { useCount: 0, acceptCount: 0, rejectCount: 0, editCount: 0 };
      statsMap.set(b.capability, stat);
    }
    switch (b.action) {
      case "use_capability":
        stat.useCount += 1;
        break;
      case "accept_suggestion":
        stat.acceptCount += 1;
        break;
      case "reject_suggestion":
        stat.rejectCount += 1;
        break;
      case "edit_output":
        stat.editCount += 1;
        break;
      // 未知 action 不计入分项统计，但 total 会包含
    }
  }

  // 转换为 CapabilityStat[] 并按 total 降序
  const capabilities: CapabilityStat[] = [...statsMap.entries()]
    .map(([capability, stat]) => {
      const total = stat.useCount + stat.acceptCount + stat.rejectCount + stat.editCount;
      const { acceptRate, rejectRate } = computeRates(stat.acceptCount, stat.rejectCount);
      return {
        capability,
        total,
        useCount: stat.useCount,
        acceptCount: stat.acceptCount,
        rejectCount: stat.rejectCount,
        editCount: stat.editCount,
        acceptRate,
        rejectRate,
      };
    })
    .sort((a, b) => b.total - a.total);

  return {
    capabilities,
    totalBehaviors: behaviors.length,
    totalCapabilities: capabilities.length,
  };
}
