// AI 助理 12 个能力的专门 prompt builder 集合。
//
// 设计要点（参照 web/lib/ai/push-runner.ts 的 PROMPT_BUILDERS 模式）：
// - 每个能力有独立的 buildSystem / buildPrompt，避免 orchestrator 里一个通用 buildCapabilityPrompt
// - buildSystem 返回角色 + 输出 JSON schema + 推理步骤（供 reasonerModel 使用）
// - buildPrompt 返回用户消息 + 可选前序上下文 + 可选对话历史摘要
// - PromptContext 承载 message/phase/taskId/previousOutput/history
//
// 来源：M1-A 后端任务 323（AI 助理深化 — 12 能力专门 prompt builder）

import { taskBreakdownBuilder } from "./task-breakdown";
import { todoExtractBuilder } from "./todo-extract";
import { progressAnomalyBuilder } from "./progress-anomaly";
import { bottleneckAnalysisBuilder } from "./bottleneck-analysis";
import { followUpBuilder } from "./follow-up";
import { decisionAssistantBuilder } from "./decision-assistant";
import { approvalAdviceBuilder } from "./approval-advice";
import { meetingSummaryBuilder } from "./meeting-summary";
import { dailyReportBuilder } from "./daily-report";
import { knowledgeExtractBuilder } from "./knowledge-extract";
import { semanticSearchBuilder } from "./semantic-search";
import { riskAlertBuilder } from "./risk-alert";

/** AI 助理能力 ID 枚举（与 orchestrator VALID_CAPS 白名单一致） */
export type AssistantCapabilityId =
  | "task_breakdown"
  | "todo_extract"
  | "progress_anomaly"
  | "bottleneck_analysis"
  | "follow_up"
  | "decision_assistant"
  | "approval_advice"
  | "meeting_summary"
  | "daily_report"
  | "knowledge_extract"
  | "semantic_search"
  | "risk_alert";

/** prompt 构建器接口 */
export interface CapabilityPromptBuilder {
  /** 构建 system prompt（角色 + 输出格式 + 推理步骤） */
  buildSystem: (ctx: PromptContext) => string;
  /** 构建 user prompt（用户消息 + 前序上下文 + 历史摘要） */
  buildPrompt: (ctx: PromptContext) => string;
}

/** prompt 构建上下文 */
export interface PromptContext {
  /** 用户输入消息 */
  message: string;
  /** 当前任务阶段 */
  phase: string;
  /** 任务 ID（可选，用于标识任务范围） */
  taskId?: string;
  /** 前一步输出（串联上下文） */
  previousOutput?: string;
  /** 对话历史（多轮上下文，按时间正序） */
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

/** 12 个能力的 prompt builder map */
export const ASSISTANT_PROMPT_BUILDERS: Record<AssistantCapabilityId, CapabilityPromptBuilder> = {
  task_breakdown: taskBreakdownBuilder,
  todo_extract: todoExtractBuilder,
  progress_anomaly: progressAnomalyBuilder,
  bottleneck_analysis: bottleneckAnalysisBuilder,
  follow_up: followUpBuilder,
  decision_assistant: decisionAssistantBuilder,
  approval_advice: approvalAdviceBuilder,
  meeting_summary: meetingSummaryBuilder,
  daily_report: dailyReportBuilder,
  knowledge_extract: knowledgeExtractBuilder,
  semantic_search: semanticSearchBuilder,
  risk_alert: riskAlertBuilder,
};

/**
 * 把对话历史拼成摘要字符串（供 buildPrompt 注入）。
 *
 * 最多取最近 6 轮（12 条消息），每条截断至 500 字，避免 prompt 过长。
 *
 * @param history 对话历史（按时间正序）
 * @returns 历史摘要字符串；无历史时返回空串
 */
export function summarizeHistory(
  history?: Array<{ role: "user" | "assistant"; content: string }>,
): string {
  if (!history || history.length === 0) return "";
  // 取最近 12 条（约 6 轮）
  const recent = history.slice(-12);
  const lines = recent.map((m) => {
    const role = m.role === "user" ? "用户" : "助理";
    const content = m.content.length > 500 ? m.content.slice(0, 500) + "…" : m.content;
    return `${role}：${content}`;
  });
  return `【对话历史】\n${lines.join("\n")}`;
}

/**
 * 拼接前序上下文（前一步输出）。
 *
 * @param previousOutput 前一步输出
 * @returns 前序上下文字符串；无则返回空串
 */
export function formatPreviousOutput(previousOutput?: string): string {
  if (!previousOutput) return "";
  // 截断至 4000 字，避免 prompt 过长
  const truncated =
    previousOutput.length > 4000
      ? previousOutput.slice(0, 4000) + "\n[前序上下文已截断]"
      : previousOutput;
  return `【前序上下文】\n${truncated}`;
}
