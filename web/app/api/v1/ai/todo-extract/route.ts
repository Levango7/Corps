// POST /api/v1/ai/todo-extract — AI 待办提取（非流式）
// 输入：{ wid, source: "message"|"document"|"email", content, context? }
// 输出：{ code: 200, data: { todos: TodoItem[], reasoning: string } }
// 从消息 / 文档 / 邮件内容中识别隐含的待办事项，智能推断优先级、截止日期、负责人。
// DEEPSEEK_API_KEY 未配置时返回 503。

import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { z } from "zod";
import { requireReasonerModel, withCoT } from "@/lib/ai/deepseek";
import {
  getUserIdAndWorkspaceId,
  unauthorizedResponse,
  aiNotConfiguredResponse,
  isAiConfigured,
} from "@/lib/ai/shared";
import { withUsageTracking } from "@/lib/ai/usage-middleware";
import {
  buildTodoExtractSystemPrompt,
  buildTodoExtractUserPrompt,
  type TodoExtractSource,
} from "@/lib/ai/prompts/todo-extract";
import { checkRateLimit } from "@/lib/rate-limit";
import { cleanJsonResponse } from "@/lib/ai/orchestrator";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { apiMsg } from "@/lib/api-messages";

// ─── 请求体 schema ─────────────────────────────────────────────────────────────

const schema = z.object({
  wid: z.string().uuid(),
  source: z.enum(["message", "document", "email"]),
  content: z.string().min(1).max(10_000),
  context: z
    .object({
      taskId: z.string().uuid().optional(),
      conversationId: z.string().uuid().optional(),
      assignees: z.array(z.string()).optional(),
    })
    .optional(),
});

// ─── 响应类型 ──────────────────────────────────────────────────────────────────

/** 单条待办项（AI 提取结果） */
interface TodoItem {
  title: string;
  description?: string;
  assignee?: string | null;
  dueDate?: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  confidence: number;
}

/** AI 提取结果 */
interface TodoExtractResult {
  todos: TodoItem[];
  reasoning: string;
}

// ─── 规范化函数 ────────────────────────────────────────────────────────────────

/** 优先级合法值集合 */
const VALID_PRIORITIES = new Set(["low", "medium", "high", "urgent"]);

/**
 * 校验并规范化 LLM 返回的待办列表，丢弃非法条目。
 *
 * 校验规则：
 *  - 必须是数组
 *  - 每项必须是对象且 title 为非空字符串
 *  - priority 必须是合法枚举值，否则降级为 "medium"
 *  - confidence 必须是 0-1 的数字，否则降级为 0.5
 *  - title 截断至 255 字符（与 Task.title VarChar(255) 对齐）
 *  - description 截断至 5000 字符（与 Task.description VarChar(5000) 对齐）
 *  - assignee/dueDate 仅在为字符串时保留，否则置为 null
 */
function normalizeTodos(raw: unknown): TodoItem[] {
  if (!Array.isArray(raw)) return [];
  const result: TodoItem[] = [];
  for (const item of raw) {
    if (item == null || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    if (typeof obj.title !== "string" || !obj.title.trim()) continue;
    const priority =
      typeof obj.priority === "string" && VALID_PRIORITIES.has(obj.priority)
        ? (obj.priority as TodoItem["priority"])
        : "medium";
    const confidence =
      typeof obj.confidence === "number" && obj.confidence >= 0 && obj.confidence <= 1
        ? obj.confidence
        : 0.5;
    const description =
      typeof obj.description === "string" ? obj.description.slice(0, 5000) : undefined;
    result.push({
      title: obj.title.slice(0, 255),
      description,
      assignee: typeof obj.assignee === "string" ? obj.assignee : null,
      dueDate: typeof obj.dueDate === "string" ? obj.dueDate : null,
      priority,
      confidence,
    });
  }
  return result;
}

// ─── 路由处理 ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // 1) 认证 + 获取 workspaceId（用于 usage tracking）
  const authCtx = await getUserIdAndWorkspaceId(req);
  if (!authCtx) return unauthorizedResponse(req);
  const userId = authCtx.userId;

  // 2) AI 服务配置检查
  if (!isAiConfigured()) return aiNotConfiguredResponse(req);

  // 3) 速率限制：每分钟 10 次
  const limited = await checkRateLimit(req, "ai-todo-extract", {
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

  // 5) 工作区认证 + 准备候选人列表
  const ctx = await getWorkspaceContext(req, body.wid);
  if (!ctx) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  // 候选人列表：优先使用 body.context.assignees；未提供时查询工作区成员姓名
  let assignees: string[] | undefined = body.context?.assignees;
  if (!assignees) {
    try {
      const members = await runWithWorkspace(
        body.wid,
        (tx) =>
          tx.member.findMany({
            where: { workspaceId: body.wid },
            select: { user: { select: { name: true } } },
          }),
        userId,
      );
      assignees = members.map((m) => m.user.name).filter((n): n is string => !!n);
    } catch (error) {
      // 候选人查询失败不阻塞提取，仅 console.error
      console.error("[POST ai/todo-extract] fetch members failed:", error);
      assignees = undefined;
    }
  }

  // 6) LLM 提取待办（非流式）
  let result: TodoExtractResult;
  try {
    const source: TodoExtractSource = body.source;
    const generateFn = async () => {
      const llmResult = await generateText({
        model: requireReasonerModel(),
        system: withCoT(buildTodoExtractSystemPrompt(), requireReasonerModel()),
        prompt: buildTodoExtractUserPrompt(source, body.content, { assignees }),
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
    const llmResult = authCtx.workspaceId
      ? await withUsageTracking(
          {
            workspaceId: authCtx.workspaceId,
            userId,
            capability: "todo-extract",
            model: requireReasonerModel().modelId,
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
      todos: normalizeTodos(obj.todos),
      reasoning: typeof obj.reasoning === "string" ? obj.reasoning : "",
    };
  } catch (error) {
    console.error("[POST ai/todo-extract] LLM error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }

  // 7) 返回提取结果
  return NextResponse.json({
    code: 200,
    data: result,
  });
}
