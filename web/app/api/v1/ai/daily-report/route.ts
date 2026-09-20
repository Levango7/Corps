// POST /api/v1/ai/daily-report — AI 智能日报（流式）
// 输入：{ wid, date?, userId? }
// 输出：text/event-stream（Vercel AI SDK UI Message Stream）
//
// 聚合当日任务/文档/会议/审批/工时/Wiki 上下文，调用 deepseek-chat 生成结构化日报。

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireDefaultModel, withCoT } from "@/lib/ai/deepseek";
import {
  getUserId,
  unauthorizedResponse,
  aiNotConfiguredResponse,
  isAiConfigured,
} from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { buildAiContext, type AiContextScope } from "@/lib/ai/context";
import { buildDailyReportSystemPrompt, buildUserPrompt } from "@/lib/ai/prompts/daily-report";
import { getFeedbackExamples } from "@/lib/ai/feedback";
import { apiMsg } from "@/lib/api-messages";
import { createAiProgressStream } from "@/lib/ai/stream";

const schema = z.object({
  wid: z.string().uuid(),
  date: z.string().datetime().optional(),
  userId: z.string().uuid().optional(),
});

/** 日报上下文聚合范围：当日完成/编辑/会议/审批/工时/Wiki */
const DAILY_SCOPES: AiContextScope[] = [
  "tasks:completed:today",
  "documents:edited:today",
  "meetings:today",
  "approvals:handled:today",
  "time:today",
  "wiki:edited:today",
];

export async function POST(req: NextRequest) {
  // 1) 基础认证（确认登录身份）
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) AI 服务配置检查
  if (!isAiConfigured()) return aiNotConfiguredResponse(req);

  // 3) 速率限制：每分钟 5 次
  const limited = await checkRateLimit(req, "ai-daily-report", {
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

  // 5) 工作区成员资格认证（wid 守卫 + RLS）+ 上下文聚合 + 流式生成
  try {
    const ctx = await getWorkspaceContext(req, body.wid);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }

    // 6) 聚合上下文：body.userId 可选覆盖（如管理员查看他人日报），默认当前用户
    //    越权防护：仅 owner/admin 可查看他人日报
    let targetUserId = ctx.payload.sub;
    if (body.userId && body.userId !== ctx.payload.sub) {
      if (ctx.member.role !== "owner" && ctx.member.role !== "admin") {
        return NextResponse.json(
          { code: 403, message: apiMsg(req, "forbidden"), data: null },
          { status: 403 },
        );
      }
      targetUserId = body.userId;
    }

    // 7) 查询正面反馈作为 few-shot 示例（复用 RLS 事务）
    const feedbackExamples = await runWithWorkspace(
      body.wid,
      (tx) => getFeedbackExamples(body.wid, "daily-report", 2, tx),
      ctx.payload.sub,
    );

    // 8) 流式生成日报（带阶段化进度反馈）
    //    buildPrompt 封装上下文聚合，让进度阶段有真实时序：
    //    阶段 1（聚合数据）→ buildPrompt → 阶段 2（分析）→ 阶段 3（生成）→ LLM 文本流
    return createAiProgressStream(
      {
        model: requireDefaultModel(),
        system: withCoT(buildDailyReportSystemPrompt(feedbackExamples), requireDefaultModel()),
        buildPrompt: async () => {
          const context = await runWithWorkspace(
            body.wid,
            (tx) => buildAiContext(body.wid, targetUserId, DAILY_SCOPES, tx),
            ctx.payload.sub,
          );
          return buildUserPrompt(context, { date: body.date });
        },
        usageTracking: {
          workspaceId: body.wid,
          userId: ctx.payload.sub,
          capability: "daily-report",
          model: requireDefaultModel().modelId,
        },
      },
      {
        context: "正在聚合日报数据…",
        analyzing: "正在分析数据…",
        generating: "正在生成日报…",
      },
    );
  } catch (error) {
    console.error("[ai/daily-report] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}