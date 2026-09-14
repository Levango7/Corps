/**
 * AI 结果反馈循环工具模块（方向 D）。
 *
 * 提供三个核心能力：
 *  - submitFeedback：持久化用户对 AI 输出的点赞/点踩/修正反馈
 *  - getFeedbackExamples：获取正面反馈作为 few-shot 示例，用于优化 prompt
 *  - getFeedbackStats：获取反馈统计（正面/负面/满意度）
 *
 * 设计要点：
 *  - getFeedbackExamples 支持传入 RLS 事务客户端 tx，在 context.ts 聚合
 *    上下文时复用同一事务，保证行级安全策略一致；独立调用时回退到全局 prisma。
 *  - correctedOutput 过滤同时排除 DbNull（未提供）和 JsonNull（JSON null），
 *    仅保留有实际修正内容的正面反馈。
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

/** 反馈评分类型 */
export type FeedbackRating = "positive" | "negative";

/** 反馈示例（few-shot）结构 — 与 AiFeedback 的 originalOutput/correctedOutput/comment 对应 */
export interface FeedbackExample {
  originalOutput: Prisma.JsonValue | null;
  correctedOutput: Prisma.JsonValue | null;
  comment: string | null;
}

/** 反馈统计结构 */
export interface FeedbackStats {
  positive: number;
  negative: number;
  total: number;
  /** 满意度比率 = positive / total，total 为 0 时为 0 */
  satisfactionRate: number;
}

/**
 * 提交 AI 结果反馈。
 *
 * @param params.workspaceId 工作区 ID
 * @param params.userId 用户 ID
 * @param params.capability AI 能力标识（如 "task-breakdown"）
 * @param params.rating 评分：positive（赞）或 negative（踩）
 * @param params.comment 可选修正反馈文本
 * @param params.originalOutput 可选原始 AI 输出
 * @param params.correctedOutput 可选用户修正后的输出
 * @param params.metadata 可选额外元数据（如 messageId, conversationId）
 */
export async function submitFeedback(params: {
  workspaceId: string;
  userId: string;
  capability: string;
  rating: FeedbackRating;
  comment?: string;
  originalOutput?: Prisma.InputJsonValue;
  correctedOutput?: Prisma.InputJsonValue;
  metadata?: Prisma.InputJsonValue;
}) {
  return prisma.aiFeedback.create({
    data: {
      workspaceId: params.workspaceId,
      userId: params.userId,
      capability: params.capability,
      rating: params.rating,
      comment: params.comment,
      originalOutput: params.originalOutput,
      correctedOutput: params.correctedOutput,
      metadata: params.metadata,
    },
  });
}

/**
 * 获取正面反馈作为 few-shot 示例（用于优化 prompt）。
 *
 * 只获取有 correctedOutput 的正面反馈（用户修正后的好结果），
 * 按 createdAt 降序取最近 limit 条。
 *
 * @param workspaceId 工作区 ID
 * @param capability AI 能力标识
 * @param limit 最大条数（默认 3）
 * @param tx 可选 RLS 事务客户端；提供时用 tx 查询（行级安全），
 *           不提供时回退到全局 prisma
 */
export async function getFeedbackExamples(
  workspaceId: string,
  capability: string,
  limit: number = 3,
  tx?: Prisma.TransactionClient,
): Promise<FeedbackExample[]> {
  const client = tx ?? prisma;
  return client.aiFeedback.findMany({
    where: {
      workspaceId,
      capability,
      rating: "positive",
      // 同时排除 DbNull（未提供 correctedOutput）和 JsonNull（JSON null 值），
      // 仅保留有实际修正内容的正面反馈
      AND: [
        { correctedOutput: { not: Prisma.DbNull } },
        { correctedOutput: { not: Prisma.JsonNull } },
      ],
    },
    select: {
      originalOutput: true,
      correctedOutput: true,
      comment: true,
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/**
 * 获取反馈统计。
 *
 * @param workspaceId 工作区 ID
 * @param capability 可选 AI 能力标识；提供时仅统计该能力，不提供时统计整个工作区
 * @param tx 可选 RLS 事务客户端；提供时用 tx 查询（行级安全），
 *           不提供时回退到全局 prisma
 * @returns 正面数、负面数、总数、满意度比率
 */
export async function getFeedbackStats(
  workspaceId: string,
  capability?: string,
  tx?: Prisma.TransactionClient,
): Promise<FeedbackStats> {
  const client = tx ?? prisma;
  const where = capability ? { workspaceId, capability } : { workspaceId };

  const [positive, negative, total] = await Promise.all([
    client.aiFeedback.count({ where: { ...where, rating: "positive" } }),
    client.aiFeedback.count({ where: { ...where, rating: "negative" } }),
    client.aiFeedback.count({ where }),
  ]);

  return {
    positive,
    negative,
    total,
    satisfactionRate: total > 0 ? positive / total : 0,
  };
}