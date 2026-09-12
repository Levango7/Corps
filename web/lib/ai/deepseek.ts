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