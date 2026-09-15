// POST /api/v1/ai/task-breakdown — AI 任务拆解（非流式）
// 输入：{ taskTitle, taskDescription?, context? }
// 输出：{ code: 200, data: { subtasks: Subtask[], reasoning: string } }
// DEEPSEEK_API_KEY 未配置时返回 503。

import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { z } from "zod";
import { defaultModel, withCoT } from "@/lib/ai/deepseek";
import {

  getUserIdAndWorkspaceId,
  unauthorizedResponse,
  aiNotConfiguredResponse,
  isAiConfigured,
} from "@/lib/ai/shared";
import { withUsageTracking } from "@/lib/ai/usage-middleware";
import { buildTaskBreakdownSystemPrompt, buildUserPrompt } from "@/lib/ai/prompts/task-breakdown";
import { getFeedbackExamples } from "@/lib/ai/feedback";
import { checkRateLimit } from "@/lib/rate-limit";
import { cleanJsonResponse } from "@/lib/ai/orchestrator";
import { apiMsg } from "@/lib/api-messages";

const schema = z.object({
  taskTitle: z.string().min(1).max(200),
  taskDescription: z.string().max(5000).optional(),
  context: z.string().max(2000).optional(),
});

interface Subtask {
  title: string;
  description: string;
  estimatedHours: number;
  priority: "low" | "medium" | "high" | "urgent";
  suggestedAssignee: string | null;
}

interface TaskBreakdownResult {
  subtasks: Subtask[];
  reasoning: string;
}


/** 校验并规范化 LLM 返回的子任务列表，丢弃非法条目 */
function normalizeSubtasks(raw: unknown): Subtask[] {
  if (!Array.isArray(raw)) return [];
  const validPriorities = new Set(["low", "medium", "high", "urgent"]);
  const result: Subtask[] = [];
  for (const item of raw) {
    if (item == null || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    if (typeof obj.title !== "string" || !obj.title.trim()) continue;
    const priority =
      typeof obj.priority === "string" && validPriorities.has(obj.priority)
        ? (obj.priority as Subtask["priority"])
        : "medium";
    result.push({
      // Task.title 为 VarChar(255)，截断防超长
      title: obj.title.slice(0, 255),
      description: typeof obj.description === "string" ? obj.description : "",
      estimatedHours:
        typeof obj.estimatedHours === "number" && obj.estimatedHours > 0
          ? obj.estimatedHours
          : 0,
      priority,
      suggestedAssignee:
        typeof obj.suggestedAssignee === "string" ? obj.suggestedAssignee : null,
    });
  }
  return result;
}

export async function POST(req: NextRequest) {
  // 1) 认证 + 获取 workspaceId（用于 usage tracking）
  const authCtx = await getUserIdAndWorkspaceId(req);
  if (!authCtx) return unauthorizedResponse(req);
  const userId = authCtx.userId;

  // 2) AI 服务配置检查
  if (!isAiConfigured()) return aiNotConfiguredResponse(req);

  // 3) 速率限制：每分钟 10 次
  const limited = await checkRateLimit(req, "ai-task-breakdown", {
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

  // 5) LLM 生成子任务（非流式）
  let result: TaskBreakdownResult;
  try {
    const generateFn = async () => {
      // 查询正面反馈作为 few-shot 示例（workspaceId 可用时）
      const feedbackExamples = authCtx.workspaceId
        ? await getFeedbackExamples(authCtx.workspaceId, "task-breakdown", 2)
        : undefined;
      const llmResult = await generateText({
        model: defaultModel,
        system: withCoT(buildTaskBreakdownSystemPrompt(feedbackExamples), defaultModel),
        prompt: buildUserPrompt(body),
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

    // workspaceId 可用时用 withUsageTracking 包装，否则直接调用
    const llmResult =
      authCtx.workspaceId
        ? await withUsageTracking(
            {
              workspaceId: authCtx.workspaceId,
              userId,
              capability: "task-breakdown",
              model: defaultModel.modelId,
            },
            generateFn,
          )
        : (await generateFn()).result;

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
      subtasks: normalizeSubtasks(obj.subtasks),
      reasoning: typeof obj.reasoning === "string" ? obj.reasoning : "",
    };
  } catch (error) {
    console.error("[POST ai/task-breakdown] LLM error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }

  // 6) 返回拆解结果
  return NextResponse.json({
    code: 200,
    data: result,
  });
}