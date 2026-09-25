/**
 * AI 使用量跟踪中间件（方向 G）
 *
 * withUsageTracking 包装 AI 调用函数，自动记录使用量（Token / 耗时 / 成败）。
 *
 * 设计要点：
 *  - 成功路径：返回 fn() 的 result，同时记录 inputTokens/outputTokens
 *  - 失败路径：抛出原异常，但仍在 finally 中记录 success=false
 *  - 异步记录：在 finally 中触发 recordAiUsage 并 .catch()，不阻塞响应
 *  - 不依赖 shared.ts：避免循环依赖（shared.ts 是基础认证模块，
 *    被 AI 路由广泛依赖；本模块仅依赖 usage-tracker）
 *
 * 来源：方向 G 任务 4（withUsageTracking 辅助函数）
 */

import { recordAiUsage } from "@/lib/ai/usage-tracker";

/** withUsageTracking 入参（不含 usage，usage 由 fn 返回） */
export interface UsageTrackingParams {
  workspaceId: string;
  userId: string;
  /** AI 能力标识，如 "knowledge-qa" / "daily-report" */
  capability: string;
  /** 模型名，如 "deepseek-chat" */
  model: string;
}

/** 被包装的 AI 调用函数的返回类型：result + 可选 usage 信息 */
export interface UsageTrackingFnResult<T> {
  result: T;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * AI 使用量跟踪装饰器。
 *
 * 包装 AI 调用函数，自动记录使用量到 AiUsageLog。
 *
 * 用法：
 * ```ts
 * const answer = await withUsageTracking(
 *   { workspaceId, userId, capability: "knowledge-qa", model: "deepseek-chat" },
 *   async () => {
 *     const result = await callLlm(...);
 *     return {
 *       result: result.text,
 *       usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
 *     };
 *   },
 * );
 * ```
 *
 * 注意：
 *  - 记录失败不会影响主流程（.catch 吞异常并 console.error）
 *  - fn 抛出的异常会原样抛出，调用方需自行处理
 */
export async function withUsageTracking<T>(
  params: UsageTrackingParams,
  fn: () => Promise<UsageTrackingFnResult<T>>,
): Promise<T> {
  const startTime = Date.now();
  let success = true;
  let inputTokens = 0;
  let outputTokens = 0;
  let result: T;

  try {
    const fnResult = await fn();
    result = fnResult.result;
    inputTokens = fnResult.usage?.inputTokens ?? 0;
    outputTokens = fnResult.usage?.outputTokens ?? 0;
    return result;
  } catch (error) {
    success = false;
    throw error;
  } finally {
    const durationMs = Date.now() - startTime;
    // 异步记录使用量，不阻塞响应
    recordAiUsage({
      workspaceId: params.workspaceId,
      userId: params.userId,
      capability: params.capability,
      model: params.model,
      inputTokens,
      outputTokens,
      durationMs,
      success,
    }).catch((err) => {
      console.error("[usage-tracking] Failed to record usage:", err);
    });
  }
}
/**
 * 流式 AI 调用的使用量跟踪（fire-and-forget）。
 *
 * 流式 API（streamText）的 usage 在流结束后才可用，无法用 withUsageTracking
 * 同步包装。本函数供 streamText 的 onFinish 回调使用，在流结束后异步记录 usage。
 *
 * 用法：
 * ```ts
 * const startTime = Date.now();
 * const result = streamText({
 *   ...,
 *   onFinish: ({ usage }) => {
 *     fireRecordUsage(
 *       { workspaceId, userId, capability: "completion", model: defaultModel.modelId },
 *       startTime,
 *       usage,
 *     );
 *   },
 * });
 * ```
 *
 * 注意：workspaceId 为 null 时跳过记录（AiUsageLog.workspaceId 为必填外键）。
 */
export function fireRecordUsage(
  params: UsageTrackingParams,
  startTime: number,
  usage?: { inputTokens?: number; outputTokens?: number },
  success = true,
): void {
  // workspaceId 为空时跳过（AiUsageLog.workspaceId 为必填外键，不能为 null）
  if (!params.workspaceId) return;
  const durationMs = Date.now() - startTime;
  recordAiUsage({
    workspaceId: params.workspaceId,
    userId: params.userId,
    capability: params.capability,
    model: params.model,
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    durationMs,
    success,
  }).catch((err) => {
    console.error("[usage-tracking] Failed to record stream usage:", err);
  });
}
