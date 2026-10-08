/**
 * AI 使用限额检查（方向 G）——2026-10-08 起为"真限额"：超限拦截 AI 调用。
 *
 * 设计要点：
 *  - 限额配置优先级：用户级（userId 命中）> 工作空间级默认（userId = null）
 *  - 限额维度：日/月 Token 限额 + 日/月调用次数限额
 *  - 无限额配置时直接放行（ok: true），不强制要求配置
 *  - 限额判定使用 >= 比较：当前已用量达到限额即拒绝新调用
 *
 * 2026-10-08（审计 P1 整改：限额从"提示不阻断"改为真拦截）：
 *  - 读取一律走 runWithWorkspace 注入 GUC——ai_usage_logs / ai_usage_limits 是
 *    FORCE RLS 表，裸 prisma 查询在加固模式（生产默认 RLS_ACTIVATE=true）下
 *    静默读空，限额将永不触发（记账写入侧的同类问题见 usage-tracker.ts）；
 *  - assertAiUsageQuota 供 AI 调用前断言，超限抛 AiQuotaExceededError，
 *    响应映射集中在 lib/ai/shared.ts 的 aiQuotaExceededResponse（429）；
 *  - 覆盖范围 = 接入计量的 AI 路由（withUsageTracking / createAiProgressStream），
 *    无工作区上下文的纯文本端点不在限额面内。
 *
 * 注意：判定与写入不构成原子占用（无 INCR）。高并发下可能出现轻微超限
 *（多请求同时通过检查后各自写入），对 AI 配额场景可接受——精确配额需引入
 * Redis 原子计数，暂不在范围内。
 *
 * 来源：方向 G 任务 2（usage-limit.ts）
 */

import { Prisma } from "@prisma/client";
import { runWithWorkspace } from "@/lib/auth";

/** 限额检查结果 */
export interface UsageLimitCheckResult {
  ok: boolean;
  /** 超限原因（ok=false 时填充） */
  reason?: string;
  /** 已用 Token / 限额（0-1+，超限时可大于 1） */
  usagePercent?: number;
}

type Tx = Prisma.TransactionClient;

/**
 * 纯判定（事务内版本）：读取必须发生在已注入 GUC 的事务上。
 *
 * 优先检查用户级限额（userId 命中），未命中则回退到工作空间级默认限额
 * （userId = null）。两者都不存在时直接放行。
 */
export async function checkAiUsageLimitTx(
  tx: Tx,
  userId: string,
  workspaceId: string,
): Promise<UsageLimitCheckResult> {
  // 获取限额配置：优先用户级，回退工作空间级
  const limit =
    (await tx.aiUsageLimit.findFirst({
      where: { workspaceId, userId },
    })) ??
    (await tx.aiUsageLimit.findFirst({
      where: { workspaceId, userId: null },
    }));

  if (!limit) return { ok: true }; // 无限额配置，放行

  // 计算今日和本月使用量
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [todayUsage, monthUsage] = await Promise.all([
    tx.aiUsageLog.aggregate({
      where: { workspaceId, userId, createdAt: { gte: todayStart } },
      _sum: { totalTokens: true },
      _count: true,
    }),
    tx.aiUsageLog.aggregate({
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
 * 检查 AI 使用限额（生产入口）。
 *
 * 自建 GUC 事务后走 checkAiUsageLimitTx——加固模式下裸查询读空会让限额
 * 静默失效，故此处不允许调用方传入全局 prisma。
 *
 * @param userId  当前用户 ID
 * @param workspaceId  工作区 ID
 */
export async function checkAiUsageLimit(
  userId: string,
  workspaceId: string,
): Promise<UsageLimitCheckResult> {
  return runWithWorkspace(
    workspaceId,
    (tx) => checkAiUsageLimitTx(tx, userId, workspaceId),
    userId,
  );
}

/** 配额超限错误：AI 调用前断言失败时抛出，由路由错误出口映射为 429 */
export class AiQuotaExceededError extends Error {
  readonly reason: string;
  readonly usagePercent?: number;

  constructor(result: UsageLimitCheckResult) {
    super(result.reason ?? "AI quota exceeded");
    this.name = "AiQuotaExceededError";
    this.reason = result.reason ?? "AI quota exceeded";
    this.usagePercent = result.usagePercent;
  }
}

/**
 * 断言配额未超限：超限即抛 AiQuotaExceededError。
 * 供 withUsageTracking / 流式路由在真正发起模型调用前调用。
 */
export async function assertAiUsageQuota(userId: string, workspaceId: string): Promise<void> {
  const check = await checkAiUsageLimit(userId, workspaceId);
  if (!check.ok) throw new AiQuotaExceededError(check);
}

/**
 * 获取或创建工作空间级默认限额配置（userId = null）。
 *
 * 用于首次访问限额设置页面时确保有一条记录可编辑。
 * 不创建用户级限额——用户级限额由管理员显式设置。
 */
export async function getOrCreateDefaultLimit(workspaceId: string) {
  return runWithWorkspace(workspaceId, async (tx) => {
    const existing = await tx.aiUsageLimit.findFirst({
      where: { workspaceId, userId: null },
    });
    if (existing) return existing;

    // P1-2：捕获唯一约束冲突后重新查找
    try {
      return await tx.aiUsageLimit.create({
        data: { workspaceId, userId: null },
      });
    } catch (createError) {
      if (
        createError instanceof Prisma.PrismaClientKnownRequestError &&
        createError.code === "P2002"
      ) {
        // 并发下另一请求已创建同一记录，重新查找
        const raceExisting = await tx.aiUsageLimit.findFirst({
          where: { workspaceId, userId: null },
        });
        if (raceExisting) return raceExisting;
      }
      throw createError;
    }
  });
}
