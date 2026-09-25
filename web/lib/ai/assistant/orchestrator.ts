// AI 助理编排引擎——把 31 个分散 AI 能力串联成贯穿任务全流程的助手。
//
// 设计要点：
// - recognizeIntent：用 defaultModel 判断用户消息对应哪个能力（意图识别）
// - runAssistant：主入口，按意图选择能力 → 构建 prompt → 调用 LLM（推理/通用）→ 解析 JSON 结果
// - getSuggestionsForPhase：按任务生命周期阶段返回建议能力列表（前端引导）
// - withUsageTracking 包装每次调用，自动记录 Token 使用量
// - 推理能力（decision_assistant/bottleneck_analysis/progress_anomaly/risk_alert）使用 reasonerModel
//
// 来源：P2 后端任务 318（AI 助理编排引擎 + 对话 API）

import { generateText } from "ai";
import {
  requireDefaultModel,
  requireReasonerModel,
  withCoT,
  createAbortTimeout,
  DEFAULT_TIMEOUT_MS,
  REASONER_TIMEOUT_MS,
} from "@/lib/ai/deepseek";
import { withUsageTracking } from "@/lib/ai/usage-middleware";
import { cleanJsonResponse } from "@/lib/ai/orchestrator";
import { logger } from "@/lib/logger";
import {
  ASSISTANT_PROMPT_BUILDERS,
  type AssistantCapabilityId,
  type PromptContext,
} from "@/lib/ai/assistant/prompts";

/** 任务生命周期阶段 */
export type TaskPhase = "created" | "in_progress" | "review" | "completed" | "blocked";

/** AI 助理能力定义 */
export interface AssistantCapability {
  id: string;
  label: string;
  description: string;
  phases: TaskPhase[];
  /** prompt 构建函数（返回 system prompt） */
  buildSystem: (ctx: AssistantContext) => string;
  /** 是否使用推理模型 */
  useReasoner: boolean;
}

/** AI 助理上下文 */
export interface AssistantContext {
  workspaceId: string;
  userId: string;
  taskId?: string;
  phase: TaskPhase;
  /** 用户输入消息 */
  message: string;
  /** 前一步输出（串联上下文） */
  previousOutput?: string;
  /** 额外上下文 */
  extraContext?: Record<string, string>;
  /** 对话历史（多轮上下文，按时间正序） */
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

/** AI 助理执行结果 */
export interface AssistantResult {
  capabilityId: string;
  phase: TaskPhase;
  content: string;
  suggestions?: string[];
  nextPhase?: TaskPhase;
  /** 推荐的下一步能力（任务全流程串联） */
  recommendedNext?: { nextCapability: string; reason: string };
}

/** 需要推理模型的能力（复杂分析/决策类） */
const REASONER_CAPS = [
  "decision_assistant",
  "bottleneck_analysis",
  "progress_anomaly",
  "risk_alert",
];

/**
 * 意图识别：用 LLM 判断用户消息对应哪个能力。
 *
 * 用 defaultModel（轻量、快速），失败时降级为 semantic_search（通用兜底）。
 *
 * @param message 用户消息
 * @param phase 当前任务阶段
 * @returns 能力 ID（如 task_breakdown）
 */
// P1-fix: 意图识别输出白名单——防止 LLM 被注入后返回任意 capabilityId
//
// ASSISTANT_CAPABILITIES 为全部能力 ID 的权威列表。
// 用 Set 去重后派生 VALID_CAPS：若维护时误加重复项，去重逻辑会自动收敛，
// 并在模块加载时 logger.warn 提示，避免重复能力导致意图识别歧义。
export const ASSISTANT_CAPABILITIES: string[] = [
  "task_breakdown",
  "todo_extract",
  "progress_anomaly",
  "bottleneck_analysis",
  "follow_up",
  "decision_assistant",
  "approval_advice",
  "meeting_summary",
  "daily_report",
  "knowledge_extract",
  "semantic_search",
  "risk_alert",
];

// 去重：防止维护过程中误加重复能力 ID
const DEDUPED_CAPABILITIES = [...new Set(ASSISTANT_CAPABILITIES)];
if (DEDUPED_CAPABILITIES.length !== ASSISTANT_CAPABILITIES.length) {
  logger.warn("[ai/assistant] ASSISTANT_CAPABILITIES 存在重复项，已去重", {
    originalCount: ASSISTANT_CAPABILITIES.length,
    dedupedCount: DEDUPED_CAPABILITIES.length,
  });
}

const VALID_CAPS = new Set(DEDUPED_CAPABILITIES);

async function recognizeIntent(
  message: string,
  phase: TaskPhase,
  workspaceId: string,
  userId: string,
): Promise<string> {
  // P1-fix: 用户消息只通过 prompt 参数传，不拼进 system prompt，避免 prompt injection
  const systemPrompt = `你是 AI 助理意图识别器。根据用户消息和当前任务阶段，选择最合适的能力。
可用能力：task_breakdown（任务拆解）、todo_extract（待办提取）、progress_anomaly（进度异常）、
bottleneck_analysis（瓶颈分析）、follow_up（跟进提醒）、decision_assistant（决策辅助）、
approval_advice（审批建议）、meeting_summary（会议纪要）、daily_report（日报）、
knowledge_extract（知识提取）、semantic_search（语义搜索）、risk_alert（风险预警）。

当前任务阶段：${phase}

只返回能力 ID（如 task_breakdown），不要其他内容。`;

  // 30s 超时防护：意图识别应快速返回，长尾请求直接降级为 semantic_search
  const { signal, cleanup } = createAbortTimeout(DEFAULT_TIMEOUT_MS, "recognizeIntent");

  try {
    const result = await withUsageTracking(
      {
        workspaceId,
        userId,
        capability: "assistant-recognize-intent",
        model: requireDefaultModel().modelId,
      },
      async () => {
        const r = await generateText({
          model: requireDefaultModel(),
          system: systemPrompt,
          prompt: message,
          abortSignal: signal,
        });
        return {
          result: r,
          usage: r.usage
            ? {
                inputTokens: r.usage.inputTokens ?? 0,
                outputTokens: r.usage.outputTokens ?? 0,
              }
            : undefined,
        };
      },
    );
    const intent = result.text.trim().toLowerCase();
    // P1-fix: 白名单校验，未命中则降级为 semantic_search
    return VALID_CAPS.has(intent) ? intent : "semantic_search";
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      logger.warn("[ai/assistant] recognizeIntent 超时，降级为 semantic_search", {
        phase,
      });
    }
    return "semantic_search";
  } finally {
    cleanup();
  }
}

/**
 * 主入口：执行 AI 助理。
 *
 * 流程：
 *  1. recognizeIntent 识别用户意图 → capabilityId
 *  2. buildCapabilityPrompt 构建 system prompt
 *  3. 按能力选择模型（推理能力用 reasonerModel，其余 defaultModel）
 *  4. withUsageTracking 包装 generateText，自动记录使用量
 *  5. cleanJsonResponse + JSON.parse 解析结果（失败时降级为纯文本）
 *
 * @param ctx 助理上下文（workspaceId/userId/phase/message 等）
 * @returns AssistantResult；调用失败返回 null
 */
export async function runAssistant(ctx: AssistantContext): Promise<AssistantResult | null> {
  const capabilityId = await recognizeIntent(ctx.message, ctx.phase, ctx.workspaceId, ctx.userId);

  // 按能力选择模型 + 超时（推理模型 60s，普通模型 30s）
  const model = needsReasoner(capabilityId) ? requireReasonerModel() : requireDefaultModel();
  const timeoutMs = needsReasoner(capabilityId) ? REASONER_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
  const { signal: abortSignal, cleanup: abortCleanup } = createAbortTimeout(
    timeoutMs,
    `runAssistant:${capabilityId}`,
  );

  try {
    const systemPrompt = buildCapabilityPrompt(capabilityId, ctx);

    // 构建专门 builder 的 PromptContext（传递 history 多轮上下文）
    const promptCtx: PromptContext = {
      message: ctx.message,
      phase: ctx.phase,
      taskId: ctx.taskId,
      previousOutput: ctx.previousOutput,
      history: ctx.history,
    };
    // 专门 builder 的 user prompt（已包含前序上下文 + 历史摘要）
    const userPrompt = buildCapabilityUserPrompt(capabilityId, promptCtx);

    const llmResult = await withUsageTracking(
      {
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        capability: `assistant-${capabilityId}`,
        model: model.modelId,
      },
      async () => {
        const result = await generateText({
          model,
          system: withCoT(systemPrompt, model),
          prompt: userPrompt,
          abortSignal,
        });
        return {
          result,
          usage: result.usage
            ? {
                inputTokens: result.usage.inputTokens ?? 0,
                outputTokens: result.usage.outputTokens ?? 0,
              }
            : undefined,
        };
      },
    );

    const cleaned = cleanJsonResponse(llmResult.text);
    // P1-fix: JSON.parse 后对 suggestions/nextPhase 做运行时类型校验，
    // 防止 LLM 返回畸形结构导致下游崩溃
    const VALID_PHASES = new Set<TaskPhase>([
      "created",
      "in_progress",
      "review",
      "completed",
      "blocked",
    ]);
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(cleaned) as Record<string, unknown>;
    } catch {
      // LLM 未返回合法 JSON，降级为纯文本
      raw = { content: llmResult.text };
    }

    // 任务全流程串联：基于当前阶段和已用能力推荐下一步
    const phaseRec = getPhaseRecommendation(ctx.phase, capabilityId);
    const recommendedNext = phaseRec.nextCapability
      ? {
          nextCapability: phaseRec.nextCapability,
          reason: phaseRec.reason,
        }
      : undefined;

    return {
      capabilityId,
      phase: ctx.phase,
      content: typeof raw.content === "string" ? raw.content : llmResult.text,
      suggestions: Array.isArray(raw.suggestions)
        ? raw.suggestions.filter((s): s is string => typeof s === "string")
        : undefined,
      nextPhase:
        typeof raw.nextPhase === "string" && VALID_PHASES.has(raw.nextPhase as TaskPhase)
          ? (raw.nextPhase as TaskPhase)
          : undefined,
      recommendedNext,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      logger.warn("[ai/assistant] runAssistant 调用超时", {
        capabilityId,
        timeoutMs,
      });
    } else {
      logger.warn("[ai/assistant] runAssistant failed", {
        error: err instanceof Error ? err.message : String(err),
        capabilityId,
      });
    }
    return null;
  } finally {
    abortCleanup();
  }
}

/**
 * 获取当前阶段的建议能力（前端引导用）。
 *
 * 每个阶段对应 2-3 个最相关的能力，按优先级排序。
 *
 * P1-fix: 返回 i18n key（labelKey/descKey）而非硬编码中文，
 * 前端按 locale 翻译。AssistantPanel 渲染时用 t(item.labelKey) 取文案。
 *
 * @param phase 任务生命周期阶段
 * @returns 建议 capability 列表（id/labelKey/descKey）
 */
export function getSuggestionsForPhase(
  phase: TaskPhase,
): Array<{ id: string; labelKey: string; descKey: string }> {
  const SUGGESTIONS: Record<TaskPhase, Array<{ id: string; labelKey: string; descKey: string }>> = {
    created: [
      {
        id: "task_breakdown",
        labelKey: "assistant.suggest.taskBreakdown.label",
        descKey: "assistant.suggest.taskBreakdown.desc",
      },
      {
        id: "todo_extract",
        labelKey: "assistant.suggest.todoExtract.label",
        descKey: "assistant.suggest.todoExtract.desc",
      },
    ],
    in_progress: [
      {
        id: "progress_anomaly",
        labelKey: "assistant.suggest.progressAnomaly.label",
        descKey: "assistant.suggest.progressAnomaly.desc",
      },
      {
        id: "bottleneck_analysis",
        labelKey: "assistant.suggest.bottleneckAnalysis.label",
        descKey: "assistant.suggest.bottleneckAnalysis.desc",
      },
      {
        id: "follow_up",
        labelKey: "assistant.suggest.followUp.label",
        descKey: "assistant.suggest.followUp.desc",
      },
    ],
    review: [
      {
        id: "decision_assistant",
        labelKey: "assistant.suggest.decisionAssistant.label",
        descKey: "assistant.suggest.decisionAssistant.desc",
      },
      {
        id: "approval_advice",
        labelKey: "assistant.suggest.approvalAdvice.label",
        descKey: "assistant.suggest.approvalAdvice.desc",
      },
    ],
    completed: [
      {
        id: "meeting_summary",
        labelKey: "assistant.suggest.meetingSummary.label",
        descKey: "assistant.suggest.meetingSummary.desc",
      },
      {
        id: "daily_report",
        labelKey: "assistant.suggest.dailyReport.label",
        descKey: "assistant.suggest.dailyReport.desc",
      },
      {
        id: "knowledge_extract",
        labelKey: "assistant.suggest.knowledgeExtract.label",
        descKey: "assistant.suggest.knowledgeExtract.desc",
      },
    ],
    blocked: [
      {
        id: "risk_alert",
        labelKey: "assistant.suggest.riskAlert.label",
        descKey: "assistant.suggest.riskAlert.desc",
      },
      {
        id: "bottleneck_analysis",
        labelKey: "assistant.suggest.bottleneckAnalysis.label",
        descKey: "assistant.suggest.bottleneckAnalysis.desc",
      },
    ],
  };
  return SUGGESTIONS[phase] ?? [];
}

/**
 * 构建能力 system prompt。
 *
 * 从 ASSISTANT_PROMPT_BUILDERS 取专门 builder 构建各能力定制的 system prompt
 * （角色 + 输出 JSON schema + 推理步骤）。
 * 未命中专门 builder 时降级为通用 prompt。
 */
function buildCapabilityPrompt(capabilityId: string, ctx: AssistantContext): string {
  const builder = ASSISTANT_PROMPT_BUILDERS[capabilityId as AssistantCapabilityId];
  if (builder) {
    return builder.buildSystem({
      message: ctx.message,
      phase: ctx.phase,
      taskId: ctx.taskId,
      previousOutput: ctx.previousOutput,
      history: ctx.history,
    });
  }
  // 降级：未命中专门 builder 的能力用通用 prompt
  return `你是 Corps AI 助理，当前能力：${capabilityId}，任务阶段：${ctx.phase}。
请用 JSON 格式返回：{ "content": "回复内容", "suggestions": ["建议1", "建议2"], "nextPhase": "下一阶段" }
直接返回 JSON，不要 markdown 代码块。`;
}

/**
 * 构建能力 user prompt（用户消息 + 前序上下文 + 对话历史摘要）。
 *
 * 由专门 builder 的 buildPrompt 生成，已内置前序上下文与历史摘要拼接。
 * 未命中专门 builder 时降级为简单拼接。
 */
function buildCapabilityUserPrompt(capabilityId: string, ctx: PromptContext): string {
  const builder = ASSISTANT_PROMPT_BUILDERS[capabilityId as AssistantCapabilityId];
  if (builder) {
    return builder.buildPrompt(ctx);
  }
  // 降级：简单拼接用户消息 + 前序上下文
  return ctx.message + (ctx.previousOutput ? `\n\n前序上下文：\n${ctx.previousOutput}` : "");
}

/**
 * 任务全流程串联：基于当前阶段和刚执行的能力推荐下一步能力。
 *
 * 流程编排：
 *   created       → task_breakdown → todo_extract → follow_up
 *   in_progress   → progress_anomaly → bottleneck_analysis → follow_up
 *   review        → decision_assistant → approval_advice
 *   completed     → daily_report → knowledge_extract
 *   blocked       → bottleneck_analysis → risk_alert
 *
 * @param phase 当前任务阶段
 * @param lastCapability 刚执行的能力 ID（可选）
 * @returns 推荐的下一步能力 + 推荐理由；无推荐时 nextCapability 为 undefined
 */
export function getPhaseRecommendation(
  phase: TaskPhase,
  lastCapability?: string,
): { nextCapability?: string; reason: string } {
  // 各阶段的流程链：按顺序执行，lastCapability 之后的为下一步
  const FLOW: Record<TaskPhase, string[]> = {
    created: ["task_breakdown", "todo_extract", "follow_up"],
    in_progress: ["progress_anomaly", "bottleneck_analysis", "follow_up"],
    review: ["decision_assistant", "approval_advice"],
    completed: ["daily_report", "knowledge_extract"],
    blocked: ["bottleneck_analysis", "risk_alert"],
  };

  const chain = FLOW[phase];
  if (!chain || chain.length === 0) {
    return { reason: "当前阶段无推荐流程" };
  }

  // 无 lastCapability 时推荐流程第一步
  if (!lastCapability) {
    return {
      nextCapability: chain[0],
      reason: `阶段 ${phase} 建议从 ${chain[0]} 开始`,
    };
  }

  // lastCapability 不在流程链中：推荐流程第一步
  const idx = chain.indexOf(lastCapability);
  if (idx === -1) {
    return {
      nextCapability: chain[0],
      reason: `当前能力 ${lastCapability} 不在 ${phase} 标准流程中，建议执行 ${chain[0]}`,
    };
  }

  // 已是流程最后一步：无下一步推荐
  if (idx >= chain.length - 1) {
    return { reason: `${phase} 阶段流程已完成` };
  }

  const next = chain[idx + 1];
  return {
    nextCapability: next,
    reason: `${lastCapability} 完成后，建议执行 ${next}`,
  };
}

/** 判断能力是否需要推理模型 */
function needsReasoner(capabilityId: string): boolean {
  return REASONER_CAPS.includes(capabilityId);
}
