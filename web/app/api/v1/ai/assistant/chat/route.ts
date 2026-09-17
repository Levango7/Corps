// POST /api/v1/ai/assistant/chat — AI 助理对话式 API
//
// 输入：{ wid, message, phase, taskId?, previousOutput? }
// 流程：
//   1. 认证 + AI 配置检查 + 速率限制
//   2. body 校验 + 工作区守卫
//   3. buildTaskContext 聚合任务上下文（taskId 存在时）
//   4. runAssistant 执行助理（意图识别 → 能力调用 → 结果解析）
//   5. 返回 AssistantResult
//
// 来源：P2 后端任务 318（AI 助理编排引擎 + 对话 API）

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getUserId,
  unauthorizedResponse,
  aiNotConfiguredResponse,
  isAiConfigured,
} from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";
import {
  runAssistant,
  type TaskPhase,
} from "@/lib/ai/assistant/orchestrator";
import { buildTaskContext } from "@/lib/ai/assistant/context-builder";

const chatSchema = z.object({
  wid: z.string().uuid(),
  message: z.string().min(1).max(10000),
  phase: z
    .enum(["created", "in_progress", "review", "completed", "blocked"])
    .default("in_progress"),
  taskId: z.string().uuid().optional(),
  previousOutput: z.string().optional(),
});

/** POST /api/v1/ai/assistant/chat — AI 助理对话 */
export async function POST(req: NextRequest) {
  // 1) 认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) AI 配置检查
  if (!isAiConfigured()) return aiNotConfiguredResponse(req);

  // 3) 速率限制：每分钟 20 次（对话式调用，比推送触发更频繁）
  const limited = await checkRateLimit(req, "ai-assistant-chat", {
    windowMs: 60_000,
    max: 20,
  });
  if (limited) return limited;

  // 4) body 校验
  let body: z.infer<typeof chatSchema>;
  try {
    body = chatSchema.parse(await req.json());
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

  // 5) 工作区守卫
  const ctx = await getWorkspaceContext(req, body.wid);
  if (!ctx) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  try {
    // 6) 聚合任务上下文（taskId 存在时在 RLS 事务内读取任务核心字段）
    const taskContext = body.taskId
      ? await runWithWorkspace(
          body.wid,
          (tx) => buildTaskContext(tx, body.wid, body.taskId),
          ctx.payload.sub,
        )
      : "";

    // 7) 执行 AI 助理（意图识别 → 能力调用 → 结果解析）
    //    previousOutput 优先用客户端传入，否则用任务上下文
    const result = await runAssistant({
      workspaceId: body.wid,
      userId: ctx.payload.sub,
      taskId: body.taskId,
      phase: body.phase as TaskPhase,
      message: body.message,
      previousOutput: body.previousOutput ?? taskContext,
    });

    if (!result) {
      return NextResponse.json(
        { code: 500, message: apiMsg(req, "internalError"), data: null },
        { status: 500 },
      );
    }

    // 8) 返回 AssistantResult
    return NextResponse.json({ code: 0, data: result });
  } catch (error) {
    console.error("[POST ai/assistant/chat] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}