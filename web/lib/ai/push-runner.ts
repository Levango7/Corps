// AI 主动推送共享执行器
//
// 从 web/app/api/v1/ai/push/trigger/route.ts 抽取的共享逻辑：
//   - CAPABILITIES / PushCapability / SCOPES_BY_CAPABILITY / PROMPT_BUILDERS
//   - safeSlice / extractPushContent
//   - generatePush（核心生成函数，供手动触发 + cron 自动执行器复用）
//
// 设计要点：
//   - generatePush 接受可选 tx 参数：传入则复用调用方事务（cron 跨工作区场景），
//     不传则内部用 runWithWorkspace 自建 RLS 事务（手动触发场景）。
//   - 失败时 logger.warn 并返回 null，不抛异常（cron 容错：单 schedule 失败不中断整体）。
//   - 用 logger 而非 console，统一结构化日志。
//
// 来源：
//  - 经验 2026-09-15-usage-tracking-per-call-site-integration-by-mode（withUsageTracking 非流式包装）
//  - 经验 2026-09-15-ai-route-streaming-mode-and-model-pairing-rules（非流式 + 模型选择）

import { generateText } from "ai";
import type { Prisma } from "@prisma/client";
import { requireDefaultModel, requireReasonerModel, withCoT } from "@/lib/ai/deepseek";
import { runWithWorkspace } from "@/lib/auth";
import { withUsageTracking } from "@/lib/ai/usage-middleware";
import { buildAiContext, type AiContextScope } from "@/lib/ai/context";
import { cleanJsonResponse } from "@/lib/ai/orchestrator";
import {
  buildDailyBriefingPrompt,
  buildDailyBriefingUserPrompt,
  type WorkspaceContext,
} from "@/lib/ai/prompts/daily-briefing";
import {
  buildRiskAlertPrompt,
  buildRiskAlertUserPrompt,
} from "@/lib/ai/prompts/risk-alert";
import {
  buildProgressAnomalyPrompt,
  buildProgressAnomalyUserPrompt,
} from "@/lib/ai/prompts/progress-anomaly";
import { logger } from "@/lib/logger";

/** 推送能力枚举 */
export const CAPABILITIES = [
  "daily_briefing",
  "risk_alert",
  "progress_anomaly",
] as const;
export type PushCapability = (typeof CAPABILITIES)[number];

/** 各 capability 的上下文聚合范围 */
export const SCOPES_BY_CAPABILITY: Record<PushCapability, AiContextScope[]> = {
  daily_briefing: [
    "tasks:created:today",
    "tasks:high:priority",
    "meetings:today",
    "meetings:upcoming",
    "im:unread",
    "time:today",
  ],
  risk_alert: [
    "tasks:overdue",
    "tasks:blocked",
    "okr:at:risk",
    "okr:progress",
    "approvals:overdue",
  ],
  progress_anomaly: [
    "okr:progress",
    "time:week",
    "tasks:completed:today",
    "tasks:created:today",
  ],
};

/** 各 capability 的 prompt builder（system + user） */
export const PROMPT_BUILDERS: Record<
  PushCapability,
  {
    buildSystem: (ctx: WorkspaceContext) => string;
    buildUser: (ctx: WorkspaceContext) => string;
    /** 是否使用推理模型 */
    useReasoner: boolean;
  }
> = {
  daily_briefing: {
    buildSystem: buildDailyBriefingPrompt,
    buildUser: buildDailyBriefingUserPrompt,
    useReasoner: false,
  },
  risk_alert: {
    buildSystem: buildRiskAlertPrompt,
    buildUser: buildRiskAlertUserPrompt,
    useReasoner: true,
  },
  progress_anomaly: {
    buildSystem: buildProgressAnomalyPrompt,
    buildUser: buildProgressAnomalyUserPrompt,
    useReasoner: true,
  },
};

/** 安全截断字符串至指定长度（按 Unicode 码点，避免截断 emoji 代理对） */
export function safeSlice(s: string, max: number): string {
  return Array.from(s).slice(0, max).join("");
}

/** 从 LLM JSON 输出中提取 title/summary，校验类型并截断至 DB 列长度限制 */
export function extractPushContent(
  raw: unknown,
  capability: PushCapability,
): { title: string; summary: string; detail: Prisma.InputJsonValue } | null {
  if (raw == null || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const title =
    typeof obj.title === "string" && obj.title.trim()
      ? safeSlice(obj.title, 200)
      : `${capability} 推送`;
  const summary =
    typeof obj.summary === "string" ? safeSlice(obj.summary, 5000) : "";

  return { title, summary, detail: obj as Prisma.InputJsonValue };
}

/**
 * 生成 AI 推送内容并落库（AiPushRecord + 更新 schedule.lastRunAt）。
 *
 * 供两条调用路径复用：
 *   - 手动触发（POST /api/v1/ai/push/trigger）：不传 tx，内部用 runWithWorkspace 自建 RLS 事务。
 *   - cron 自动执行器（GET /api/cron/ai-push-runner）：不传 tx（每个 schedule 独立 RLS 事务，
 *     避免跨工作区串行失败传染）。
 *
 * 失败时 logger.warn 并返回 null，不抛异常——调用方可据返回值决定是否创建通知。
 *
 * @returns { title, summary, detail, recordId } 或 null（LLM 输出无效 / 落库失败）
 */
export async function generatePush(opts: {
  capability: PushCapability;
  workspaceId: string;
  userId: string;
  scheduleId: string;
  tx?: Prisma.TransactionClient;
}): Promise<{
  title: string;
  summary: string;
  detail: Prisma.InputJsonValue;
  recordId: string;
} | null> {
  const { capability, workspaceId, userId, scheduleId, tx } = opts;

  const builder = PROMPT_BUILDERS[capability];
  const scopes = SCOPES_BY_CAPABILITY[capability];
  const model = builder.useReasoner ? requireReasonerModel() : requireDefaultModel();

  try {
    // 1) 聚合上下文：传了 tx 复用调用方事务；否则用 runWithWorkspace 自建 RLS 事务
    const contextStr = tx
      ? await buildAiContext(workspaceId, userId, scopes, tx)
      : await runWithWorkspace(
          workspaceId,
          (tx2) => buildAiContext(workspaceId, userId, scopes, tx2),
          userId,
        );

    const wsCtx: WorkspaceContext = {
      context: contextStr,
      workspaceId,
      userId,
    };

    // 2) 构建 prompt（withCoT 仅对推理模型注入思维链引导）
    const systemPrompt = withCoT(builder.buildSystem(wsCtx), model);
    const userPrompt = builder.buildUser(wsCtx);

    // 3) withUsageTracking 包装 generateText（非流式 + 用量记账）
    const llmResult = await withUsageTracking(
      {
        workspaceId,
        userId,
        capability: `push-${capability}`,
        model: model.modelId,
      },
      async () => {
        const result = await generateText({
          model,
          system: systemPrompt,
          prompt: userPrompt,
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

    // 4) 解析 JSON 结果
    const cleaned = cleanJsonResponse(llmResult.text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      logger.warn("[ai/push-runner] JSON.parse 失败", {
        error: e instanceof Error ? e.message : String(e),
        raw: cleaned.slice(0, 200),
        capability,
        workspaceId,
      });
      return null;
    }

    // 5) 提取 title/summary/detail
    const content = extractPushContent(parsed, capability);
    if (!content) {
      logger.warn("[ai/push-runner] extractPushContent 返回 null", {
        capability,
        workspaceId,
      });
      return null;
    }

    // 6) 创建 AiPushRecord + 更新 schedule.lastRunAt
    //    传了 tx 复用调用方事务；否则用 runWithWorkspace 自建 RLS 事务
    const createRecord = async (tx2: Prisma.TransactionClient) => {
      const rec = await tx2.aiPushRecord.create({
        data: {
          scheduleId,
          workspaceId,
          userId,
          capability,
          title: content.title,
          summary: content.summary,
          detail: content.detail,
        },
      });

      // 更新 schedule.lastRunAt（失败不影响记录创建）
      await tx2.aiPushSchedule
        .update({
          where: { id: scheduleId },
          data: { lastRunAt: new Date() },
        })
        .catch((e: unknown) => {
          logger.warn("[ai/push-runner] 更新 schedule.lastRunAt 失败", {
            error: e instanceof Error ? e.message : String(e),
            scheduleId,
          });
        });

      return rec;
    };

    const record = tx
      ? await createRecord(tx)
      : await runWithWorkspace(workspaceId, createRecord, userId);

    return {
      title: content.title,
      summary: content.summary,
      detail: content.detail,
      recordId: record.id,
    };
  } catch (error) {
    logger.warn("[ai/push-runner] generatePush 失败", {
      error: error instanceof Error ? error.message : String(error),
      capability,
      workspaceId,
      scheduleId,
    });
    return null;
  }
}