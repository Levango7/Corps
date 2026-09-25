// POST /api/v1/ai/decision-assistant — AI 决策辅助（非流式）
// 输入：{ wid, question, context? }
// 输出：{ code: 200, data: { options, recommendation, historicalRefs } }
// DEEPSEEK_API_KEY 未配置时返回 503。
//
// 认证链顺序（依据 2026-09-16-ai-api-route-auth-chain-order 经验）：
//   getUserId → isAiConfigured → checkRateLimit → zod parse → getWorkspaceContext
// - isAiConfigured 在 checkRateLimit 之前：AI 未配置时所有请求注定 503，不应消耗限流配额
// - checkRateLimit 在 zod parse 之前：超限请求不应再消耗 CPU 解析 body
// - getWorkspaceContext 在最后：含 DB 查询（member.findFirst），是最昂贵的检查

import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { z } from "zod";
import { requireDefaultModel, withCoT } from "@/lib/ai/deepseek";
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
  buildDecisionAssistantSystemPrompt,
  buildDecisionAssistantUserPrompt,
  type DecisionContext,
} from "@/lib/ai/prompts/decision-assistant";
import { cleanJsonResponse } from "@/lib/ai/orchestrator";
import { apiMsg } from "@/lib/api-messages";

const schema = z.object({
  wid: z.string().uuid(),
  question: z.string().min(1).max(2000),
  context: z.string().max(2000).optional(),
});

/** AI 生成的可选方案 */
interface DecisionOption {
  title: string;
  description: string;
  pros: string[];
  cons: string[];
  risks: string[];
}

/** AI 生成的推荐方案 */
interface Recommendation {
  optionIndex: number;
  reason: string;
}

/** AI 生成的历史决策参考 */
interface HistoricalRef {
  title: string;
  outcome: string;
}

/** 决策辅助完整结果 */
interface DecisionAssistantResult {
  options: DecisionOption[];
  recommendation: Recommendation;
  historicalRefs: HistoricalRef[];
}

/** 校验字符串数组：过滤非字符串、trim、截断到 maxLen、最多 maxItems 条 */
function normalizeStringArray(raw: unknown, maxLen: number, maxItems = 10): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.slice(0, maxLen))
    .slice(0, maxItems);
}

/** 校验并规范化 LLM 返回的方案列表，丢弃非法条目 */
function normalizeOptions(raw: unknown): DecisionOption[] {
  if (!Array.isArray(raw)) return [];
  const result: DecisionOption[] = [];
  for (const item of raw) {
    if (item == null || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    if (typeof obj.title !== "string" || !obj.title.trim()) continue;
    result.push({
      // title 截断防超长（与 Task.title VarChar(255) 对齐）
      title: obj.title.slice(0, 255),
      description: typeof obj.description === "string" ? obj.description.slice(0, 1000) : "",
      pros: normalizeStringArray(obj.pros, 100),
      cons: normalizeStringArray(obj.cons, 100),
      risks: normalizeStringArray(obj.risks, 100),
    });
  }
  return result;
}

/** 校验并规范化推荐方案，optionIndex 越界时回退到 0 */
function normalizeRecommendation(raw: unknown, optionCount: number): Recommendation {
  if (raw == null || typeof raw !== "object") {
    return { optionIndex: 0, reason: "" };
  }
  const obj = raw as Record<string, unknown>;
  let optionIndex = typeof obj.optionIndex === "number" ? obj.optionIndex : 0;
  // 索引越界时回退到 0
  if (optionIndex < 0 || optionIndex >= optionCount) optionIndex = 0;
  return {
    optionIndex,
    reason: typeof obj.reason === "string" ? obj.reason.slice(0, 500) : "",
  };
}

/** 校验并规范化历史参考列表 */
function normalizeHistoricalRefs(raw: unknown): HistoricalRef[] {
  if (!Array.isArray(raw)) return [];
  const result: HistoricalRef[] = [];
  for (const item of raw) {
    if (item == null || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    if (typeof obj.title !== "string" || !obj.title.trim()) continue;
    result.push({
      title: obj.title.slice(0, 255),
      outcome: typeof obj.outcome === "string" ? obj.outcome.slice(0, 500) : "",
    });
  }
  return result.slice(0, 10);
}

export async function POST(req: NextRequest) {
  // 1) 基础认证（确认登录身份）
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) AI 服务配置检查（O(1) 纯内存操作，比限流计数廉价）
  if (!isAiConfigured()) return aiNotConfiguredResponse(req);

  // 3) 速率限制：每分钟 10 次（超限请求不应再消耗 CPU 解析 body）
  const limited = await checkRateLimit(req, "ai-decision-assistant", {
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

  // 5) 工作区成员资格认证 + 查询上下文 + LLM 生成
  try {
    // getWorkspaceContext 含 DB 查询（member.findFirst），是最昂贵的检查，放最后
    const ctx = await getWorkspaceContext(req, body.wid);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }

    // 6) 查询工作区上下文（任务、决策历史、项目进度）—— RLS 事务内
    const workspaceContext: DecisionContext = await runWithWorkspace(
      body.wid,
      async (tx) => {
        // 近期任务（最多 20 条，按创建时间倒序，排除软删除）
        const tasks = await tx.task.findMany({
          where: { workspaceId: body.wid, deletedAt: null },
          select: { title: true, status: true, priority: true },
          orderBy: { createdAt: "desc" },
          take: 20,
        });

        // 近期决策历史（最多 10 条，按创建时间倒序）
        const decisions = await tx.decision.findMany({
          where: { workspaceId: body.wid },
          select: {
            markdown: true,
            createdAt: true,
            task: { select: { title: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 10,
        });

        // 项目进度统计（排除软删除任务）
        const [totalTasks, completedTasks, inProgressTasks, blockedTasks] = await Promise.all([
          tx.task.count({
            where: { workspaceId: body.wid, deletedAt: null },
          }),
          tx.task.count({
            where: {
              workspaceId: body.wid,
              status: "done",
              deletedAt: null,
            },
          }),
          tx.task.count({
            where: {
              workspaceId: body.wid,
              status: "in_progress",
              deletedAt: null,
            },
          }),
          tx.task.count({
            where: {
              workspaceId: body.wid,
              blocked: true,
              deletedAt: null,
            },
          }),
        ]);

        return {
          tasks: tasks.map((t) => ({
            title: t.title,
            status: t.status,
            priority: t.priority,
          })),
          decisions: decisions.map((d) => ({
            taskTitle: d.task.title,
            markdown: d.markdown,
            createdAt: d.createdAt.toISOString().slice(0, 10),
          })),
          progress: {
            totalTasks,
            completedTasks,
            inProgressTasks,
            blockedTasks,
          },
        };
      },
      ctx.payload.sub,
    );

    // 7) LLM 生成决策分析（非流式，withUsageTracking 包装记录用量）
    const generateFn = async () => {
      const llmResult = await generateText({
        model: requireDefaultModel(),
        system: withCoT(
          buildDecisionAssistantSystemPrompt(workspaceContext),
          requireDefaultModel(),
        ),
        prompt: buildDecisionAssistantUserPrompt(body.question, body.context),
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
        capability: "decision-assistant",
        model: requireDefaultModel().modelId,
      },
      generateFn,
    );

    // 8) 解析 LLM 返回的 JSON
    let result: DecisionAssistantResult;
    try {
      const cleaned = cleanJsonResponse(llmResult.text);
      const parsed: unknown = JSON.parse(cleaned);
      if (parsed == null || typeof parsed !== "object") {
        return NextResponse.json(
          { code: 500, message: apiMsg(req, "internalError"), data: null },
          { status: 500 },
        );
      }
      const obj = parsed as Record<string, unknown>;
      const options = normalizeOptions(obj.options);
      const recommendation = normalizeRecommendation(
        obj.recommendation,
        Math.max(options.length, 1),
      );
      const historicalRefs = normalizeHistoricalRefs(obj.historicalRefs);
      result = { options, recommendation, historicalRefs };
    } catch (parseError) {
      console.error("[POST ai/decision-assistant] JSON parse error:", parseError);
      return NextResponse.json(
        { code: 500, message: apiMsg(req, "internalError"), data: null },
        { status: 500 },
      );
    }

    // 9) 返回决策分析结果
    return NextResponse.json({
      code: 200,
      data: result,
    });
  } catch (error) {
    console.error("[POST ai/decision-assistant] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}
