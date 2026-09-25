// POST /api/v1/ai/meeting-summary — AI 生成完整会议纪要（非流式）
// 输入：{ wid, transcript (1-50000), meetingTitle?, sessionId? }
// 输出：{ code: 0, data: { title, keyPoints, decisions, actionItems, participants }, message }
//
// 流程：
//   1. 认证 + AI 配置检查 + 速率限制
//   2. body 校验（transcript 1-50000 字符）
//   3. 工作区认证（RLS 成员资格校验）
//   4. reasonerModel 生成完整纪要（withCoT + withUsageTracking）
//   5. cleanJsonResponse + JSON.parse 解析 JSON 结果
//   6. 规范化提取 title / keyPoints / decisions / actionItems / participants
//   7. 返回纪要
//
// 来源：
//  - 经验 2026-09-15-usage-tracking-per-call-site-integration-by-mode（withUsageTracking 非流式包装）
//  - 经验 2026-09-15-ai-route-streaming-mode-and-model-pairing-rules（reasonerModel + withCoT）
//  - 经验 2026-09-15-ai-route-unified-pattern-audit-checklist（checkRateLimit + try-catch）

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
import { cleanJsonResponse } from "@/lib/ai/orchestrator";
import { getWorkspaceContext } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";
import {
  buildMeetingSummarySystemPrompt,
  buildMeetingSummaryUserPrompt,
} from "@/lib/ai/prompts/meeting-summary";

/** 请求 body schema */
const schema = z.object({
  wid: z.string().uuid(),
  transcript: z.string().min(1).max(50000),
  meetingTitle: z.string().max(200).optional(),
  sessionId: z.string().uuid().optional(),
});

/** 有效的优先级枚举 */
const VALID_PRIORITIES = new Set(["low", "medium", "high", "urgent"]);

/** 规范化后的决策项 */
interface NormalizedDecision {
  title: string;
  description: string;
}

/** 规范化后的待办事项 */
interface NormalizedActionItem {
  title: string;
  assignee: string | null;
  dueDate: string | null;
  priority: "low" | "medium" | "high" | "urgent";
}

/** 规范化后的会议纪要（返回给前端） */
interface MeetingSummary {
  title: string;
  keyPoints: string[];
  decisions: NormalizedDecision[];
  actionItems: NormalizedActionItem[];
  participants: string[];
}

/**
 * 规范化 AI 返回的会议纪要。
 *
 * 校验各字段类型，截断超长字段，丢弃非法条目。
 *
 * @param raw JSON.parse 后的原始对象
 * @returns 规范化后的 MeetingSummary，校验失败返回 null
 */
function normalizeMeetingSummary(raw: unknown): MeetingSummary | null {
  if (raw == null || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  // title：必填字符串，截断至 100
  const title = typeof obj.title === "string" && obj.title.trim() ? obj.title.slice(0, 100) : "";

  // keyPoints：字符串数组，最多 15 条，每条截断至 200
  const keyPoints: string[] = [];
  if (Array.isArray(obj.keyPoints)) {
    for (const point of obj.keyPoints) {
      if (typeof point !== "string" || !point.trim()) continue;
      keyPoints.push(point.slice(0, 200));
      if (keyPoints.length >= 15) break;
    }
  }

  // decisions：数组，最多 20 条
  const decisions: NormalizedDecision[] = [];
  if (Array.isArray(obj.decisions)) {
    for (const item of obj.decisions) {
      if (item == null || typeof item !== "object") continue;
      const d = item as Record<string, unknown>;
      if (typeof d.title !== "string" || !d.title.trim()) continue;
      decisions.push({
        title: d.title.slice(0, 200),
        description: typeof d.description === "string" ? d.description.slice(0, 500) : "",
      });
      if (decisions.length >= 20) break;
    }
  }

  // actionItems：数组，最多 20 条
  const actionItems: NormalizedActionItem[] = [];
  if (Array.isArray(obj.actionItems)) {
    for (const item of obj.actionItems) {
      if (item == null || typeof item !== "object") continue;
      const a = item as Record<string, unknown>;
      if (typeof a.title !== "string" || !a.title.trim()) continue;
      // 校验截止日期格式（YYYY-MM-DD）
      let dueDate: string | null = null;
      if (typeof a.dueDate === "string" && a.dueDate.trim()) {
        const parsed = new Date(a.dueDate);
        if (!isNaN(parsed.getTime())) {
          dueDate = parsed.toISOString().slice(0, 10);
        }
      }
      // 校验优先级
      const priority =
        typeof a.priority === "string" && VALID_PRIORITIES.has(a.priority)
          ? (a.priority as NormalizedActionItem["priority"])
          : "medium";
      actionItems.push({
        title: a.title.slice(0, 200),
        assignee:
          typeof a.assignee === "string" && a.assignee.trim() ? a.assignee.slice(0, 100) : null,
        dueDate,
        priority,
      });
      if (actionItems.length >= 20) break;
    }
  }

  // participants：字符串数组，去重，每个截断至 100
  const participants: string[] = [];
  if (Array.isArray(obj.participants)) {
    const seen = new Set<string>();
    for (const p of obj.participants) {
      if (typeof p !== "string" || !p.trim()) continue;
      const name = p.slice(0, 100);
      if (seen.has(name)) continue;
      seen.add(name);
      participants.push(name);
    }
  }

  return { title, keyPoints, decisions, actionItems, participants };
}

/**
 * POST /api/v1/ai/meeting-summary
 *
 * 接收会议转写文本 → 调用 reasonerModel 生成完整结构化纪要 → 返回。
 */
export async function POST(req: NextRequest) {
  // 1) 认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) AI 服务配置检查
  if (!isAiConfigured()) return aiNotConfiguredResponse(req);

  // 3) 速率限制：每分钟 10 次
  const limited = await checkRateLimit(req, "ai-meeting-summary", {
    windowMs: 60_000,
    max: 10,
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

  // 5) 工作区守卫（RLS 成员资格校验）
  const ctx = await getWorkspaceContext(req, body.wid);
  if (!ctx) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  try {
    // 6) withUsageTracking 包装 AI 调用（reasonerModel，非流式）
    const systemPrompt = withCoT(buildMeetingSummarySystemPrompt(), requireReasonerModel());
    const userPrompt = buildMeetingSummaryUserPrompt(body.transcript, body.meetingTitle);

    const summary = await withUsageTracking(
      {
        workspaceId: body.wid,
        userId: ctx.payload.sub,
        capability: "meeting-summary",
        model: requireReasonerModel().modelId,
      },
      async () => {
        const llmResult = await generateText({
          model: requireReasonerModel(),
          system: systemPrompt,
          prompt: userPrompt,
        });

        // 解析 JSON 结果
        const cleaned = cleanJsonResponse(llmResult.text);
        let parsed: unknown;
        try {
          parsed = JSON.parse(cleaned);
        } catch (e) {
          console.error("[ai/meeting-summary] JSON.parse 失败:", e, "raw:", cleaned.slice(0, 200));
          throw new Error("AI 返回结果解析失败", { cause: e });
        }

        const normalized = normalizeMeetingSummary(parsed);
        if (!normalized) {
          throw new Error("AI 返回结果规范化失败");
        }

        return {
          result: normalized,
          usage: llmResult.usage
            ? {
                inputTokens: llmResult.usage.inputTokens ?? 0,
                outputTokens: llmResult.usage.outputTokens ?? 0,
              }
            : undefined,
        };
      },
    );

    // 7) 返回纪要
    return NextResponse.json({
      code: 0,
      data: summary,
      message: apiMsg(req, "ok"),
    });
  } catch (error) {
    console.error("[POST ai/meeting-summary] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}
