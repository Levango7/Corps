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
import { defaultModel, reasonerModel, withCoT } from "@/lib/ai/deepseek";
import { withUsageTracking } from "@/lib/ai/usage-middleware";
import { cleanJsonResponse } from "@/lib/ai/orchestrator";
import { logger } from "@/lib/logger";

/** 任务生命周期阶段 */
export type TaskPhase =
  | "created"
  | "in_progress"
  | "review"
  | "completed"
  | "blocked";

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
}

/** AI 助理执行结果 */
export interface AssistantResult {
  capabilityId: string;
  phase: TaskPhase;
  content: string;
  suggestions?: string[];
  nextPhase?: TaskPhase;
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
const VALID_CAPS = new Set([
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
]);

async function recognizeIntent(
  message: string,
  phase: TaskPhase,
): Promise<string> {
  // P1-fix: 用户消息只通过 prompt 参数传，不拼进 system prompt，避免 prompt injection
  const systemPrompt = `你是 AI 助理意图识别器。根据用户消息和当前任务阶段，选择最合适的能力。
可用能力：task_breakdown（任务拆解）、todo_extract（待办提取）、progress_anomaly（进度异常）、
bottleneck_analysis（瓶颈分析）、follow_up（跟进提醒）、decision_assistant（决策辅助）、
approval_advice（审批建议）、meeting_summary（会议纪要）、daily_report（日报）、
knowledge_extract（知识提取）、semantic_search（语义搜索）、risk_alert（风险预警）。

当前任务阶段：${phase}

只返回能力 ID（如 task_breakdown），不要其他内容。`;

  try {
    const result = await generateText({
      model: defaultModel,
      system: systemPrompt,
      prompt: message,
    });
    const intent = result.text.trim().toLowerCase();
    // P1-fix: 白名单校验，未命中则降级为 semantic_search
    return VALID_CAPS.has(intent) ? intent : "semantic_search";
  } catch {
    return "semantic_search";
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
export async function runAssistant(
  ctx: AssistantContext,
): Promise<AssistantResult | null> {
  const capabilityId = await recognizeIntent(ctx.message, ctx.phase);

  try {
    const systemPrompt = buildCapabilityPrompt(capabilityId, ctx);
    const model = needsReasoner(capabilityId) ? reasonerModel : defaultModel;

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
          prompt:
            ctx.message +
            (ctx.previousOutput
              ? `\n\n前序上下文：\n${ctx.previousOutput}`
              : ""),
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

    return {
      capabilityId,
      phase: ctx.phase,
      content:
        typeof raw.content === "string" ? raw.content : llmResult.text,
      suggestions: Array.isArray(raw.suggestions)
        ? raw.suggestions.filter(
            (s): s is string => typeof s === "string",
          )
        : undefined,
      nextPhase:
        typeof raw.nextPhase === "string" &&
        VALID_PHASES.has(raw.nextPhase as TaskPhase)
          ? (raw.nextPhase as TaskPhase)
          : undefined,
    };
  } catch (err) {
    logger.warn("[ai/assistant] runAssistant failed", {
      error: err instanceof Error ? err.message : String(err),
      capabilityId,
    });
    return null;
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
  const SUGGESTIONS: Record<
    TaskPhase,
    Array<{ id: string; labelKey: string; descKey: string }>
  > = {
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
 * 统一要求 LLM 返回 JSON 格式（content/suggestions/nextPhase），
 * 各能力的差异由 capabilityId 标识，LLM 据此调整输出风格。
 */
function buildCapabilityPrompt(
  capabilityId: string,
  ctx: AssistantContext,
): string {
  return `你是 Corps AI 助理，当前能力：${capabilityId}，任务阶段：${ctx.phase}。
请用 JSON 格式返回：{ "content": "回复内容", "suggestions": ["建议1", "建议2"], "nextPhase": "下一阶段" }
直接返回 JSON，不要 markdown 代码块。`;
}

/** 判断能力是否需要推理模型 */
function needsReasoner(capabilityId: string): boolean {
  return REASONER_CAPS.includes(capabilityId);
}