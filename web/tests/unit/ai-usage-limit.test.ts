import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

/**
 * AI 使用限额检查单元测试（lib/ai/usage-limit.ts）
 *
 * 覆盖：
 *  - checkAiUsageLimit：日/月 Token 限额 + 日/月调用次数限额检查，
 *    用户级限额优先 > 工作空间级默认限额回退 > 无限额放行，
 *    限额判定使用 >= 比较（刚好等于限额即拒绝）
 *  - getOrCreateDefaultLimit：已存在直接返回 / 不存在则创建 / P2002 竞态重新查找
 *
 * Mock 策略：vi.mock("@/lib/prisma") 替换 prisma client，不连接真实 DB。
 * P2002 错误用真实的 Prisma.PrismaClientKnownRequestError 构造，保证 instanceof 判定成立。
 */

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiUsageLimit: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    aiUsageLog: {
      aggregate: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import { checkAiUsageLimit, getOrCreateDefaultLimit } from "@/lib/ai/usage-limit";

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000002";

/** 构造 aggregate 返回值 */
function aggResult(sumTokens: number | null, count: number) {
  return { _sum: { totalTokens: sumTokens }, _count: count } as never;
}

/** 构造限额配置记录 */
function limitRecord(overrides: Partial<{
  id: string;
  workspaceId: string;
  userId: string | null;
  dailyTokenLimit: number | null;
  monthlyTokenLimit: number | null;
  dailyCallLimit: number | null;
  monthlyCallLimit: number | null;
}> = {}) {
  return {
    id: "limit-1",
    workspaceId: WORKSPACE_ID,
    userId: null,
    dailyTokenLimit: null,
    monthlyTokenLimit: null,
    dailyCallLimit: null,
    monthlyCallLimit: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(prisma.aiUsageLimit.findFirst).mockReset();
  vi.mocked(prisma.aiUsageLimit.create).mockReset();
  vi.mocked(prisma.aiUsageLog.aggregate).mockReset();
});

describe("checkAiUsageLimit - 无限额配置", () => {
  it("用户级与工作空间级限额均不存在时直接放行（ok: true）", async () => {
    // Arrange：两次 findFirst 都返回 null
    vi.mocked(prisma.aiUsageLimit.findFirst)
      .mockResolvedValueOnce(null as never) // 用户级
      .mockResolvedValueOnce(null as never); // 工作空间级

    // Act
    const result = await checkAiUsageLimit(USER_ID, WORKSPACE_ID);

    // Assert
    expect(result).toEqual({ ok: true });
    // 未调用 aggregate（无需查使用量）
    expect(prisma.aiUsageLog.aggregate).not.toHaveBeenCalled();
  });
});

describe("checkAiUsageLimit - 限额配置优先级", () => {
  it("用户级限额优先于工作空间级默认限额", async () => {
    // Arrange：用户级限额存在（日 Token 限额 10000）
    const userLimit = limitRecord({ userId: USER_ID, dailyTokenLimit: 10000 });
    vi.mocked(prisma.aiUsageLimit.findFirst).mockResolvedValueOnce(userLimit as never);
    // 今日使用 5000 token，未超限
    vi.mocked(prisma.aiUsageLog.aggregate)
      .mockResolvedValueOnce(aggResult(5000, 10)) // today
      .mockResolvedValueOnce(aggResult(50000, 100)); // month

    // Act
    const result = await checkAiUsageLimit(USER_ID, WORKSPACE_ID);

    // Assert
    expect(result.ok).toBe(true);
    // 第一次 findFirst 查用户级（where 含 userId）
    const firstCall = vi.mocked(prisma.aiUsageLimit.findFirst).mock.calls[0][0]!;
    expect(firstCall.where).toEqual({ workspaceId: WORKSPACE_ID, userId: USER_ID });
    // 不应调用第二次 findFirst（用户级命中后不再查工作空间级）
    expect(prisma.aiUsageLimit.findFirst).toHaveBeenCalledTimes(1);
  });

  it("用户级未命中时回退到工作空间级默认限额（userId=null）", async () => {
    // Arrange：用户级不存在，工作空间级存在
    vi.mocked(prisma.aiUsageLimit.findFirst)
      .mockResolvedValueOnce(null as never) // 用户级
      .mockResolvedValueOnce(limitRecord({ userId: null, dailyTokenLimit: 20000 }) as never);
    vi.mocked(prisma.aiUsageLog.aggregate)
      .mockResolvedValueOnce(aggResult(5000, 5))
      .mockResolvedValueOnce(aggResult(50000, 50));

    // Act
    const result = await checkAiUsageLimit(USER_ID, WORKSPACE_ID);

    // Assert
    expect(result.ok).toBe(true);
    // 第二次 findFirst 查工作空间级（where userId=null）
    const secondCall = vi.mocked(prisma.aiUsageLimit.findFirst).mock.calls[1][0]!;
    expect(secondCall.where).toEqual({ workspaceId: WORKSPACE_ID, userId: null });
  });
});

describe("checkAiUsageLimit - 日 Token 限额", () => {
  it("今日 token 用量未超限 → 放行", async () => {
    // Arrange
    vi.mocked(prisma.aiUsageLimit.findFirst).mockResolvedValueOnce(
      limitRecord({ dailyTokenLimit: 10000 }) as never,
    );
    vi.mocked(prisma.aiUsageLog.aggregate)
      .mockResolvedValueOnce(aggResult(9999, 5)) // today: 9999 < 10000
      .mockResolvedValueOnce(aggResult(50000, 50));

    // Act
    const result = await checkAiUsageLimit(USER_ID, WORKSPACE_ID);

    // Assert
    expect(result.ok).toBe(true);
  });

  it("今日 token 用量超限 → 拒绝并返回 reason 与 usagePercent", async () => {
    // Arrange
    vi.mocked(prisma.aiUsageLimit.findFirst).mockResolvedValueOnce(
      limitRecord({ dailyTokenLimit: 10000 }) as never,
    );
    vi.mocked(prisma.aiUsageLog.aggregate)
      .mockResolvedValueOnce(aggResult(15000, 5)) // today: 15000 > 10000
      .mockResolvedValueOnce(aggResult(50000, 50));

    // Act
    const result = await checkAiUsageLimit(USER_ID, WORKSPACE_ID);

    // Assert
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("Daily token limit exceeded");
    expect(result.usagePercent).toBe(1.5);
  });

  it("今日 token 用量刚好等于限额 → 拒绝（>= 比较）", async () => {
    // Arrange
    vi.mocked(prisma.aiUsageLimit.findFirst).mockResolvedValueOnce(
      limitRecord({ dailyTokenLimit: 10000 }) as never,
    );
    vi.mocked(prisma.aiUsageLog.aggregate)
      .mockResolvedValueOnce(aggResult(10000, 5)) // today: 10000 == 10000
      .mockResolvedValueOnce(aggResult(50000, 50));

    // Act
    const result = await checkAiUsageLimit(USER_ID, WORKSPACE_ID);

    // Assert
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("Daily token limit exceeded");
    expect(result.usagePercent).toBe(1);
  });
});

describe("checkAiUsageLimit - 月 Token 限额", () => {
  it("月 token 用量超限 → 拒绝", async () => {
    // Arrange：日未超限，月超限
    vi.mocked(prisma.aiUsageLimit.findFirst).mockResolvedValueOnce(
      limitRecord({ dailyTokenLimit: 100000, monthlyTokenLimit: 200000 }) as never,
    );
    vi.mocked(prisma.aiUsageLog.aggregate)
      .mockResolvedValueOnce(aggResult(50000, 5)) // today: 未超日限
      .mockResolvedValueOnce(aggResult(250000, 50)); // month: 250000 > 200000

    // Act
    const result = await checkAiUsageLimit(USER_ID, WORKSPACE_ID);

    // Assert
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("Monthly token limit exceeded");
    expect(result.usagePercent).toBe(1.25);
  });

  it("月 token 用量刚好等于限额 → 拒绝", async () => {
    vi.mocked(prisma.aiUsageLimit.findFirst).mockResolvedValueOnce(
      limitRecord({ monthlyTokenLimit: 200000 }) as never,
    );
    vi.mocked(prisma.aiUsageLog.aggregate)
      .mockResolvedValueOnce(aggResult(1000, 1))
      .mockResolvedValueOnce(aggResult(200000, 50));

    const result = await checkAiUsageLimit(USER_ID, WORKSPACE_ID);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("Monthly token limit exceeded");
  });
});

describe("checkAiUsageLimit - 日调用次数限额", () => {
  it("日调用次数未超限 → 放行", async () => {
    vi.mocked(prisma.aiUsageLimit.findFirst).mockResolvedValueOnce(
      limitRecord({ dailyCallLimit: 100 }) as never,
    );
    vi.mocked(prisma.aiUsageLog.aggregate)
      .mockResolvedValueOnce(aggResult(1000, 99)) // today: 99 < 100
      .mockResolvedValueOnce(aggResult(10000, 500));

    const result = await checkAiUsageLimit(USER_ID, WORKSPACE_ID);
    expect(result.ok).toBe(true);
  });

  it("日调用次数超限 → 拒绝", async () => {
    vi.mocked(prisma.aiUsageLimit.findFirst).mockResolvedValueOnce(
      limitRecord({ dailyCallLimit: 100 }) as never,
    );
    vi.mocked(prisma.aiUsageLog.aggregate)
      .mockResolvedValueOnce(aggResult(1000, 150)) // today: 150 > 100
      .mockResolvedValueOnce(aggResult(10000, 500));

    const result = await checkAiUsageLimit(USER_ID, WORKSPACE_ID);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("Daily call limit exceeded");
    expect(result.usagePercent).toBe(1.5);
  });

  it("日调用次数刚好等于限额 → 拒绝", async () => {
    vi.mocked(prisma.aiUsageLimit.findFirst).mockResolvedValueOnce(
      limitRecord({ dailyCallLimit: 100 }) as never,
    );
    vi.mocked(prisma.aiUsageLog.aggregate)
      .mockResolvedValueOnce(aggResult(1000, 100))
      .mockResolvedValueOnce(aggResult(10000, 500));

    const result = await checkAiUsageLimit(USER_ID, WORKSPACE_ID);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("Daily call limit exceeded");
  });
});

describe("checkAiUsageLimit - 月调用次数限额", () => {
  it("月调用次数超限 → 拒绝", async () => {
    vi.mocked(prisma.aiUsageLimit.findFirst).mockResolvedValueOnce(
      limitRecord({ monthlyCallLimit: 1000 }) as never,
    );
    vi.mocked(prisma.aiUsageLog.aggregate)
      .mockResolvedValueOnce(aggResult(1000, 10)) // today: 未超
      .mockResolvedValueOnce(aggResult(10000, 1200)); // month: 1200 > 1000

    const result = await checkAiUsageLimit(USER_ID, WORKSPACE_ID);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("Monthly call limit exceeded");
    expect(result.usagePercent).toBe(1.2);
  });

  it("月调用次数刚好等于限额 → 拒绝", async () => {
    vi.mocked(prisma.aiUsageLimit.findFirst).mockResolvedValueOnce(
      limitRecord({ monthlyCallLimit: 1000 }) as never,
    );
    vi.mocked(prisma.aiUsageLog.aggregate)
      .mockResolvedValueOnce(aggResult(1000, 10))
      .mockResolvedValueOnce(aggResult(10000, 1000));

    const result = await checkAiUsageLimit(USER_ID, WORKSPACE_ID);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("Monthly call limit exceeded");
  });
});

describe("checkAiUsageLimit - 限额检查优先级顺序", () => {
  it("日 Token 超限优先于月 Token 超限返回", async () => {
    // Arrange：日和月都超限，应先返回日 Token 超限
    vi.mocked(prisma.aiUsageLimit.findFirst).mockResolvedValueOnce(
      limitRecord({ dailyTokenLimit: 1000, monthlyTokenLimit: 10000 }) as never,
    );
    vi.mocked(prisma.aiUsageLog.aggregate)
      .mockResolvedValueOnce(aggResult(2000, 5)) // today: 2000 > 1000
      .mockResolvedValueOnce(aggResult(20000, 50)); // month: 20000 > 10000

    // Act
    const result = await checkAiUsageLimit(USER_ID, WORKSPACE_ID);

    // Assert：先命中日 Token 超限
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("Daily token limit exceeded");
  });

  it("所有限额均未超限时放行", async () => {
    vi.mocked(prisma.aiUsageLimit.findFirst).mockResolvedValueOnce(
      limitRecord({
        dailyTokenLimit: 100000,
        monthlyTokenLimit: 1000000,
        dailyCallLimit: 1000,
        monthlyCallLimit: 10000,
      }) as never,
    );
    vi.mocked(prisma.aiUsageLog.aggregate)
      .mockResolvedValueOnce(aggResult(50000, 100))
      .mockResolvedValueOnce(aggResult(500000, 5000));

    const result = await checkAiUsageLimit(USER_ID, WORKSPACE_ID);
    expect(result.ok).toBe(true);
  });

  it("限额字段为 null 时不检查该维度（放行）", async () => {
    // Arrange：所有限额字段为 null（相当于未配置限额维度）
    vi.mocked(prisma.aiUsageLimit.findFirst).mockResolvedValueOnce(
      limitRecord({
        dailyTokenLimit: null,
        monthlyTokenLimit: null,
        dailyCallLimit: null,
        monthlyCallLimit: null,
      }) as never,
    );
    vi.mocked(prisma.aiUsageLog.aggregate)
      .mockResolvedValueOnce(aggResult(999999, 9999))
      .mockResolvedValueOnce(aggResult(9999999, 99999));

    // Act
    const result = await checkAiUsageLimit(USER_ID, WORKSPACE_ID);

    // Assert：所有维度未配置限额，放行
    expect(result.ok).toBe(true);
  });
});

describe("checkAiUsageLimit - aggregate _sum.totalTokens 为 null", () => {
  it("今日无使用记录时 _sum.totalTokens=null 按 0 处理", async () => {
    vi.mocked(prisma.aiUsageLimit.findFirst).mockResolvedValueOnce(
      limitRecord({ dailyTokenLimit: 1000 }) as never,
    );
    vi.mocked(prisma.aiUsageLog.aggregate)
      .mockResolvedValueOnce(aggResult(null, 0)) // today: 无记录
      .mockResolvedValueOnce(aggResult(null, 0)); // month: 无记录

    const result = await checkAiUsageLimit(USER_ID, WORKSPACE_ID);
    expect(result.ok).toBe(true);
  });
});

describe("getOrCreateDefaultLimit - 获取或创建默认限额", () => {
  it("已存在工作空间级默认限额时直接返回", async () => {
    // Arrange
    const existing = limitRecord({ userId: null, dailyTokenLimit: 50000 });
    vi.mocked(prisma.aiUsageLimit.findFirst).mockResolvedValue(existing as never);

    // Act
    const result = await getOrCreateDefaultLimit(WORKSPACE_ID);

    // Assert
    expect(result).toEqual(existing);
    expect(prisma.aiUsageLimit.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.aiUsageLimit.create).not.toHaveBeenCalled();
    // 查询条件：userId=null（工作空间级默认）
    const arg = vi.mocked(prisma.aiUsageLimit.findFirst).mock.calls[0][0]!;
    expect(arg.where).toEqual({ workspaceId: WORKSPACE_ID, userId: null });
  });

  it("不存在时创建工作空间级默认限额（userId=null）", async () => {
    // Arrange：首次查找返回 null
    vi.mocked(prisma.aiUsageLimit.findFirst).mockResolvedValue(null as never);
    const created = limitRecord({ userId: null });
    vi.mocked(prisma.aiUsageLimit.create).mockResolvedValue(created as never);

    // Act
    const result = await getOrCreateDefaultLimit(WORKSPACE_ID);

    // Assert
    expect(result).toEqual(created);
    expect(prisma.aiUsageLimit.create).toHaveBeenCalledTimes(1);
    const createArg = vi.mocked(prisma.aiUsageLimit.create).mock.calls[0][0]!;
    expect(createArg.data).toEqual({ workspaceId: WORKSPACE_ID, userId: null });
  });
});

describe("getOrCreateDefaultLimit - P2002 竞态处理", () => {
  it("create 抛 P2002 时重新 findFirst 返回已创建的记录", async () => {
    // Arrange：首次查找 null（并发下另一请求已创建）
    // create 抛 P2002，再次查找返回已存在记录
    const raceExisting = limitRecord({ userId: null, dailyTokenLimit: 30000 });
    vi.mocked(prisma.aiUsageLimit.findFirst)
      .mockResolvedValueOnce(null as never) // 首次查找：不存在
      .mockResolvedValueOnce(raceExisting as never); // P2002 后重新查找：已存在
    const p2002 = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the fields: (workspace_id, user_id)",
      { code: "P2002", clientVersion: "6.15.0" },
    );
    vi.mocked(prisma.aiUsageLimit.create).mockRejectedValue(p2002);

    // Act
    const result = await getOrCreateDefaultLimit(WORKSPACE_ID);

    // Assert
    expect(result).toEqual(raceExisting);
    expect(prisma.aiUsageLimit.findFirst).toHaveBeenCalledTimes(2);
    expect(prisma.aiUsageLimit.create).toHaveBeenCalledTimes(1);
  });

  it("create 抛 P2002 但重新查找仍为 null 时向上抛出原异常", async () => {
    // Arrange：极端情况——P2002 后重新查找仍返回 null（记录被并发删除）
    vi.mocked(prisma.aiUsageLimit.findFirst)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never);
    const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "6.15.0",
    });
    vi.mocked(prisma.aiUsageLimit.create).mockRejectedValue(p2002);

    // Act & Assert：重新查找仍为 null → throw createError（P2002）
    await expect(getOrCreateDefaultLimit(WORKSPACE_ID)).rejects.toThrow(p2002);
  });

  it("create 抛非 P2002 错误时直接向上抛出（不重试查找）", async () => {
    // Arrange
    vi.mocked(prisma.aiUsageLimit.findFirst).mockResolvedValue(null as never);
    const otherError = new Error("Connection lost");
    vi.mocked(prisma.aiUsageLimit.create).mockRejectedValue(otherError);

    // Act & Assert
    await expect(getOrCreateDefaultLimit(WORKSPACE_ID)).rejects.toThrow("Connection lost");
    // 不应再次调用 findFirst（仅首次查找一次）
    expect(prisma.aiUsageLimit.findFirst).toHaveBeenCalledTimes(1);
  });

  it("create 抛 P2003（非 P2002 的已知错误）时直接向上抛出", async () => {
    // Arrange：P2003 是其他已知错误，不应触发竞态重试
    vi.mocked(prisma.aiUsageLimit.findFirst).mockResolvedValue(null as never);
    const p2003 = new Prisma.PrismaClientKnownRequestError("Referential integrity violation", {
      code: "P2003",
      clientVersion: "6.15.0",
    });
    vi.mocked(prisma.aiUsageLimit.create).mockRejectedValue(p2003);

    // Act & Assert
    await expect(getOrCreateDefaultLimit(WORKSPACE_ID)).rejects.toThrow(p2003);
    expect(prisma.aiUsageLimit.findFirst).toHaveBeenCalledTimes(1);
  });
});