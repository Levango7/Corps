import type { LanguageModelV4 } from "@ai-sdk/provider";
import { logger } from "@/lib/logger";
import {
  withFallback,
  createAbortTimeout,
  DEFAULT_TIMEOUT_MS,
  REASONER_TIMEOUT_MS,
  getFallbackModel,
  requireDefaultModel,
  requireReasonerModel,
  isDeepSeekConfigured,
  isOpenAIConfigured,
} from "@/lib/ai/deepseek";

/**
 * LLM 调用统一封装：超时防护 + 主备切换（2026-11-07 P1 批接线）。
 *
 * 背景（产品化审计 agent.md ④-P1）：
 *   - `withFallback` 自定义以来全库零调用（死代码）——所有 LLM 调用单次失败即 500，
 *     "DeepSeek 主 + OpenAI 备"只是纸面能力；
 *   - 超时防护（createAbortTimeout）只覆盖助理编排一条链路，其余生成路由的
 *     generateText/streamText 均未传 abortSignal，DeepSeek 长尾请求会挂起请求线程。
 *
 * 本封装把两件事合成一个调用点形态，调用主体只需包一层 lambda、model 与
 * abortSignal 由参数注入（**不复制参数对象**；fallback 语义由 withFallback 内部
 * 保证：仅当 DeepSeek 与 OpenAI 都已配置时才会二次调用）：
 *
 * ```ts
 * // 原：await generateText({ model: requireDefaultModel(), system, prompt });
 * const result = await callLLM("summary:generate", {}, (model, signal) =>
 *   generateText({ model, system, prompt, abortSignal: signal }),
 * );
 * // 推理模型：
 * const r = await callLLM("decision:extract", { reasoner: true }, (model, signal) =>
 *   generateText({ model, ..., abortSignal: signal }),
 * );
 * ```
 *
 * 超时口径沿用 deepseek.ts 常量：普通 30s / 推理 60s。超时抛 AbortError 后由
 * withFallback 判定是否切换 fallback（主备各一次，不无限重试）。
 *
 * 注意：调用方仍须在 isAiConfigured() 检查通过后再调用（requireDefaultModel
 * 在无 provider 时抛错，与既有约定一致）。
 */

/** 普通调用：generateText 等一次性返回 */
export async function callLLM<T>(
  label: string,
  opts: { reasoner?: boolean },
  run: (model: LanguageModelV4, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const { signal, cleanup } = createAbortTimeout(
    opts.reasoner ? REASONER_TIMEOUT_MS : DEFAULT_TIMEOUT_MS,
    label,
  );
  try {
    return await withFallback(
      () => run(opts.reasoner ? requireReasonerModel() : requireDefaultModel(), signal),
      () => run(getFallbackModel(opts.reasoner ?? false), signal),
      label,
    );
  } finally {
    cleanup();
  }
}

/**
 * 流式调用：streamText 版。返回值与裸 streamText 一致（流对象）。
 * 超时用 AbortSignal.timeout（Node 18+）：定时器由运行时自行回收，无需手动
 * cleanup，也不存在"定时器释放过早导致超时保护失效"的窗口；流中途断开属
 * UI 层重连语义，不在此层处理（fallback 仅覆盖**发起**失败——构造即抛错）。
 */
export function callLLMStream<O>(
  label: string,
  opts: { reasoner?: boolean },
  run: (model: LanguageModelV4, signal: AbortSignal) => O,
): O {
  const timeoutMs = opts.reasoner ? REASONER_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    return run(opts.reasoner ? requireReasonerModel() : requireDefaultModel(), signal);
  } catch (error) {
    if (isDeepSeekConfigured() && isOpenAIConfigured()) {
      logger.warn("[ai] streamText 主提供商构造失败，切换到 fallback", {
        label,
        error: error instanceof Error ? error.message : String(error),
      });
      return run(getFallbackModel(opts.reasoner ?? false), signal);
    }
    throw error;
  }
}
