// POST /api/v1/ai/analysis/weekly-report — AI 自动周报（非流式）
// 输入：{ wid, weekStart?: string }
// 输出：{ code: 200, data: { reportId, summary, completed, planned, risks, milestones, insights } }
//
// 查询本周任务+里程碑数据，调用 deepseek-reasoner 生成结构化周报 JSON，
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
  buildWeeklyReportSystemPrompt,
  buildWeeklyReportUserPrompt,
  toWeeklyTask,
  toWeeklyMilestone,
  type WeekData,
  type WorkspaceContext,
} from "@/lib/ai/prompts/weekly-report";
import { getFeedbackExamples } from "@/lib/ai/feedback";
import { cleanJsonResponse } from "@/lib/ai/orchestrator";
import { apiMsg } from "@/lib/api-messages";

const schema = z.object({
  wid: z.string().uuid(),
  weekStart: z.string().datetime().optional(),
});

/** 周报结果（LLM 输出契约） */
interface WeeklyReportResult {
  summary: string;
  completed: { title: string; owner: string; date: string }[];
  planned: { title: string; owner: string; dueDate: string }[];
  risks: { description: string; level: string }[];
  milestones: { title: string; status: string }[];
  insights: string[];
}

/** 计算本周一 00:00（本地时区） */
function defaultWeekStart(): Date {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((day + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

export async function POST(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) AI 服务配置检查
  if (!isAiConfigured()) return aiNotConfiguredResponse(req);

  // 3) 速率限制：每分钟 5 次
  const limited = await checkRateLimit(req, "ai-analysis-weekly-report", {
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
  const weekStart = body.weekStart ? new Date(body.weekStart) : defaultWeekStart();
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  // 7) 查询工作区 + 任务 + 里程碑 + 反馈示例（RLS 事务内）
  const [workspace, tasks, milestones, memberCount, feedbackExamples] = await Promise.all([
    runWithWorkspace(
      body.wid,
      (tx) => tx.workspace.findUnique({ where: { id: body.wid }, select: { name: true } }),
      ctx.payload.sub,
    ),
    runWithWorkspace(
      body.wid,
      (tx) =>
        tx.task.findMany({
          where: {
            deletedAt: null,
            OR: [
              { updatedAt: { gte: weekStart, lte: weekEnd } },
              { dueDate: { gte: weekStart } },
              { status: { not: "done" } },
            ],
          },
          include: { assignee: { select: { name: true, email: true } } },
          orderBy: { updatedAt: "desc" },
          take: 500,
        }),
      ctx.payload.sub,
    ),
    runWithWorkspace(
      body.wid,
      (tx) =>
        tx.milestone.findMany({
          where: { workspaceId: body.wid },
          include: {
            tasks: { select: { status: true } },
          },
          take: 30,
        }),
      ctx.payload.sub,
    ),
    runWithWorkspace(
      body.wid,
      (tx) => tx.member.count({ where: { workspaceId: body.wid } }),
      ctx.payload.sub,
    ),
    getFeedbackExamples(body.wid, "analysis-weekly-report", 2),
  ]);

  const wsCtx: WorkspaceContext = {
    workspaceName: workspace?.name ?? "工作区",
    memberCount,
  };
  const weekData: WeekData = {
    weekStart,
    weekEnd,
    tasks: tasks.map(toWeeklyTask),
    milestones: milestones.map(toWeeklyMilestone),
  };

  // 8) LLM 生成周报
  let result: WeeklyReportResult;
  let reportId: string;
  try {
    const generateFn = async () => {
      const llmResult = await generateText({
        model: requireReasonerModel(),
        system: withCoT(buildWeeklyReportSystemPrompt(feedbackExamples), requireReasonerModel()),
        prompt: buildWeeklyReportUserPrompt(wsCtx, weekData),
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
        capability: "analysis-weekly-report",
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
      completed: Array.isArray(obj.completed)
        ? (obj.completed as WeeklyReportResult["completed"])
        : [],
      planned: Array.isArray(obj.planned) ? (obj.planned as WeeklyReportResult["planned"]) : [],
      risks: Array.isArray(obj.risks) ? (obj.risks as WeeklyReportResult["risks"]) : [],
      milestones: Array.isArray(obj.milestones)
        ? (obj.milestones as WeeklyReportResult["milestones"])
        : [],
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
            type: "weekly_report",
            title: `周报 ${weekStart.toISOString().split("T")[0]} ~ ${weekEnd.toISOString().split("T")[0]}`,
            summary: result.summary,
            data: {
              completed: result.completed,
              planned: result.planned,
              risks: result.risks,
              milestones: result.milestones,
            } as Prisma.InputJsonValue,
            insights: result.insights as Prisma.InputJsonValue,
            period: {
              start: weekStart.toISOString(),
              end: weekEnd.toISOString(),
            } as Prisma.InputJsonValue,
          },
          select: { id: true },
        }),
      ctx.payload.sub,
    );
    reportId = report.id;
  } catch (error) {
    console.error("[ai/analysis/weekly-report] error:", error);
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
