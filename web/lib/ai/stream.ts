/**
 * AI 流式进度反馈工具。
 *
 * 基于 Vercel AI SDK v7 的 `createUIMessageStream` 创建自定义 UI 消息流，
 * 在 LLM 文本流之前发送阶段化进度 data part（`data-progress`），
 * 前端可解析并显示步骤指示器。
 *
 * 提供两个工厂函数：
 *  - `createAiProgressStream`：文本流模式（streamText），用于日报/洞察等 markdown 输出
 *  - `createAiJsonProgressStream`：JSON 模式（generateText），用于审批建议等结构化输出
 *
 * 进度 data part 格式：{ type: "data-progress", data: { stage, message } }
 * 结果 data part 格式：{ type: "data-result", data: <任意 JSON> }
 *
 * 设计决策：进度阶段有真实时序——阶段 1（聚合数据）在 buildPrompt 之前发送，
 * 阶段 2（分析）在 buildPrompt 完成后发送，阶段 3（生成）在 LLM 调用前发送。
 * 这样前端步骤指示器能真实反映后端处理进度，而非一次性闪过。
 */

import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  generateText,
  type LanguageModel,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { fireRecordUsage, type UsageTrackingParams } from "@/lib/ai/usage-middleware";

/** 进度 data part 的数据结构（写入流中 `data-progress` 类型的 data 字段） */
export interface AiProgressData {
  /** 阶段编号：1=聚合数据, 2=分析, 3=生成 */
  stage: 1 | 2 | 3;
  /** 阶段描述消息（已国际化，由路由传入） */
  message: string;
}

/** 3 阶段进度消息配置 */
export interface AiProgressStages {
  /** 阶段 1：正在聚合数据 */
  context: string;
  /** 阶段 2：正在分析 */
  analyzing: string;
  /** 阶段 3：正在生成回答 */
  generating: string;
}

/**
 * 写入进度 data part 到流。
 *
 * data part 的 type 为 `data-progress`，data 为 `{ stage, message }`。
 * 用类型断言因为 UIMessageChunk 的 data part 类型是 `data-${string}` 的联合，
 * TypeScript 无法自动推断 `data-progress` 是合法成员。
 */
function writeProgress(
  writer: { write(part: UIMessageChunk): void },
  stage: 1 | 2 | 3,
  message: string,
): void {
  writer.write({
    type: "data-progress",
    data: { stage, message },
  } as UIMessageChunk);
}

/** createAiProgressStream 的参数 */
export interface CreateAiProgressStreamParams {
  /** LLM 模型实例 */
  model: LanguageModel;
  /** System prompt */
  system: string;
  /**
   * 异步构建 user prompt（如聚合数据库上下文）。
   * 在阶段 1（聚合数据）之后、阶段 2（分析）之前执行。
   * 将上下文聚合封装在此函数中，让进度阶段有真实时序。
   */
  buildPrompt: () => Promise<string>;
  /**
   * 可选：使用量跟踪参数。传入后在流结束后异步记录 usage（fire-and-forget）。
   * workspaceId 为 null 时跳过记录。
   */
  usageTracking?: UsageTrackingParams;
}

/**
 * 创建带阶段化进度的 AI 文本流式响应。
 *
 * 流程：
 *  1. 写入阶段 1 进度（正在聚合数据...）
 *  2. 执行 buildPrompt（聚合上下文，可能较慢）
 *  3. 写入阶段 2 进度（正在分析...）
 *  4. 写入阶段 3 进度（正在生成回答...）
 *  5. 调用 streamText 并合并 LLM 文本流
 *
 * @returns Response（SSE 格式，可直接从 Next.js route handler 返回）
 */
export function createAiProgressStream(
  params: CreateAiProgressStreamParams,
  stages: AiProgressStages,
): Response {
  const usageStartTime = params.usageTracking ? Date.now() : 0;
  const stream = createUIMessageStream<UIMessage>({
    execute: async ({ writer }) => {
      // 阶段 1：聚合数据
      writeProgress(writer, 1, stages.context);

      // 执行上下文聚合（可能涉及多次数据库查询，较慢）
      // try-catch：buildPrompt 失败时抛出带上下文的有意义错误，便于调用方排查
      let prompt: string;
      try {
        prompt = await params.buildPrompt();
      } catch (e) {
        throw new Error(
          `[ai-stream] buildPrompt 失败: ${e instanceof Error ? e.message : String(e)}`,
        );
      }

      // 阶段 2：分析
      writeProgress(writer, 2, stages.analyzing);

      // 阶段 3：生成
      writeProgress(writer, 3, stages.generating);

      // 调用 LLM 流式生成并合并到 UI 消息流
      // try-catch：streamText 初始化或流合并失败时抛出有意义错误
      let result;
      try {
        result = streamText({
          model: params.model,
          system: params.system,
          prompt,
          // 流结束后异步记录 usage（fire-and-forget）
          onFinish: params.usageTracking
            ? ({ usage }) => {
                fireRecordUsage(params.usageTracking!, usageStartTime, usage);
              }
            : undefined,
        });
      } catch (e) {
        // usage tracking：记录失败
        if (params.usageTracking) {
          fireRecordUsage(params.usageTracking, usageStartTime, undefined, false);
        }
        throw new Error(
          `[ai-stream] streamText 初始化失败: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      // await 确保 LLM 流完整合并后再结束 execute，避免流提前关闭
      try {
        await writer.merge(result.toUIMessageStream());
      } catch (e) {
        throw new Error(
          `[ai-stream] 流合并失败: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    },
  });

  return createUIMessageStreamResponse({ stream });
}

/** createAiJsonProgressStream 的参数 */
export interface CreateAiJsonProgressStreamParams<T> {
  /** LLM 模型实例 */
  model: LanguageModel;
  /** System prompt */
  system: string;
  /**
   * 异步构建 user prompt（如聚合审批实例 + 历史审批）。
   * 在阶段 1（聚合数据）之后、阶段 2（分析）之前执行。
   */
  buildPrompt: () => Promise<string>;
  /**
   * 从 LLM 输出文本解析结构化结果。
   * 解析失败时应返回降级结果（而非抛异常），由调用方决定降级策略。
   */
  parseResult: (text: string) => T;
  /**
   * 可选：使用量跟踪参数。传入后在 LLM 调用结束后异步记录 usage（fire-and-forget）。
   * workspaceId 为 null 时跳过记录。
   */
  usageTracking?: UsageTrackingParams;
}

/**
 * 创建带阶段化进度的 AI JSON 流式响应。
 *
 * 与 `createAiProgressStream` 类似，但使用 `generateText`（非流式）获取完整 LLM 输出，
 * 解析为 JSON 后以 `data-result` data part 发送，前端可解析并渲染结构化 UI。
 *
 * 适用于需要结构化输出（如审批建议的 riskLevel/riskFactors/suggestion）的场景：
 * 流式发送进度 data part，最后发送结果 data part，前端保持结构化展示。
 *
 * @returns Response（SSE 格式，含进度 data part + 结果 data part）
 */
export function createAiJsonProgressStream<T>(
  params: CreateAiJsonProgressStreamParams<T>,
  stages: AiProgressStages,
): Response {
  const usageStartTime = params.usageTracking ? Date.now() : 0;
  const stream = createUIMessageStream<UIMessage>({
    execute: async ({ writer }) => {
      // 阶段 1：聚合数据
      writeProgress(writer, 1, stages.context);

      // 执行上下文聚合
      // try-catch：buildPrompt 失败时抛出带上下文的有意义错误
      let prompt: string;
      try {
        prompt = await params.buildPrompt();
      } catch (e) {
        throw new Error(
          `[ai-stream] buildPrompt 失败: ${e instanceof Error ? e.message : String(e)}`,
        );
      }

      // 阶段 2：分析
      writeProgress(writer, 2, stages.analyzing);

      // 阶段 3：生成
      writeProgress(writer, 3, stages.generating);

      // 调用 LLM（非流式，获取完整输出后解析 JSON）
      // try-catch：generateText 可能因网络/限流/模型异常失败
      let result;
      try {
        result = await generateText({
          model: params.model,
          system: params.system,
          prompt,
        });
      } catch (e) {
        // usage tracking：记录失败
        if (params.usageTracking) {
          fireRecordUsage(params.usageTracking, usageStartTime, undefined, false);
        }
        throw new Error(
          `[ai-stream] generateText 失败: ${e instanceof Error ? e.message : String(e)}`,
        );
      }

      // usage tracking：记录成功（fire-and-forget）
      if (params.usageTracking) {
        fireRecordUsage(
          params.usageTracking,
          usageStartTime,
          result.usage
            ? { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens }
            : undefined,
        );
      }

      // 解析结果并写入 data-result data part
      // try-catch：parseResult 失败时抛出有意义错误（虽然接口约定 parseResult 应返回降级结果，
      // 但防御性捕获以防调用方未遵守约定）
      let parsed: T;
      try {
        parsed = params.parseResult(result.text);
      } catch (e) {
        throw new Error(
          `[ai-stream] parseResult 失败: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      writer.write({
        type: "data-result",
        data: parsed,
      } as UIMessageChunk);
    },
  });

  return createUIMessageStreamResponse({ stream });
}