// POST /api/v1/ai/analysis/bottleneck — AI 瓶颈分析（非流式）
// 输入：{ wid }
// 输出：{ code: 200, data: { reportId, summary, bottlenecks, criticalPath, insights } }
//
// 查询工作区任务+依赖数据，调用 deepseek-reasoner 识别瓶颈任务与关键路径，
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
  buildBottleneckSystemPrompt,
  buildBottleneckUserPrompt,
  toBottleneckTask,
  toTaskDepFromEdge,
  type TaskDep,
} from "@/lib/ai/prompts/bottleneck-analysis";
import { getFeedbackExamples } from "@/lib/ai/feedback";
import { cleanJsonResponse } from "@/lib/ai/orchestrator";
import { apiMsg } from "@/lib/api-messages";

const schema = z.object({
  wid: z.string().uuid(),
});

/** 瓶颈分析结果（LLM 输出契约） */
interface BottleneckResult {
  summary: string;
  bottlenecks: {
    taskTitle: string;
    reason: string;
    impact: string;
    suggestion: string;
  }[];
  criticalPath: string[];
  insights: string[];
}

export async function POST(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) AI 服务配置检查
  if (!isAiConfigured()) return aiNotConfiguredResponse(req);

  // 3) 速率限制：每分钟 5 次
  const limited = await checkRateLimit(req, "ai-analysis-bottleneck", {
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

  // 6) 查询任务 + 知识图谱依赖（RLS 事务内）
  const [tasks, taskNodes, edges, feedbackExamples] = await Promise.all([
    runWithWorkspace(
      body.wid,
      (tx) =>
        tx.task.findMany({
          where: { deletedAt: null },
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            assigneeId: true,
            dueDate: true,
            blocked: true,
            blockedReason: true,
            parentId: true,
            milestoneId: true,
          },
          orderBy: { createdAt: "asc" },
          take: 500,
        }),
      ctx.payload.sub,
    ),
    runWithWorkspace(
      body.wid,
      (tx) =>
        tx.knowledgeNode.findMany({
          where: { workspaceId: body.wid, sourceType: "task" },
          select: { id: true, sourceId: true },
        }),
      ctx.payload.sub,
    ),
    runWithWorkspace(
      body.wid,
      (tx) =>
        tx.knowledgeEdge.findMany({
          where: { workspaceId: body.wid, relation: "depends_on" },
          select: {
            sourceNodeId: true,
            targetNodeId: true,
            relation: true,
          },
          take: 500,
        }),
      ctx.payload.sub,
    ),
    getFeedbackExamples(body.wid, "analysis-bottleneck", 2),
  ]);

  // 7) 构造任务依赖列表：KnowledgeEdge(depends_on) + 父子任务关系
  const sourceMap = new Map(taskNodes.map((n) => [n.id, n.sourceId]));
  const targetMap = new Map(taskNodes.map((n) => [n.id, n.sourceId]));
  const deps: TaskDep[] = [];
  for (const edge of edges) {
    const dep = toTaskDepFromEdge(edge, sourceMap, targetMap);
    if (dep) deps.push(dep);
  }
  for (const t of tasks) {
    if (t.parentId) {
      deps.push({ sourceTaskId: t.parentId, targetTaskId: t.id, relation: "parent_of" });
    }
  }

  // 8) LLM 生成瓶颈分析
  let result: BottleneckResult;
  let reportId: string;
  try {
    const generateFn = async () => {
      const llmResult = await generateText({
        model: requireReasonerModel(),
        system: withCoT(buildBottleneckSystemPrompt(feedbackExamples), requireReasonerModel()),
        prompt: buildBottleneckUserPrompt(tasks.map(toBottleneckTask), deps),
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
        capability: "analysis-bottleneck",
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
      bottlenecks: Array.isArray(obj.bottlenecks)
        ? (obj.bottlenecks as BottleneckResult["bottlenecks"])
        : [],
      criticalPath: Array.isArray(obj.criticalPath) ? (obj.criticalPath as string[]) : [],
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
            type: "bottleneck",
            title: `瓶颈分析 ${new Date().toISOString().split("T")[0]}`,
            summary: result.summary,
            data: {
              bottlenecks: result.bottlenecks,
              criticalPath: result.criticalPath,
            } as Prisma.InputJsonValue,
            insights: result.insights as Prisma.InputJsonValue,
          },
          select: { id: true },
        }),
      ctx.payload.sub,
    );
    reportId = report.id;
  } catch (error) {
    console.error("[ai/analysis/bottleneck] error:", error);
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
