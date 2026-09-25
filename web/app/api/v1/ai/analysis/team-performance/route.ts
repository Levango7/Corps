// POST /api/v1/ai/analysis/team-performance — AI 团队效能分析（非流式）
// 输入：{ wid, period?: { start: string, end: string } }
// 输出：{ code: 200, data: { reportId, summary, members, insights } }
//
// 查询工作区成员+任务数据，调用 deepseek-reasoner 生成团队效能分析 JSON，
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
  buildTeamPerformanceSystemPrompt,
  buildTeamPerformanceUserPrompt,
  toTeamMember,
  toTeamTask,
  type AnalysisPeriod,
} from "@/lib/ai/prompts/team-performance";
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

/** 团队效能分析结果（LLM 输出契约） */
interface TeamPerformanceResult {
  summary: string;
  members: {
    name: string;
    completionRate: number;
    avgCycleDays: number;
    workload: number;
    strengths: string[];
  }[];
  insights: string[];
}

/** 计算默认周期：本周（周一到周日） */
function defaultPeriod(): AnalysisPeriod {
  const now = new Date();
  const day = now.getDay();
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
  const limited = await checkRateLimit(req, "ai-analysis-team-performance", {
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

  // 7) 查询成员 + 任务数据 + 反馈示例（RLS 事务内）
  const [members, tasks, feedbackExamples] = await Promise.all([
    runWithWorkspace(
      body.wid,
      (tx) =>
        tx.member.findMany({
          where: { workspaceId: body.wid },
          include: { user: { select: { name: true, email: true } } },
          take: 100,
        }),
      ctx.payload.sub,
    ),
    runWithWorkspace(
      body.wid,
      (tx) =>
        tx.task.findMany({
          where: {
            deletedAt: null,
            OR: [
              { createdAt: { gte: period.start, lte: period.end } },
              { updatedAt: { gte: period.start, lte: period.end } },
              { status: { not: "done" } },
            ],
          },
          select: {
            title: true,
            status: true,
            assigneeId: true,
            dueDate: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: { createdAt: "asc" },
          take: 500,
        }),
      ctx.payload.sub,
    ),
    getFeedbackExamples(body.wid, "analysis-team-performance", 2),
  ]);

  // 8) LLM 生成团队效能分析
  let result: TeamPerformanceResult;
  let reportId: string;
  try {
    const generateFn = async () => {
      const llmResult = await generateText({
        model: requireReasonerModel(),
        system: withCoT(buildTeamPerformanceSystemPrompt(feedbackExamples), requireReasonerModel()),
        prompt: buildTeamPerformanceUserPrompt(
          members.map(toTeamMember),
          tasks.map(toTeamTask),
          period,
        ),
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
        capability: "analysis-team-performance",
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
      members: Array.isArray(obj.members) ? (obj.members as TeamPerformanceResult["members"]) : [],
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
            type: "team_performance",
            title: `团队效能分析 ${period.start.toISOString().split("T")[0]} ~ ${period.end.toISOString().split("T")[0]}`,
            summary: result.summary,
            data: { members: result.members } as Prisma.InputJsonValue,
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
    console.error("[ai/analysis/team-performance] error:", error);
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
