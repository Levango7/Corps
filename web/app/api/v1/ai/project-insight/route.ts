// POST /api/v1/ai/project-insight — AI 项目经理洞察（流式）
// 输入：{ wid, scope }
// 输出：text/event-stream（Vercel AI SDK UI Message Stream）
//
// 聚合任务（完成/阻塞/逾期）+ OKR 进度 + 本周工时 + 决策 + 会议上下文，
// 调用 deepseek-reasoner 生成进度分析/风险识别/综合概览/周报四种洞察。

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { reasonerModel, withCoT } from "@/lib/ai/deepseek";
import {
  getUserId,
  unauthorizedResponse,
  aiNotConfiguredResponse,
  isAiConfigured,
} from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { buildAiContext, type AiContextScope } from "@/lib/ai/context";
import { buildProjectInsightSystemPrompts, buildUserPrompt } from "@/lib/ai/prompts/project-insight";
import { apiMsg } from "@/lib/api-messages";
import { createAiProgressStream } from "@/lib/ai/stream";

const schema = z.object({
  wid: z.string().uuid(),
  scope: z.enum(["progress", "risk", "summary", "weekly"]),
});

/** 项目洞察上下文聚合范围：任务（完成/阻塞/逾期）+ OKR + 工时 + 决策 + 会议 */
const INSIGHT_SCOPES: AiContextScope[] = [
  "tasks:completed:today",
  "tasks:blocked",
  "tasks:overdue",
  "okr:progress",
  "time:week",
  "decisions:recent",
  "meetings:today",
];

export async function POST(req: NextRequest) {
  // 1) 基础认证（确认登录身份）
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) AI 服务配置检查
  if (!isAiConfigured()) return aiNotConfiguredResponse(req);

  // 3) 速率限制：每分钟 5 次
  const limited = await checkRateLimit(req, "ai-project-insight", {
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

    // 6) 流式生成洞察（deepseek-reasoner 推理模型，带阶段化进度反馈）
    //    buildPrompt 封装上下文聚合（RLS 事务内），让进度阶段有真实时序
    return createAiProgressStream(
      {
        model: reasonerModel,
        system: withCoT(buildProjectInsightSystemPrompts()[body.scope], reasonerModel),
        buildPrompt: async () => {
          const context = await runWithWorkspace(
            body.wid,
            (tx) => buildAiContext(body.wid, ctx.payload.sub, INSIGHT_SCOPES, tx),
            ctx.payload.sub,
          );
          return buildUserPrompt(context, body.scope);
        },
      },
      {
        context: "正在聚合项目数据…",
        analyzing: "正在分析项目数据…",
        generating: "正在生成洞察报告…",
      },
    );
  } catch (error) {
    console.error("[ai/project-insight] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}