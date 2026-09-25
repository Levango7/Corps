import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { logger } from "@/lib/logger";

/**
 * AI 提供商客户端与模型管理 — DeepSeek 主 + OpenAI 备。
 *
 * 架构：
 * - DeepSeek 为首选提供商（deepseek-chat / deepseek-reasoner）
 * - OpenAI 为 fallback 提供商（gpt-4o-mini / o3-mini）
 * - getDefaultModel() / getReasonerModel() 优先返回 DeepSeek，未配置时返回 OpenAI fallback
 * - withFallback() 包装 LLM 调用，运行时主提供商失败自动切换到 fallback
 *
 * 模型对应关系：
 * - deepseek-chat ↔ gpt-4o-mini（通用对话/续写/摘要/翻译/格式化）
 * - deepseek-reasoner ↔ o3-mini（推理增强/复杂问答/决策提取）
 */

// ---------------------------------------------------------------------------
// 客户端创建
// ---------------------------------------------------------------------------

/** DeepSeek 客户端（首选，OpenAI 兼容格式） */
export const deepseek = createOpenAI({
  baseURL: "https://api.deepseek.com/v1",
  apiKey: process.env.DEEPSEEK_API_KEY ?? "",
});

/** OpenAI 客户端（fallback） */
export const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? "",
});

// ---------------------------------------------------------------------------
// 模型实例（私有，通过 getter 函数暴露）
// ---------------------------------------------------------------------------

/** DeepSeek 通用模型（续写/摘要/翻译/格式化/问答） */
const deepseekDefaultModel = deepseek("deepseek-chat");

/** DeepSeek 推理模型（复杂问答/决策提取等需要深度推理的场景） */
const deepseekReasonerModel = deepseek("deepseek-reasoner");

/** OpenAI fallback 通用模型（与 deepseek-chat 对应） */
const fallbackDefaultModel = openai("gpt-4o-mini");

/** OpenAI fallback 推理模型（与 deepseek-reasoner 对应） */
const fallbackReasonerModel = openai("o3-mini");

// ---------------------------------------------------------------------------
// 提供商可用性检查
// ---------------------------------------------------------------------------

/** DeepSeek API key 是否已配置 */
function isDeepSeekConfigured(): boolean {
  return !!process.env.DEEPSEEK_API_KEY;
}

/** OpenAI API key 是否已配置 */
function isOpenAIConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

// ---------------------------------------------------------------------------
// 模型 getter 函数
// ---------------------------------------------------------------------------

/**
 * 获取通用模型 — 优先 DeepSeek，未配置时返回 OpenAI fallback，都未配置返回 null。
 *
 * 调用方应在 isAiConfigured() 检查通过后使用，或使用 requireDefaultModel()。
 */
export function getDefaultModel(): LanguageModelV4 | null {
  if (isDeepSeekConfigured()) return deepseekDefaultModel;
  if (isOpenAIConfigured()) return fallbackDefaultModel;
  return null;
}

/**
 * 获取推理模型 — 优先 DeepSeek，未配置时返回 OpenAI fallback，都未配置返回 null。
 *
 * 调用方应在 isAiConfigured() 检查通过后使用，或使用 requireReasonerModel()。
 */
export function getReasonerModel(): LanguageModelV4 | null {
  if (isDeepSeekConfigured()) return deepseekReasonerModel;
  if (isOpenAIConfigured()) return fallbackReasonerModel;
  return null;
}

/**
 * 获取通用模型 — 未配置任何提供商时抛出异常。
 *
 * 适用于在 isAiConfigured() 检查之后直接使用，避免 null 处理样板代码。
 */
export function requireDefaultModel(): LanguageModelV4 {
  const model = getDefaultModel();
  if (!model)
    throw new Error("No AI provider configured (DEEPSEEK_API_KEY or OPENAI_API_KEY required)");
  return model;
}

/**
 * 获取推理模型 — 未配置任何提供商时抛出异常。
 *
 * 适用于在 isAiConfigured() 检查之后直接使用，避免 null 处理样板代码。
 */
export function requireReasonerModel(): LanguageModelV4 {
  const model = getReasonerModel();
  if (!model)
    throw new Error("No AI provider configured (DEEPSEEK_API_KEY or OPENAI_API_KEY required)");
  return model;
}

// ---------------------------------------------------------------------------
// 推理模型识别
// ---------------------------------------------------------------------------

/**
 * 判断模型是否为推理模型（需要保留 CoT 段落）。
 *
 * 通过 modelId 判断：deepseek-reasoner / o3-mini 均为推理模型。
 */
export function isReasonerModel(model: LanguageModelV4): boolean {
  return model.modelId.includes("reasoner") || model.modelId.includes("o3");
}

// ---------------------------------------------------------------------------
// withCoT — 推理步骤段落控制
// ---------------------------------------------------------------------------

/**
 * 根据模型类型决定是否保留 CoT（推理步骤）段落。
 *
 * 推理模型（deepseek-reasoner / o3-mini）有内置 reasoning_content 机制，CoT 引导有帮助；
 * 非推理模型不需要 CoT，移除以节省 token。
 *
 * @param systemPrompt 原始 system prompt（可能含 ## 推理步骤 段落）
 * @param model 模型实例（LanguageModel）
 * @returns 处理后的 system prompt（非推理模型移除 CoT 段落）
 */
export function withCoT(systemPrompt: string, model: LanguageModelV4): string {
  // 推理模型保留 CoT
  if (isReasonerModel(model)) return systemPrompt;
  // 非推理模型移除 ## 推理步骤 段落（到下一个 ## 或字符串末尾）
  //
  // 假设：每个 prompt 字符串中只有一个 "## 推理步骤" 段落。
  // 当前所有 prompt 构造函数（buildOrchestrationSystemPrompt 等）均只注入一段 CoT，
  // 因此 String.replace（仅替换第一个匹配）足够。若未来 prompt 改为多段 CoT 结构，
  // 需改用 replaceAll 或循环替换。
  return systemPrompt.replace(/\n## 推理步骤\n[\s\S]*?(?=\n## |$)/, "");
}

// ---------------------------------------------------------------------------
// withFallback — 运行时提供商切换
// ---------------------------------------------------------------------------

/**
 * 包装 LLM 调用，主提供商失败时自动切换到 fallback 提供商。
 *
 * 使用方式：
 * ```ts
 * const result = await withFallback(
 *   () => generateText({ model: requireDefaultModel(), ... }),
 *   () => generateText({ model: fallbackDefaultModel, ... }),
 *   "recognizeIntent",
 * );
 * ```
 *
 * 仅当主提供商与 fallback 提供商不同时才会切换（即 DeepSeek 已配置时才会触发 fallback）。
 *
 * @param primaryCall 主提供商调用函数
 * @param fallbackCall fallback 提供商调用函数
 * @param label 日志标签（如 "recognizeIntent" / "runAssistant:task_breakdown"）
 * @returns 主提供商或 fallback 提供商的调用结果
 */
export async function withFallback<T>(
  primaryCall: () => Promise<T>,
  fallbackCall: () => Promise<T>,
  label: string,
): Promise<T> {
  try {
    return await primaryCall();
  } catch (error) {
    // 仅当 DeepSeek 已配置（主提供商与 fallback 不同）时才尝试 fallback
    if (isDeepSeekConfigured() && isOpenAIConfigured()) {
      logger.warn("[ai] 主提供商调用失败，切换到 fallback", {
        label,
        error: error instanceof Error ? error.message : String(error),
      });
      return await fallbackCall();
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// LLM 调用超时防护
//
// DeepSeek API 偶发长尾请求会拖垮 AI 助理响应。通过 AbortController 给每次
// generateText 调用加超时：
//   - 普通模型（deepseek-chat / gpt-4o-mini）：30s
//   - 推理模型（deepseek-reasoner / o3-mini）：60s（推理任务耗时更长）
// 超时后 abort signal，generateText 抛 AbortError，调用方 catch 后降级处理。
// ---------------------------------------------------------------------------

/** 普通模型调用超时（30s） */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** 推理模型调用超时（60s，推理任务需要更长时间） */
export const REASONER_TIMEOUT_MS = 60_000;

/** createAbortTimeout 返回类型 */
export interface AbortTimeout {
  /** 传给 generateText 的 abortSignal 参数 */
  signal: AbortSignal;
  /** 清除超时定时器，调用方必须在 finally 中调用以避免内存泄漏 */
  cleanup: () => void;
}

/**
 * 创建带超时的 AbortSignal，供 LLM 调用（generateText 的 abortSignal 参数）使用。
 *
 * 超时时 abort signal 并用 logger 记录事件。调用方必须在 finally 中调用 cleanup()
 * 清除定时器，否则定时器会残留到超时才释放。
 *
 * 用法：
 * ```ts
 * const { signal, cleanup } = createAbortTimeout(DEFAULT_TIMEOUT_MS, "recognizeIntent");
 * try {
 *   const result = await generateText({ ..., abortSignal: signal });
 *   return result;
 * } finally {
 *   cleanup();
 * }
 * ```
 *
 * @param timeoutMs 超时毫秒数
 * @param label 日志标签（如 "recognizeIntent" / "runAssistant:task_breakdown"）
 * @returns { signal, cleanup }
 */
export function createAbortTimeout(timeoutMs: number, label: string): AbortTimeout {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    logger.warn("[ai] LLM 调用超时，已中止", { label, timeoutMs });
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timer),
  };
}
