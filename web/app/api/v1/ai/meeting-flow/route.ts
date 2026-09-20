// POST /api/v1/ai/meeting-flow — AI 会议全流程
// 会前阶段（phase: "pre"）：deepseek-reasoner 生成议程建议
// 会后阶段（phase: "post"）：deepseek-chat 生成会议纪要摘要
// 决策提取和行动项生成由前端调用现有 /decisions/extract 和 /action-items/generate 端点完成。

import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { z } from "zod";
import { requireDefaultModel, requireReasonerModel, withCoT } from "@/lib/ai/deepseek";
import {
  getUserId,
  unauthorizedResponse,
  aiNotConfiguredResponse,
  isAiConfigured,
} from "@/lib/ai/shared";
import { withUsageTracking } from "@/lib/ai/usage-middleware";
import { getWorkspaceContext } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { cleanJsonResponse } from "@/lib/ai/orchestrator";
import { apiMsg } from "@/lib/api-messages";
import {
  buildPreMeetingSystemPrompt,
  buildPostMeetingSystemPrompt,
  buildPreMeetingPrompt,
  buildPostMeetingPrompt,
} from "@/lib/ai/prompts/meeting-flow";

const schema = z.object({
  phase: z.enum(["pre", "post"]),
  wid: z.string().uuid(),
  agenda: z.string().max(5000).optional(),
  participants: z.array(z.string()).optional(),
  transcript: z.string().max(20000).optional(),
  meetingId: z.string().uuid().optional(),
});


export async function POST(req: NextRequest) {
  // 1) 认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) AI 服务配置检查
  if (!isAiConfigured()) return aiNotConfiguredResponse(req);

  // 3) 速率限制：每分钟 3 次
  const rateLimited = await checkRateLimit(req, "ai-meeting-flow", {
    windowMs: 60_000,
    max: 3,
  });
  if (rateLimited) return rateLimited;

  // 4) body 校验
  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: e.issues[0]?.message ?? apiMsg(req, "validationFailed"), data: null },
        { status: 400 },
      );
    }
    return NextResponse.json({ code: 400, message: apiMsg(req, "invalidBody"), data: null }, { status: 400 });
  }

  // 5) 工作区认证（wid 守卫 + 成员资格）
  const ctx = await getWorkspaceContext(req, body.wid);
  if (!ctx) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }
  if (!["owner", "admin", "member"].includes(ctx.member.role)) {
    return NextResponse.json(
      { code: 403, message: apiMsg(req, "noPermission"), data: null },
      { status: 403 },
    );
  }

  // 6) 分阶段处理
  if (body.phase === "pre") {
    // 会前阶段：用 deepseek-reasoner 生成议程建议
    if (!body.agenda) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "validationFailed"), data: null },
        { status: 400 },
      );
    }

    try {
      const result = await withUsageTracking(
        {
          workspaceId: body.wid,
          userId: ctx.payload.sub,
          capability: "meeting-flow",
          model: requireReasonerModel().modelId,
        },
        async () => {
          const res = await generateText({
            model: requireReasonerModel(),
            system: withCoT(buildPreMeetingSystemPrompt(), requireReasonerModel()),
            prompt: buildPreMeetingPrompt({
              agenda: body.agenda!,
              participants: body.participants,
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

      // 解析 LLM 返回的 JSON（降级处理：解析失败返回默认值而非 500）
      const cleaned = cleanJsonResponse(result.text);
      let parsed: { suggestedAgenda?: string; suggestedDuration?: number; expectedOutputs?: unknown };
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        parsed = { suggestedAgenda: "", suggestedDuration: 30, expectedOutputs: [] };
      }

      return NextResponse.json({
        code: 200,
        data: {
          suggestedAgenda: typeof parsed.suggestedAgenda === "string" ? parsed.suggestedAgenda : "",
          suggestedDuration: typeof parsed.suggestedDuration === "number" ? parsed.suggestedDuration : 30,
          expectedOutputs: Array.isArray(parsed.expectedOutputs)
            ? parsed.expectedOutputs.filter((x: unknown) => typeof x === "string")
            : [],
        },
      });
    } catch (error) {
      console.error("[POST ai/meeting-flow] pre-phase error:", error);
      return NextResponse.json(
        { code: 500, message: apiMsg(req, "internalError"), data: null },
        { status: 500 },
      );
    }
  }

  // 会后阶段：用 deepseek-chat 生成会议纪要
  if (!body.transcript) {
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "validationFailed"), data: null },
      { status: 400 },
    );
  }

  try {
    const result = await withUsageTracking(
      {
        workspaceId: body.wid,
        userId: ctx.payload.sub,
          capability: "meeting-flow",
          model: requireDefaultModel().modelId,
      },
      async () => {
        const res = await generateText({
            model: requireDefaultModel(),
            system: withCoT(buildPostMeetingSystemPrompt(), requireDefaultModel()),
          prompt: buildPostMeetingPrompt(body.transcript!),
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

    // 会后阶段只生成纪要摘要；决策提取和行动项生成由前端调用现有端点完成
    return NextResponse.json({
      code: 200,
      data: {
        summary: result.text,
        decisions: [],
        actionItems: [],
      },
    });
  } catch (error) {
    console.error("[POST ai/meeting-flow] post-phase error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}