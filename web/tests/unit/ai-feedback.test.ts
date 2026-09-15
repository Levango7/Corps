import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

/**
 * AI 反馈循环模块单元测试（lib/ai/feedback.ts）
 *
 * 覆盖：
 *  - submitFeedback：持久化反馈（验证写入字段映射）
 *  - getFeedbackExamples：正面反馈 few-shot 查询（验证 where/select/orderBy/take，
 *    以及 tx 事务客户端优先 / 全局 prisma 回退）
 *  - getFeedbackStats：反馈统计（positive/negative/total/satisfactionRate，
 *    capability 过滤、空数据兜底、tx 优先）
 *
 * Mock 策略：vi.mock("@/lib/prisma") 替换 prisma client，不连接真实 DB。
 */

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiFeedback: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  submitFeedback,
  getFeedbackExamples,
  getFeedbackStats,
} from "@/lib/ai/feedback";

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000002";
const OTHER_WORKSPACE_ID = "00000000-0000-4000-8000-000000000003";

beforeEach(() => {
  vi.mocked(prisma.aiFeedback.create).mockReset();
  vi.mocked(prisma.aiFeedback.findMany).mockReset();
  vi.mocked(prisma.aiFeedback.count).mockReset();
});

describe("submitFeedback - 提交反馈", () => {
  it("将 positive 反馈写入 AiFeedback 并返回记录", async () => {
    // Arrange
    const mockRecord = {
      id: "fb-1",
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      capability: "task-breakdown",
      rating: "positive",
      comment: null,
      originalOutput: null,
      correctedOutput: null,
      metadata: null,
      createdAt: new Date(),
    };
    vi.mocked(prisma.aiFeedback.create).mockResolvedValue(mockRecord as never);

    // Act
    const result = await submitFeedback({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      capability: "task-breakdown",
      rating: "positive",
    });

    // Assert
    expect(result).toEqual(mockRecord);
    expect(prisma.aiFeedback.create).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(prisma.aiFeedback.create).mock.calls[0][0]!;
    expect(arg.data).toMatchObject({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      capability: "task-breakdown",
      rating: "positive",
      comment: undefined,
      originalOutput: undefined,
      correctedOutput: undefined,
      metadata: undefined,
    });
  });

  it("写入 negative 反馈带 comment / originalOutput / correctedOutput / metadata", async () => {
    // Arrange
    vi.mocked(prisma.aiFeedback.create).mockResolvedValue({ id: "fb-2" } as never);
    const originalOutput = { text: "AI 原始回答" } as Prisma.InputJsonValue;
    const correctedOutput = { text: "用户修正后的回答" } as Prisma.InputJsonValue;
    const metadata = { messageId: "msg-1" } as Prisma.InputJsonValue;

    // Act
    await submitFeedback({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      capability: "knowledge-qa",
      rating: "negative",
      comment: "回答不够准确",
      originalOutput,
      correctedOutput,
      metadata,
    });

    // Assert
    const arg = vi.mocked(prisma.aiFeedback.create).mock.calls[0][0]!;
    expect(arg.data).toMatchObject({
      rating: "negative",
      comment: "回答不够准确",
      originalOutput,
      correctedOutput,
      metadata,
    });
  });

  it("不同 workspaceId 隔离：写入时 where 携带各自 workspaceId", async () => {
    // Arrange
    vi.mocked(prisma.aiFeedback.create).mockResolvedValue({ id: "fb-3" } as never);

    // Act
    await submitFeedback({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      capability: "task-breakdown",
      rating: "positive",
    });
    await submitFeedback({
      workspaceId: OTHER_WORKSPACE_ID,
      userId: USER_ID,
      capability: "task-breakdown",
      rating: "positive",
    });

    // Assert
    const call1 = vi.mocked(prisma.aiFeedback.create).mock.calls[0][0]!;
    const call2 = vi.mocked(prisma.aiFeedback.create).mock.calls[1][0]!;
    expect(call1.data.workspaceId).toBe(WORKSPACE_ID);
    expect(call2.data.workspaceId).toBe(OTHER_WORKSPACE_ID);
  });

  it("capability 为空字符串时仍透传（不做校验，由 DB 约束兜底）", async () => {
    // Arrange
    vi.mocked(prisma.aiFeedback.create).mockResolvedValue({ id: "fb-4" } as never);

    // Act
    await submitFeedback({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      capability: "",
      rating: "positive",
    });

    // Assert
    const arg = vi.mocked(prisma.aiFeedback.create).mock.calls[0][0]!;
    expect(arg.data.capability).toBe("");
  });
});

describe("getFeedbackExamples - 获取正面反馈 few-shot 示例", () => {
  it("查询条件包含 workspaceId / capability / rating=positive 且过滤 DbNull 与 JsonNull", async () => {
    // Arrange
    const examples = [
      {
        originalOutput: { text: "原" },
        correctedOutput: { text: "修正" },
        comment: "好",
      },
    ];
    vi.mocked(prisma.aiFeedback.findMany).mockResolvedValue(examples as never);

    // Act
    const result = await getFeedbackExamples(WORKSPACE_ID, "task-breakdown");

    // Assert
    expect(result).toEqual(examples);
    const arg = vi.mocked(prisma.aiFeedback.findMany).mock.calls[0][0]!;
    expect(arg.where).toMatchObject({
      workspaceId: WORKSPACE_ID,
      capability: "task-breakdown",
      rating: "positive",
    });
    // AND 过滤排除 DbNull 与 JsonNull
    expect(arg.where!.AND).toEqual([
      { correctedOutput: { not: Prisma.DbNull } },
      { correctedOutput: { not: Prisma.JsonNull } },
    ]);
  });

  it("select 仅包含 originalOutput / correctedOutput / comment", async () => {
    // Arrange
    vi.mocked(prisma.aiFeedback.findMany).mockResolvedValue([] as never);

    // Act
    await getFeedbackExamples(WORKSPACE_ID, "task-breakdown");

    // Assert
    const arg = vi.mocked(prisma.aiFeedback.findMany).mock.calls[0][0]!;
    expect(arg.select).toEqual({
      originalOutput: true,
      correctedOutput: true,
      comment: true,
    });
  });

  it("orderBy createdAt desc 且 take = limit（默认 3）", async () => {
    // Arrange
    vi.mocked(prisma.aiFeedback.findMany).mockResolvedValue([] as never);

    // Act
    await getFeedbackExamples(WORKSPACE_ID, "task-breakdown");

    // Assert
    const arg = vi.mocked(prisma.aiFeedback.findMany).mock.calls[0][0]!;
    expect(arg.orderBy).toEqual({ createdAt: "desc" });
    expect(arg.take).toBe(3);
  });

  it("自定义 limit 透传到 take", async () => {
    // Arrange
    vi.mocked(prisma.aiFeedback.findMany).mockResolvedValue([] as never);

    // Act
    await getFeedbackExamples(WORKSPACE_ID, "task-breakdown", 10);

    // Assert
    const arg = vi.mocked(prisma.aiFeedback.findMany).mock.calls[0][0]!;
    expect(arg.take).toBe(10);
  });

  it("传入 tx 时使用 tx 而非全局 prisma", async () => {
    // Arrange：构造 tx mock，不设置 prisma.findMany 的返回值
    // 若错误地走了 prisma 分支，prisma.findMany 未 mock 返回值会 reject
    const txExamples = [
      {
        originalOutput: { text: "tx 原" },
        correctedOutput: { text: "tx 修正" },
        comment: "tx",
      },
    ];
    const txFindMany = vi.fn().mockResolvedValue(txExamples as never);
    const tx = { aiFeedback: { findMany: txFindMany } } as unknown as Prisma.TransactionClient;

    // Act
    const result = await getFeedbackExamples(WORKSPACE_ID, "task-breakdown", 3, tx);

    // Assert
    expect(result).toEqual(txExamples);
    expect(txFindMany).toHaveBeenCalledTimes(1);
    expect(prisma.aiFeedback.findMany).not.toHaveBeenCalled();
  });

  it("不传 tx 时回退到全局 prisma", async () => {
    // Arrange
    vi.mocked(prisma.aiFeedback.findMany).mockResolvedValue([] as never);

    // Act
    await getFeedbackExamples(WORKSPACE_ID, "task-breakdown");

    // Assert
    expect(prisma.aiFeedback.findMany).toHaveBeenCalledTimes(1);
  });

  it("workspace 隔离：不同 workspaceId 传入不同 where", async () => {
    // Arrange
    vi.mocked(prisma.aiFeedback.findMany).mockResolvedValue([] as never);

    // Act
    await getFeedbackExamples(WORKSPACE_ID, "task-breakdown");
    await getFeedbackExamples(OTHER_WORKSPACE_ID, "task-breakdown");

    // Assert
    const call1 = vi.mocked(prisma.aiFeedback.findMany).mock.calls[0][0]!;
    const call2 = vi.mocked(prisma.aiFeedback.findMany).mock.calls[1][0]!;
    expect(call1.where!.workspaceId).toBe(WORKSPACE_ID);
    expect(call2.where!.workspaceId).toBe(OTHER_WORKSPACE_ID);
  });
});

describe("getFeedbackStats - 反馈统计", () => {
  it("返回 positive / negative / total / satisfactionRate", async () => {
    // Arrange：三次 count 分别返回 positive=7, negative=3, total=10
    vi.mocked(prisma.aiFeedback.count)
      .mockResolvedValueOnce(7 as never)
      .mockResolvedValueOnce(3 as never)
      .mockResolvedValueOnce(10 as never);

    // Act
    const stats = await getFeedbackStats(WORKSPACE_ID);

    // Assert
    expect(stats).toEqual({
      positive: 7,
      negative: 3,
      total: 10,
      satisfactionRate: 0.7,
    });
  });

  it("无数据时 satisfactionRate = 0（避免除零）", async () => {
    // Arrange
    vi.mocked(prisma.aiFeedback.count)
      .mockResolvedValueOnce(0 as never)
      .mockResolvedValueOnce(0 as never)
      .mockResolvedValueOnce(0 as never);

    // Act
    const stats = await getFeedbackStats(WORKSPACE_ID);

    // Assert
    expect(stats.total).toBe(0);
    expect(stats.satisfactionRate).toBe(0);
  });

  it("全部正面时 satisfactionRate = 1", async () => {
    // Arrange
    vi.mocked(prisma.aiFeedback.count)
      .mockResolvedValueOnce(5 as never)
      .mockResolvedValueOnce(0 as never)
      .mockResolvedValueOnce(5 as never);

    // Act
    const stats = await getFeedbackStats(WORKSPACE_ID);

    // Assert
    expect(stats.satisfactionRate).toBe(1);
  });

  it("传入 capability 时 where 包含 capability 过滤", async () => {
    // Arrange
    vi.mocked(prisma.aiFeedback.count)
      .mockResolvedValueOnce(2 as never)
      .mockResolvedValueOnce(1 as never)
      .mockResolvedValueOnce(3 as never);

    // Act
    await getFeedbackStats(WORKSPACE_ID, "task-breakdown");

    // Assert：三次 count 的 where 都应包含 capability
    const calls = vi.mocked(prisma.aiFeedback.count).mock.calls;
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call[0]!.where).toMatchObject({
        workspaceId: WORKSPACE_ID,
        capability: "task-breakdown",
      });
    }
    // positive count 带 rating: positive
    expect(calls[0][0]!.where).toMatchObject({ rating: "positive" });
    // negative count 带 rating: negative
    expect(calls[1][0]!.where).toMatchObject({ rating: "negative" });
    // total count 不带 rating
    expect(calls[2][0]!.where).not.toHaveProperty("rating");
  });

  it("不传 capability 时 where 仅含 workspaceId（统计整个工作区）", async () => {
    // Arrange
    vi.mocked(prisma.aiFeedback.count)
      .mockResolvedValueOnce(10 as never)
      .mockResolvedValueOnce(5 as never)
      .mockResolvedValueOnce(15 as never);

    // Act
    await getFeedbackStats(WORKSPACE_ID);

    // Assert
    const calls = vi.mocked(prisma.aiFeedback.count).mock.calls;
    for (const call of calls) {
      expect(call[0]!.where).toMatchObject({ workspaceId: WORKSPACE_ID });
      expect(call[0]!.where).not.toHaveProperty("capability");
    }
  });

  it("传入 tx 时使用 tx 而非全局 prisma", async () => {
    // Arrange
    const txCount = vi
      .fn()
      .mockResolvedValueOnce(4 as never)
      .mockResolvedValueOnce(1 as never)
      .mockResolvedValueOnce(5 as never);
    const tx = { aiFeedback: { count: txCount } } as unknown as Prisma.TransactionClient;

    // Act
    const stats = await getFeedbackStats(WORKSPACE_ID, undefined, tx);

    // Assert
    expect(stats).toEqual({
      positive: 4,
      negative: 1,
      total: 5,
      satisfactionRate: 0.8,
    });
    expect(txCount).toHaveBeenCalledTimes(3);
    expect(prisma.aiFeedback.count).not.toHaveBeenCalled();
  });

  it("workspace 隔离：不同 workspaceId 传入不同 where", async () => {
    // Arrange
    vi.mocked(prisma.aiFeedback.count).mockResolvedValue(0 as never);

    // Act
    await getFeedbackStats(WORKSPACE_ID);
    await getFeedbackStats(OTHER_WORKSPACE_ID);

    // Assert
    const calls = vi.mocked(prisma.aiFeedback.count).mock.calls;
    // 第一组 3 次
    expect(calls[0][0]!.where!.workspaceId).toBe(WORKSPACE_ID);
    // 第二组 3 次
    expect(calls[3][0]!.where!.workspaceId).toBe(OTHER_WORKSPACE_ID);
  });
});