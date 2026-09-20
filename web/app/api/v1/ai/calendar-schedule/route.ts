// POST /api/v1/ai/calendar-schedule — AI 日历智能排程（非流式）
// 输入：{ wid, description, duration?, attendees? }
// 输出：{ code: 200, data: { suggestions: ScheduleSuggestion[] } }
//
// 使用 deepseek-reasoner 推理模型，聚合工作区日历/任务/工时上下文，
// 为用户生成 1-3 个避开冲突的会议/事件排程方案。
// DEEPSEEK_API_KEY 未配置时返回 503。

import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { z } from "zod";
import { requireReasonerModel, withCoT } from "@/lib/ai/deepseek";
import {
  getUserId,
  unauthorizedResponse,
  aiNotConfiguredResponse,
  isAiConfigured,
} from "@/lib/ai/shared";
import { withUsageTracking } from "@/lib/ai/usage-middleware";
import {
  buildCalendarSystemPrompt,
  buildCalendarUserPrompt,
} from "@/lib/ai/prompts/calendar-schedule";
import { checkRateLimit } from "@/lib/rate-limit";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { buildAiContext, type AiContextScope } from "@/lib/ai/context";
import { cleanJsonResponse } from "@/lib/ai/orchestrator";
import { apiMsg } from "@/lib/api-messages";

/** 排程上下文聚合范围：今日会议 + 逾期/阻塞任务 + 今日工时 */
const CALENDAR_SCOPES: AiContextScope[] = [
  "meetings:today",
  "tasks:overdue",
  "tasks:blocked",
  "time:today",
];

const schema = z.object({
  wid: z.string().uuid(),
  description: z.string().min(1).max(2000),
  duration: z.number().int().min(5).max(480).optional(),
  attendees: z.array(z.string().max(100)).max(20).optional(),
});

/** 单个排程建议 */
interface ScheduleSuggestion {
  title: string;
  startTime: string;
  endTime: string;
  duration: number;
  reason: string;
  conflicts: string | null;
}

/** AI 排程结果 */
interface CalendarScheduleResult {
  suggestions: ScheduleSuggestion[];
}


/** 校验并规范化 LLM 返回的排程建议列表，丢弃非法条目 */
function normalizeSuggestions(raw: unknown): ScheduleSuggestion[] {
  if (!Array.isArray(raw)) return [];
  const result: ScheduleSuggestion[] = [];
  for (const item of raw) {
    if (item == null || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    if (typeof obj.title !== "string" || !obj.title.trim()) continue;
    if (typeof obj.startTime !== "string" || typeof obj.endTime !== "string") continue;
    result.push({
      // CalendarEvent.title 为 VarChar(200)，截断防超长
      title: obj.title.slice(0, 200),
      startTime: obj.startTime,
      endTime: obj.endTime,
      duration:
        typeof obj.duration === "number" && obj.duration > 0
          ? Math.round(obj.duration)
          : 0,
      reason: typeof obj.reason === "string" ? obj.reason : "",
      conflicts: typeof obj.conflicts === "string" ? obj.conflicts : null,
    });
  }
  return result;
}

export async function POST(req: NextRequest) {
  // 1) 认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) AI 服务配置检查
  if (!isAiConfigured()) return aiNotConfiguredResponse(req);

  // 3) 速率限制：每分钟 5 次（排程为重推理操作，配额低于通用 AI 端点）
  const limited = await checkRateLimit(req, "ai-calendar-schedule", {
    windowMs: 60_000,
    max: 5,
  });
  if (limited) return limited;

  // 4) body 校验
  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await req.json());
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

  // 5) 工作区认证（RLS 成员资格校验）
  const ctx = await getWorkspaceContext(req, body.wid);
  if (!ctx) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  try {
    // 6) 聚合工作区上下文（今日会议 + 逾期/阻塞任务 + 今日工时）
    const context = await runWithWorkspace(
      body.wid,
      (tx) => buildAiContext(body.wid, ctx.payload.sub, CALENDAR_SCOPES, tx),
      ctx.payload.sub,
    );

    // 7) 调用 deepseek-reasoner 生成排程建议（非流式）
    const llmResult = await withUsageTracking(
      {
        workspaceId: body.wid,
        userId: ctx.payload.sub,
        capability: "calendar-schedule",
        model: requireReasonerModel().modelId,
      },
      async () => {
        const res = await generateText({
          model: requireReasonerModel(),
          system: withCoT(buildCalendarSystemPrompt(), requireReasonerModel()),
          prompt: buildCalendarUserPrompt(context, {
            description: body.description,
            duration: body.duration,
            attendees: body.attendees,
          }),
        });
        return {
          result: res,
          usage: res.usage
            ? {
                inputTokens: res.usage.inputTokens ?? 0,
                outputTokens: res.usage.outputTokens ?? 0,
              }
            : undefined,
        };
      },
    );

    // 8) 解析 JSON 返回
    let result: CalendarScheduleResult;
    try {
      const cleaned = cleanJsonResponse(llmResult.text);
      const parsed: unknown = JSON.parse(cleaned);
      if (parsed == null || typeof parsed !== "object") {
        result = { suggestions: [] };
      } else {
        const obj = parsed as Record<string, unknown>;
        result = { suggestions: normalizeSuggestions(obj.suggestions) };
      }
    } catch {
      // JSON 解析失败，返回空建议（不阻断响应，前端展示"暂无建议"）
      result = { suggestions: [] };
    }

    return NextResponse.json({
      code: 200,
      data: result,

    });
  } catch (error) {
    console.error("[POST ai/calendar-schedule] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}