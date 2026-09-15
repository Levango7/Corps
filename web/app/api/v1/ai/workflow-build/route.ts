// POST /api/v1/ai/workflow-build — AI 自然语言构建工作流（非流式）
// 输入：{ wid, description }
// 输出：{ code: 200, data: { name, description, trigger, actions } }
// DEEPSEEK_API_KEY 未配置时返回 503。

import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { z } from "zod";
import { reasonerModel, withCoT } from "@/lib/ai/deepseek";
import {
  getUserId,
  unauthorizedResponse,
  aiNotConfiguredResponse,
  isAiConfigured,
} from "@/lib/ai/shared";
import { withUsageTracking } from "@/lib/ai/usage-middleware";
import {
  buildWorkflowSystemPrompt,
  buildWorkflowUserPrompt,
} from "@/lib/ai/prompts/workflow-build";
import { checkRateLimit } from "@/lib/rate-limit";
import { cleanJsonResponse } from "@/lib/ai/orchestrator";
import { apiMsg } from "@/lib/api-messages";
import { getWorkspaceContext } from "@/lib/auth";

const schema = z.object({
  wid: z.string().uuid(),
  description: z.string().min(1).max(2000),
});

/** 触发事件枚举 */
const VALID_EVENTS = new Set([
  "task.created",
  "task.completed",
  "document.published",
  "decision.made",
  "schedule.recurring",
]);

/** 动作类型枚举 */
const VALID_ACTION_TYPES = new Set([
  "notify",
  "create_task",
  "update_field",
  "send_message",
  "create_document",
  "call_webhook",
]);

interface WorkflowAction {
  type: string;
  config: Record<string, unknown>;
  order: number;
}

interface WorkflowDefinition {
  name: string;
  description: string;
  trigger: { event: string; conditions: Record<string, unknown> };
  actions: WorkflowAction[];
}


/** 校验并规范化 LLM 返回的工作流定义 */
function normalizeWorkflow(raw: unknown): WorkflowDefinition | null {
  if (raw == null || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  // name：必填字符串，截断至 200（Workflow.name VarChar(200)）
  if (typeof obj.name !== "string" || !obj.name.trim()) return null;
  const name = obj.name.slice(0, 200);

  // description：可选，截断至 500
  const description =
    typeof obj.description === "string" ? obj.description.slice(0, 500) : "";

  // trigger：必填对象，event 必须在枚举内
  if (obj.trigger == null || typeof obj.trigger !== "object") return null;
  const triggerRaw = obj.trigger as Record<string, unknown>;
  if (
    typeof triggerRaw.event !== "string" ||
    !VALID_EVENTS.has(triggerRaw.event)
  ) {
    return null;
  }
  const conditions =
    triggerRaw.conditions != null && typeof triggerRaw.conditions === "object"
      ? (triggerRaw.conditions as Record<string, unknown>)
      : {};

  // actions：至少 1 个，type 必须在枚举内
  if (!Array.isArray(obj.actions) || obj.actions.length === 0) return null;
  const actions: WorkflowAction[] = [];
  for (const item of obj.actions) {
    if (item == null || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    if (typeof a.type !== "string" || !VALID_ACTION_TYPES.has(a.type)) continue;
    actions.push({
      type: a.type,
      config:
        a.config != null && typeof a.config === "object"
          ? (a.config as Record<string, unknown>)
          : {},
      order: typeof a.order === "number" ? a.order : actions.length + 1,
    });
  }
  if (actions.length === 0) return null;

  // 按 order 升序排列
  actions.sort((a, b) => a.order - b.order);

  return {
    name,
    description,
    trigger: { event: triggerRaw.event, conditions },
    actions,
  };
}

export async function POST(req: NextRequest) {
  // 1) 认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) AI 服务配置检查
  if (!isAiConfigured()) return aiNotConfiguredResponse(req);

  // 3) 速率限制：每分钟 3 次
  const limited = await checkRateLimit(req, "ai-workflow-build", {
    windowMs: 60_000,
    max: 3,
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

  // 5) 工作区上下文校验（成员资格）
  const ctx = await getWorkspaceContext(req, body.wid);
  if (!ctx) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  // 6) LLM 生成工作流定义（非流式，推理模型）
  try {
    const llmResult = await withUsageTracking(
      {
        workspaceId: body.wid,
        userId: ctx.payload.sub,
        capability: "workflow-build",
        model: reasonerModel.modelId,
      },
      async () => {
        const res = await generateText({
          model: reasonerModel,
          system: withCoT(buildWorkflowSystemPrompt(), reasonerModel),
          prompt: buildWorkflowUserPrompt(body.description),
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

    const cleaned = cleanJsonResponse(llmResult.text);
    const parsed: unknown = JSON.parse(cleaned);
    const workflow = normalizeWorkflow(parsed);
    if (!workflow) {
      return NextResponse.json(
        { code: 500, message: apiMsg(req, "internalError"), data: null },
        { status: 500 },
      );
    }

    return NextResponse.json({
      code: 200,
      data: workflow,
    });
  } catch (error) {
    console.error("[POST ai/workflow-build] LLM error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}