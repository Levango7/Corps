// POST /api/v1/ai/analysis/burndown — AI 燃尽图分析（非流式）
// 输入：{ wid, period?: { start: string, end: string } }
// 输出：{ code: 200, data: { reportId, summary, idealLine, actualLine, predictedCompletion, deviation, insights } }
//
// 查询工作区任务数据，调用 deepseek-reasoner 生成燃尽图分析 JSON，
// 持久化到 AiAnalysisReport，返回结果。

import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireReasonerModel, withCoT } from "@/lib/ai/deepseek";
import {
  getUserId,
  unauthorizedResponse,
  aiNotConfiguredResponse,
  isAiConfigured,
} from "@/lib/ai/shared";
import { withUsageTracking } from "@/lib/ai/usage-middleware";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  buildBurndownSystemPrompt,
  buildBurndownUserPrompt,
  toBurndownTask,
  type AnalysisPeriod,
} from "@/lib/ai/prompts/burndown-analysis";
import { getFeedbackExamples } from "@/lib/ai/feedback";
import { cleanJsonResponse } from "@/lib/ai/orchestrator";
import { apiMsg } from "@/lib/api-messages";

const schema = z.object({
  wid: z.string().uuid(),
  period: z
    .object({
      start: z.string().datetime(),
      end: z.string().datetime(),
    })
    .optional(),
});

/** 燃尽图分析结果（LLM 输出契约） */
interface BurndownResult {
  summary: string;
  idealLine: { date: string; remaining: number }[];
  actualLine: { date: string; remaining: number }[];
  predictedCompletion: string;
  deviation: string;
  insights: string[];
}

/** 计算默认周期：本周（周一到周日） */
function defaultPeriod(): AnalysisPeriod {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 1=Mon, ...
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((day + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { start: monday, end: sunday };
}

export async function POST(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) AI 服务配置检查
  if (!isAiConfigured()) return aiNotConfiguredResponse(req);

  // 3) 速率限制：每分钟 5 次
  const limited = await checkRateLimit(req, "ai-analysis-burndown", {
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

  // 5) 工作区成员资格认证
  const ctx = await getWorkspaceContext(req, body.wid);
  if (!ctx) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  // 6) 解析周期
  const period: AnalysisPeriod = body.period
    ? { start: new Date(body.period.start), end: new Date(body.period.end) }
    : defaultPeriod();

  // 7) 查询任务数据 + 反馈示例（RLS 事务内）
  const tasks = await runWithWorkspace(
    body.wid,
    (tx) =>
      tx.task.findMany({
        where: {
          deletedAt: null,
          OR: [
            { createdAt: { lte: period.end } },
            { status: { not: "done" } },
          ],
        },
        select: {
          title: true,
          status: true,
          dueDate: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: "asc" },
        take: 500,
      }),
    ctx.payload.sub,
  );

  const feedbackExamples = await getFeedbackExamples(body.wid, "analysis-burndown", 2);

  // 8) LLM 生成燃尽图分析（非流式，withUsageTracking 包装）
  let result: BurndownResult;
  let reportId: string;
  try {
    const generateFn = async () => {
      const llmResult = await generateText({
        model: requireReasonerModel(),
        system: withCoT(buildBurndownSystemPrompt(feedbackExamples), requireReasonerModel()),
        prompt: buildBurndownUserPrompt(tasks.map(toBurndownTask), period),
      });
      return {
        result: llmResult,
        usage: llmResult.usage
          ? {
              inputTokens: llmResult.usage.inputTokens ?? 0,
              outputTokens: llmResult.usage.outputTokens ?? 0,
            }
          : undefined,
      };
    };

    const llmResult = await withUsageTracking(
      {
        workspaceId: body.wid,
        userId: ctx.payload.sub,
        capability: "analysis-burndown",
        model: requireReasonerModel().modelId,
      },
      generateFn,
    );

    const cleaned = cleanJsonResponse(llmResult.text);
    const parsed: unknown = JSON.parse(cleaned);
    if (parsed == null || typeof parsed !== "object") {
      return NextResponse.json(
        { code: 500, message: apiMsg(req, "internalError"), data: null },
        { status: 500 },
      );
    }
    const obj = parsed as Record<string, unknown>;
    result = {
      summary: typeof obj.summary === "string" ? obj.summary : "",
      idealLine: Array.isArray(obj.idealLine) ? (obj.idealLine as BurndownResult["idealLine"]) : [],
      actualLine: Array.isArray(obj.actualLine) ? (obj.actualLine as BurndownResult["actualLine"]) : [],
      predictedCompletion: typeof obj.predictedCompletion === "string" ? obj.predictedCompletion : "",
      deviation: typeof obj.deviation === "string" ? obj.deviation : "",
      insights: Array.isArray(obj.insights) ? (obj.insights as string[]) : [],
    };

    // 9) 持久化到 AiAnalysisReport
    const report = await runWithWorkspace(
      body.wid,
      (tx) =>
        tx.aiAnalysisReport.create({
          data: {
            workspaceId: body.wid,
            userId: ctx.payload.sub,
            type: "burndown",
            title: `燃尽图分析 ${period.start.toISOString().split("T")[0]} ~ ${period.end.toISOString().split("T")[0]}`,
            summary: result.summary,
            data: {
              idealLine: result.idealLine,
              actualLine: result.actualLine,
              predictedCompletion: result.predictedCompletion,
              deviation: result.deviation,
            } as Prisma.InputJsonValue,
            insights: result.insights as Prisma.InputJsonValue,
            period: {
              start: period.start.toISOString(),
              end: period.end.toISOString(),
            } as Prisma.InputJsonValue,
          },
          select: { id: true },
        }),
      ctx.payload.sub,
    );
    reportId = report.id;
  } catch (error) {
    console.error("[ai/analysis/burndown] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }

  // 10) 返回结果
  return NextResponse.json({
    code: 200,
    data: { reportId, ...result },
  });
}