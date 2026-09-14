import { createOpenAI } from "@ai-sdk/openai";

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