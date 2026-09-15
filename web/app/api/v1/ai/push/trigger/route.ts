// POST /api/v1/ai/push/trigger — 手动触发 AI 推送
//
// 输入：{ wid, capability, scheduleId? }
// 流程：
//   1. 认证 + AI 配置检查 + 速率限制
//   2. 根据 capability 选择 prompt 模板 + 上下文聚合 scopes + 模型
//   3. 在 RLS 事务内聚合上下文
//   4. withUsageTracking 包装 generateText（非流式）
//   5. cleanJsonResponse + JSON.parse 解析 JSON 结果
//   6. 提取 title/summary/detail，创建 AiPushRecord
//   7. 可选更新 AiPushSchedule.lastRunAt
//
// 来源：
//  - 经验 2026-09-15-usage-tracking-per-call-site-integration-by-mode（withUsageTracking 非流式包装）
//  - 经验 2026-09-15-ai-route-streaming-mode-and-model-pairing-rules（非流式 + 模型选择）

import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { defaultModel, reasonerModel, withCoT } from "@/lib/ai/deepseek";
import {
  getUserId,
  unauthorizedResponse,
  aiNotConfiguredResponse,
  isAiConfigured,
} from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
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
import { apiMsg } from "@/lib/api-messages";

/** 推送能力枚举 */
const CAPABILITIES = ["daily_briefing", "risk_alert", "progress_anomaly"] as const;
type PushCapability = (typeof CAPABILITIES)[number];

const triggerSchema = z.object({
  wid: z.string().uuid(),
  capability: z.enum(CAPABILITIES),
  /** 关联的推送计划 ID（AiPushRecord.scheduleId 为必填外键） */
  scheduleId: z.string().uuid(),
});

/** 各 capability 的上下文聚合范围 */
const SCOPES_BY_CAPABILITY: Record<PushCapability, AiContextScope[]> = {
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
const PROMPT_BUILDERS: Record<
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
function safeSlice(s: string, max: number): string {
  return Array.from(s).slice(0, max).join("");
}

/** 从 LLM JSON 输出中提取 title/summary，校验类型并截断至 DB 列长度限制 */
function extractPushContent(
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

/** POST /api/v1/ai/push/trigger — 手动触发推送 */
export async function POST(req: NextRequest) {
  // 1) 认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) AI 配置检查
  if (!isAiConfigured()) return aiNotConfiguredResponse(req);

  // 3) 速率限制：每分钟 5 次（AI 调用较重）
  const limited = await checkRateLimit(req, "ai-push-trigger", {
    windowMs: 60_000,
    max: 5,
  });
  if (limited) return limited;

  // 4) body 校验
  let body: z.infer<typeof triggerSchema>;
  try {
    body = triggerSchema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        {
          code: 400,
          message: e.issues[0]?.message ?? apiMsg(req, "validationFailed"),
          data: null,
        },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "invalidBody"), data: null },
      { status: 400 },
    );
  }

  // 5) 工作区守卫
  const ctx = await getWorkspaceContext(req, body.wid);
  if (!ctx) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  const builder = PROMPT_BUILDERS[body.capability];
  const scopes = SCOPES_BY_CAPABILITY[body.capability];
  const model = builder.useReasoner ? reasonerModel : defaultModel;

  try {
    // 6) 在 RLS 事务内聚合上下文
    const contextStr = await runWithWorkspace(
      body.wid,
      (tx) => buildAiContext(body.wid, ctx.payload.sub, scopes, tx),
      ctx.payload.sub,
    );
    const wsCtx: WorkspaceContext = {
      context: contextStr,
      workspaceId: body.wid,
      userId: ctx.payload.sub,
    };

    // 7) withUsageTracking 包装 generateText（非流式）
    const systemPrompt = withCoT(builder.buildSystem(wsCtx), model);
    const userPrompt = builder.buildUser(wsCtx);

    const llmResult = await withUsageTracking(
      {
        workspaceId: body.wid,
        userId: ctx.payload.sub,
        capability: `push-${body.capability}`,
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

    // 8) 解析 JSON 结果
    const cleaned = cleanJsonResponse(llmResult.text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error(
        "[ai/push/trigger] JSON.parse 失败:",
        e,
        "raw:",
        cleaned.slice(0, 200),
      );
      return NextResponse.json(
        { code: 500, message: apiMsg(req, "internalError"), data: null },
        { status: 500 },
      );
    }

    const content = extractPushContent(parsed, body.capability);
    if (!content) {
      return NextResponse.json(
        { code: 500, message: apiMsg(req, "internalError"), data: null },
        { status: 500 },
      );
    }

    // 9) 创建 AiPushRecord + 更新 schedule.lastRunAt
    //    先校验 schedule 归属当前用户（外键约束 + 权限）
    const schedule = await runWithWorkspace(
      body.wid,
      (tx) =>
        tx.aiPushSchedule.findFirst({
          where: {
            id: body.scheduleId,
            workspaceId: body.wid,
            userId: ctx.payload.sub,
          },
          select: { id: true },
        }),
      ctx.payload.sub,
    );
    if (!schedule) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "workspaceNotFound"), data: null },
        { status: 404 },
      );
    }

    const record = await runWithWorkspace(
      body.wid,
      async (tx) => {
        const rec = await tx.aiPushRecord.create({
          data: {
            scheduleId: body.scheduleId,
            workspaceId: body.wid,
            userId: ctx.payload.sub,
            capability: body.capability,
            title: content.title,
            summary: content.summary,
            detail: content.detail,
          },
        });

        // 更新 schedule.lastRunAt（失败不影响记录创建）
        await tx.aiPushSchedule
          .update({
            where: { id: body.scheduleId },
            data: { lastRunAt: new Date() },
          })
          .catch((e: unknown) => {
            console.warn(
              "[ai/push/trigger] 更新 schedule.lastRunAt 失败:",
              e instanceof Error ? e.message : e,
            );
          });

        return rec;
      },
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 200, data: record }, { status: 201 });
  } catch (error) {
    console.error("[POST ai/push/trigger] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}