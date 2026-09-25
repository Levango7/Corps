/**
 * AI 使用量跟踪与成本估算（方向 G）
 *
 * 设计要点：
 *  - recordAiUsage：每次 AI 调用结束后写入 AiUsageLog（Token / 成本 / 耗时 / 成败）
 *  - estimateCost：按模型定价表估算美元成本，未命中定价表回退到 deepseek-chat
 *  - 写入失败不抛异常：调用方在 finally 中异步调用并 .catch()，避免影响主流程
 *
 * 来源：方向 G 任务 1（usage-tracker.ts）
 */

import { prisma } from "@/lib/prisma";

/** recordAiUsage 入参 */
export interface RecordAiUsageParams {
  workspaceId: string;
  userId: string;
  /** AI 能力标识，如 "knowledge-qa" / "daily-report" */
  capability: string;
  /** 模型名，如 "deepseek-chat" / "deepseek-reasoner" */
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** 显式成本（美元）；不传则按 estimateCost 估算 */
  cost?: number;
  /** 调用耗时（毫秒） */
  durationMs: number;
  success: boolean;
}

/**
 * 记录一次 AI 调用的使用量。
 *
 * 写入失败由调用方 catch（典型用法在 withUsageTracking 的 finally 中
 * 异步触发并 .catch），本函数自身不吞异常——保持显式语义。
 */
export async function recordAiUsage(params: RecordAiUsageParams) {
  const totalTokens = params.inputTokens + params.outputTokens;
  const cost = params.cost ?? estimateCost(params.model, params.inputTokens, params.outputTokens);

  return prisma.aiUsageLog.create({
    data: {
      workspaceId: params.workspaceId,
      userId: params.userId,
      capability: params.capability,
      model: params.model,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      totalTokens,
      cost,
      durationMs: params.durationMs,
      success: params.success,
    },
  });
}

/**
 * 估算 AI 调用成本（美元）。
 *
 * DeepSeek 定价（2024 年标准）：
 *   deepseek-chat:     输入 $0.14/1M tokens, 输出 $0.28/1M tokens
 *   deepseek-reasoner: 输入 $0.55/1M tokens, 输出 $2.19/1M tokens
 *
 * 未命中定价表的模型回退到 deepseek-chat 费率（保守低估值，避免高估账单）。
 */
export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing: Record<string, { input: number; output: number }> = {
    "deepseek-chat": { input: 0.14 / 1_000_000, output: 0.28 / 1_000_000 },
    "deepseek-reasoner": { input: 0.55 / 1_000_000, output: 2.19 / 1_000_000 },
  };
  const rate = pricing[model] ?? pricing["deepseek-chat"];
  return inputTokens * rate.input + outputTokens * rate.output;
}
