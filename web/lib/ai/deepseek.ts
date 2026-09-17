import { createOpenAI } from "@ai-sdk/openai";
import { logger } from "@/lib/logger";

/**
 * DeepSeek 客户端（OpenAI 兼容格式）。
 *
 * DeepSeek 提供两个模型：
 * - deepseek-chat：通用对话/续写/摘要/翻译/格式化
 * - deepseek-reasoner：推理增强（复杂问答/决策提取）
 *
 * apiKey 从 DEEPSEEK_API_KEY 环境变量读取；未配置时各路由应短路返回 503。
 */
export const deepseek = createOpenAI({
  baseURL: "https://api.deepseek.com/v1",
  apiKey: process.env.DEEPSEEK_API_KEY ?? "",
});

/** 通用模型（续写/摘要/翻译/格式化/问答） */
export const defaultModel = deepseek("deepseek-chat");

/** 推理模型（复杂问答/决策提取等需要深度推理的场景） */
export const reasonerModel = deepseek("deepseek-reasoner");

/**
 * 根据模型类型决定是否保留 CoT（推理步骤）段落。
 *
 * deepseek-reasoner 有内置 reasoning_content 机制，CoT 引导有帮助；
 * deepseek-chat 等非 reasoner 模型不需要 CoT，移除以节省 token。
 *
 * @param systemPrompt 原始 system prompt（可能含 ## 推理步骤 段落）
 * @param model 模型实例（defaultModel 或 reasonerModel）
 * @returns 处理后的 system prompt（非 reasoner 模型移除 CoT 段落）
 */
export function withCoT(
  systemPrompt: string,
  model: typeof defaultModel,
): string {
  // reasoner 模型保留 CoT
  if (model === reasonerModel) return systemPrompt;
  // 非 reasoner 模型移除 ## 推理步骤 段落（到下一个 ## 或字符串末尾）
  //
  // 假设：每个 prompt 字符串中只有一个 "## 推理步骤" 段落。
  // 当前所有 prompt 构造函数（buildOrchestrationSystemPrompt 等）均只注入一段 CoT，
  // 因此 String.replace（仅替换第一个匹配）足够。若未来 prompt 改为多段 CoT 结构，
  // 需改用 replaceAll 或循环替换。
  return systemPrompt.replace(/\n## 推理步骤\n[\s\S]*?(?=\n## |$)/, "");
}
// ---------------------------------------------------------------------------
// LLM 调用超时防护
//
// DeepSeek API 偶发长尾请求会拖垮 AI 助理响应。通过 AbortController 给每次
// generateText 调用加超时：
//   - 普通模型（deepseek-chat）：30s
//   - 推理模型（deepseek-reasoner）：60s（推理任务耗时更长）
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
    logger.warn("[deepseek] LLM 调用超时，已中止", { label, timeoutMs });
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timer),
  };
}