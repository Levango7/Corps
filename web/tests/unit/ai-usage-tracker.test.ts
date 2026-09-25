import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * AI 使用量跟踪与成本估算是单元测试（lib/ai/usage-tracker.ts）
 *
 * 覆盖：
 *  - estimateCost：DeepSeek 定价计算（deepseek-chat / deepseek-reasoner / 未知模型回退）
 *  - recordAiUsage：写入 AiUsageLog（totalTokens 求和、cost 估算或显式透传、字段映射）
 *
 * Mock 策略：vi.mock("@/lib/prisma") 替换 prisma client，不连接真实 DB。
 * estimateCost 是纯函数，无需 mock。
 */

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiUsageLog: {
      create: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import { recordAiUsage, estimateCost } from "@/lib/ai/usage-tracker";

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000002";

beforeEach(() => {
  vi.mocked(prisma.aiUsageLog.create).mockReset();
});

describe("estimateCost - DeepSeek 定价计算", () => {
  it("deepseek-chat：输入 $0.14/1M + 输出 $0.28/1M", () => {
    // Arrange：1M input + 1M output
    const inputTokens = 1_000_000;
    const outputTokens = 1_000_000;

    // Act
    const cost = estimateCost("deepseek-chat", inputTokens, outputTokens);

    // Assert：0.14 + 0.28 = 0.42
    expect(cost).toBeCloseTo(0.42, 10);
  });

  it("deepseek-reasoner：输入 $0.55/1M + 输出 $2.19/1M", () => {
    // Arrange：1M input + 1M output
    const inputTokens = 1_000_000;
    const outputTokens = 1_000_000;

    // Act
    const cost = estimateCost("deepseek-reasoner", inputTokens, outputTokens);

    // Assert：0.55 + 2.19 = 2.74
    expect(cost).toBeCloseTo(2.74, 10);
  });

  it("deepseek-chat 仅输入 token 时只计输入费用", () => {
    const cost = estimateCost("deepseek-chat", 500_000, 0);
    expect(cost).toBeCloseTo(0.07, 10); // 0.5M * 0.14/1M = 0.07
  });

  it("deepseek-chat 仅输出 token 时只计输出费用", () => {
    const cost = estimateCost("deepseek-chat", 0, 500_000);
    expect(cost).toBeCloseTo(0.14, 10); // 0.5M * 0.28/1M = 0.14
  });

  it("deepseek-reasoner 输入单价高于 deepseek-chat", () => {
    const chatCost = estimateCost("deepseek-chat", 1_000_000, 0);
    const reasonerCost = estimateCost("deepseek-reasoner", 1_000_000, 0);
    expect(reasonerCost).toBeGreaterThan(chatCost);
  });

  it("deepseek-reasoner 输出单价高于 deepseek-chat", () => {
    const chatCost = estimateCost("deepseek-chat", 0, 1_000_000);
    const reasonerCost = estimateCost("deepseek-reasoner", 0, 1_000_000);
    expect(reasonerCost).toBeGreaterThan(chatCost);
  });

  it("未知模型回退到 deepseek-chat 费率（保守低估）", () => {
    const unknownCost = estimateCost("gpt-4", 1_000_000, 1_000_000);
    const chatCost = estimateCost("deepseek-chat", 1_000_000, 1_000_000);
    expect(unknownCost).toBe(chatCost);
  });

  it("空字符串模型名也回退到 deepseek-chat 费率", () => {
    const emptyCost = estimateCost("", 1_000_000, 1_000_000);
    const chatCost = estimateCost("deepseek-chat", 1_000_000, 1_000_000);
    expect(emptyCost).toBe(chatCost);
  });
});

describe("estimateCost - 边界", () => {
  it("零 token 时成本为 0", () => {
    expect(estimateCost("deepseek-chat", 0, 0)).toBe(0);
    expect(estimateCost("deepseek-reasoner", 0, 0)).toBe(0);
    expect(estimateCost("unknown-model", 0, 0)).toBe(0);
  });

  it("超大 token 数（1B）不溢出且成本线性增长", () => {
    // Arrange：1B = 1000 * 1M
    const huge = 1_000_000_000;
    const cost = estimateCost("deepseek-chat", huge, huge);
    // 1000 * 0.14 + 1000 * 0.28 = 420
    expect(cost).toBeCloseTo(420, 5);
    expect(Number.isFinite(cost)).toBe(true);
  });

  it("输入与输出 token 独立计价（不混淆单价）", () => {
    // deepseek-chat: input 2M, output 0 vs input 0, output 2M
    const inputOnly = estimateCost("deepseek-chat", 2_000_000, 0);
    const outputOnly = estimateCost("deepseek-chat", 0, 2_000_000);
    // input 2M * 0.14 = 0.28; output 2M * 0.28 = 0.56
    expect(inputOnly).toBeCloseTo(0.28, 10);
    expect(outputOnly).toBeCloseTo(0.56, 10);
    expect(outputOnly).toBeGreaterThan(inputOnly);
  });
});

describe("recordAiUsage - 记录 AI 调用使用量", () => {
  it("写入 AiUsageLog 并返回记录", async () => {
    // Arrange
    const mockRecord = {
      id: "log-1",
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      capability: "knowledge-qa",
      model: "deepseek-chat",
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      cost: 0.00028,
      durationMs: 1200,
      success: true,
    };
    vi.mocked(prisma.aiUsageLog.create).mockResolvedValue(mockRecord as never);

    // Act
    const result = await recordAiUsage({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      capability: "knowledge-qa",
      model: "deepseek-chat",
      inputTokens: 1000,
      outputTokens: 500,
      durationMs: 1200,
      success: true,
    });

    // Assert
    expect(result).toEqual(mockRecord);
    expect(prisma.aiUsageLog.create).toHaveBeenCalledTimes(1);
  });

  it("totalTokens = inputTokens + outputTokens", async () => {
    // Arrange
    vi.mocked(prisma.aiUsageLog.create).mockResolvedValue({} as never);

    // Act
    await recordAiUsage({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      capability: "knowledge-qa",
      model: "deepseek-chat",
      inputTokens: 3000,
      outputTokens: 2000,
      durationMs: 500,
      success: true,
    });

    // Assert
    const arg = vi.mocked(prisma.aiUsageLog.create).mock.calls[0][0];
    expect(arg.data.totalTokens).toBe(5000);
  });

  it("未传 cost 时按 estimateCost 估算", async () => {
    // Arrange
    vi.mocked(prisma.aiUsageLog.create).mockResolvedValue({} as never);

    // Act
    await recordAiUsage({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      capability: "knowledge-qa",
      model: "deepseek-chat",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      durationMs: 500,
      success: true,
    });

    // Assert：估算成本 = 0.14 + 0.28 = 0.42
    const arg = vi.mocked(prisma.aiUsageLog.create).mock.calls[0][0];
    expect(arg.data.cost).toBeCloseTo(0.42, 10);
  });

  it("显式传 cost 时透传不估算", async () => {
    // Arrange
    vi.mocked(prisma.aiUsageLog.create).mockResolvedValue({} as never);

    // Act
    await recordAiUsage({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      capability: "knowledge-qa",
      model: "deepseek-chat",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cost: 0.99,
      durationMs: 500,
      success: true,
    });

    // Assert
    const arg = vi.mocked(prisma.aiUsageLog.create).mock.calls[0][0];
    expect(arg.data.cost).toBe(0.99);
  });

  it("写入字段完整映射（workspaceId/userId/capability/model/tokens/duration/success）", async () => {
    // Arrange
    vi.mocked(prisma.aiUsageLog.create).mockResolvedValue({} as never);

    // Act
    await recordAiUsage({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      capability: "daily-report",
      model: "deepseek-reasoner",
      inputTokens: 200,
      outputTokens: 300,
      durationMs: 8000,
      success: false,
    });

    // Assert
    const arg = vi.mocked(prisma.aiUsageLog.create).mock.calls[0][0];
    expect(arg.data).toMatchObject({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      capability: "daily-report",
      model: "deepseek-reasoner",
      inputTokens: 200,
      outputTokens: 300,
      totalTokens: 500,
      durationMs: 8000,
      success: false,
    });
  });

  it("未知模型 cost 回退到 deepseek-chat 费率", async () => {
    // Arrange
    vi.mocked(prisma.aiUsageLog.create).mockResolvedValue({} as never);

    // Act
    await recordAiUsage({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      capability: "knowledge-qa",
      model: "unknown-model",
      inputTokens: 1_000_000,
      outputTokens: 0,
      durationMs: 100,
      success: true,
    });

    // Assert：回退到 deepseek-chat input 0.14/1M
    const arg = vi.mocked(prisma.aiUsageLog.create).mock.calls[0][0];
    expect(arg.data.cost).toBeCloseTo(0.14, 10);
  });
});

describe("recordAiUsage - 边界", () => {
  it("零 token 时 totalTokens=0 且 cost=0", async () => {
    // Arrange
    vi.mocked(prisma.aiUsageLog.create).mockResolvedValue({} as never);

    // Act
    await recordAiUsage({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      capability: "knowledge-qa",
      model: "deepseek-chat",
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
      success: true,
    });

    // Assert
    const arg = vi.mocked(prisma.aiUsageLog.create).mock.calls[0][0];
    expect(arg.data.totalTokens).toBe(0);
    expect(arg.data.cost).toBe(0);
  });

  it("超大 token 数不溢出", async () => {
    // Arrange
    vi.mocked(prisma.aiUsageLog.create).mockResolvedValue({} as never);
    const huge = 1_000_000_000;

    // Act
    await recordAiUsage({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      capability: "knowledge-qa",
      model: "deepseek-chat",
      inputTokens: huge,
      outputTokens: huge,
      durationMs: 100,
      success: true,
    });

    // Assert
    const arg = vi.mocked(prisma.aiUsageLog.create).mock.calls[0][0];
    expect(arg.data.totalTokens).toBe(2_000_000_000);
    expect(Number.isFinite(arg.data.cost)).toBe(true);
  });

  it("失败调用（success=false）仍记录使用量", async () => {
    // Arrange
    vi.mocked(prisma.aiUsageLog.create).mockResolvedValue({} as never);

    // Act
    await recordAiUsage({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      capability: "knowledge-qa",
      model: "deepseek-chat",
      inputTokens: 100,
      outputTokens: 50,
      durationMs: 300,
      success: false,
    });

    // Assert
    const arg = vi.mocked(prisma.aiUsageLog.create).mock.calls[0][0];
    expect(arg.data.success).toBe(false);
    expect(arg.data.totalTokens).toBe(150);
  });
});
