/**
 * AI 使用限额检查（方向 G）
 *
 * 设计要点：
 *  - 限额配置优先级：用户级（userId 命中）> 工作空间级默认（userId = null）
 *  - 限额维度：日/月 Token 限额 + 日/月调用次数限额
 *  - 无限额配置时直接放行（ok: true），不强制要求配置
 *  - 限额判定使用 >= 比较：当前已用量达到限额即拒绝新调用
 *
 * 注意：本函数仅做"是否超限"判定，不原子地占用配额（无 INCR）。
 * 在高并发场景下可能出现轻微超限（多请求同时通过检查后各自写入），
 * 对 AI 调用配额场景可接受——精确配额需引入 Redis 原子计数，暂不在范围内。
 *
 * 来源：方向 G 任务 2（usage-limit.ts）
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

/** 限额检查结果 */
export interface UsageLimitCheckResult {
  ok: boolean;
  /** 超限原因（ok=false 时填充） */
  reason?: string;
  /** 已用 Token / 限额（0-1+，超限时可大于 1） */
  usagePercent?: number;
}

/**
 * 检查 AI 使用限额。
 *
 * 优先检查用户级限额（userId 命中），未命中则回退到工作空间级默认限额
 * （userId = null）。两者都不存在时直接放行。
 *
 * @param userId  当前用户 ID
 * @param workspaceId  工作区 ID
 */
export async function checkAiUsageLimit(
  userId: string,
  workspaceId: string,
): Promise<UsageLimitCheckResult> {
  // 获取限额配置：优先用户级，回退工作空间级
  const limit =
    (await prisma.aiUsageLimit.findFirst({
      where: { workspaceId, userId },
    })) ??
    (await prisma.aiUsageLimit.findFirst({
      where: { workspaceId, userId: null },
    }));

  if (!limit) return { ok: true }; // 无限额配置，放行

  // 计算今日和本月使用量
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [todayUsage, monthUsage] = await Promise.all([
    prisma.aiUsageLog.aggregate({
      where: { workspaceId, userId, createdAt: { gte: todayStart } },
      _sum: { totalTokens: true },
      _count: true,
    }),
    prisma.aiUsageLog.aggregate({
      where: { workspaceId, userId, createdAt: { gte: monthStart } },
      _sum: { totalTokens: true },
      _count: true,
    }),
  ]);

  const todayTokens = todayUsage._sum.totalTokens ?? 0;
  const todayCalls = todayUsage._count;
  const monthTokens = monthUsage._sum.totalTokens ?? 0;
  const monthCalls = monthUsage._count;

  // 检查日 Token 限额
  if (limit.dailyTokenLimit && todayTokens >= limit.dailyTokenLimit) {
    return {
      ok: false,
      reason: "Daily token limit exceeded",
      usagePercent: todayTokens / limit.dailyTokenLimit,
    };
  }
  // 检查月 Token 限额
  if (limit.monthlyTokenLimit && monthTokens >= limit.monthlyTokenLimit) {
    return {
      ok: false,
      reason: "Monthly token limit exceeded",
      usagePercent: monthTokens / limit.monthlyTokenLimit,
    };
  }
  // 检查日调用次数限额
  if (limit.dailyCallLimit && todayCalls >= limit.dailyCallLimit) {
    return {
      ok: false,
      reason: "Daily call limit exceeded",
      usagePercent: todayCalls / limit.dailyCallLimit,
    };
  }
  // 检查月调用次数限额
  if (limit.monthlyCallLimit && monthCalls >= limit.monthlyCallLimit) {
    return {
      ok: false,
      reason: "Monthly call limit exceeded",
      usagePercent: monthCalls / limit.monthlyCallLimit,
    };
  }

  return { ok: true };
}

/**
 * 获取或创建工作空间级默认限额配置（userId = null）。
 *
 * 用于首次访问限额设置页面时确保有一条记录可编辑。
 * 不创建用户级限额——用户级限额由管理员显式设置。
 */
export async function getOrCreateDefaultLimit(workspaceId: string) {
  const existing = await prisma.aiUsageLimit.findFirst({
    where: { workspaceId, userId: null },
  });
  if (existing) return existing;

  // P1-2：捕获唯一约束冲突后重新 findFirst
  try {
    return await prisma.aiUsageLimit.create({
      data: { workspaceId, userId: null },
    });
  } catch (createError) {
    if (
      createError instanceof Prisma.PrismaClientKnownRequestError &&
      createError.code === "P2002"
    ) {
      // 并发下另一请求已创建同一记录，重新查找
      const raceExisting = await prisma.aiUsageLimit.findFirst({
        where: { workspaceId, userId: null },
      });
      if (raceExisting) return raceExisting;
    }
    throw createError;
  }
}