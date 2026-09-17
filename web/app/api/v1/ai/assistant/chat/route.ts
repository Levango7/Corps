// POST /api/v1/ai/assistant/chat — AI 助理对话式 API
//
// 输入：{ wid, message, phase, taskId?, previousOutput?, conversationId? }
// 流程：
//   1. 认证 + AI 配置检查 + 速率限制
//   2. body 校验 + 工作区守卫
//   3. 若有 conversationId，查询最近 10 条消息作为多轮上下文 history
//   4. buildTaskContext 聚合任务上下文（taskId 存在时）
//   5. runAssistant 执行助理（意图识别 → 能力调用 → 结果解析），传递 history
//   6. 存储 user message + assistant response 到 AssistantMessage（RLS 事务内）
//   7. 返回 AssistantResult + conversationId + recommendedNext
//
// 来源：M1-A 后端任务 323（AI 助理深化 — 对话历史存储 + 多轮上下文）

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
import { logger } from "@/lib/logger";

const chatSchema = z.object({
  wid: z.string().uuid(),
  message: z.string().min(1).max(10000),
  phase: z
    .enum(["created", "in_progress", "review", "completed", "blocked"])
    .default("in_progress"),
  taskId: z.string().uuid().optional(),
  previousOutput: z.string().optional(),
  conversationId: z.string().uuid().optional(),
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
    // 6) 查询对话历史（conversationId 存在时取最近 10 条消息作为多轮上下文）
    let history: Array<{ role: "user" | "assistant"; content: string }> = [];
    if (body.conversationId) {
      history = await runWithWorkspace(
        body.wid,
        async (tx) => {
          const msgs = await tx.assistantMessage.findMany({
            where: { conversationId: body.conversationId! },
            orderBy: { createdAt: "asc" },
            take: 10,
            select: { role: true, content: true },
          });
          // 仅保留 role 为 user/assistant 的消息（防御性过滤）
          return msgs
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => ({
              role: m.role as "user" | "assistant",
              content: m.content,
            }));
        },
        ctx.payload.sub,
      );
    }

    // 7) 聚合任务上下文（taskId 存在时在 RLS 事务内读取任务核心字段）
    const taskContext = body.taskId
      ? await runWithWorkspace(
          body.wid,
          (tx) => buildTaskContext(tx, body.wid, body.taskId),
          ctx.payload.sub,
        )
      : "";

    // 8) 执行 AI 助理（意图识别 → 能力调用 → 结果解析）
    //    previousOutput 优先用客户端传入，否则用任务上下文
    //    history 传递多轮对话上下文
    //    previousOutput 超过 4000 字符时截断，避免 prompt 过长导致 token 膨胀
    const MAX_PREVIOUS_OUTPUT = 4000;
    let previousOutput = body.previousOutput ?? taskContext;
    if (previousOutput && previousOutput.length > MAX_PREVIOUS_OUTPUT) {
      logger.warn("[POST ai/assistant/chat] previousOutput 超长，已截断", {
        originalLength: previousOutput.length,
        truncatedTo: MAX_PREVIOUS_OUTPUT,
      });
      previousOutput = previousOutput.slice(0, MAX_PREVIOUS_OUTPUT) + "...";
    }

    const result = await runAssistant({
      workspaceId: body.wid,
      userId: ctx.payload.sub,
      taskId: body.taskId,
      phase: body.phase as TaskPhase,
      message: body.message,
      previousOutput,
      history,
    });

    if (!result) {
      return NextResponse.json(
        { code: 500, message: apiMsg(req, "internalError"), data: null },
        { status: 500 },
      );
    }

    // 9) 存储对话历史（user message + assistant response）
    //    有 conversationId 则追加消息；无则创建新对话再追加
    const conversationId = await runWithWorkspace(
      body.wid,
      async (tx) => {
        let convId = body.conversationId;
        if (!convId) {
          const conv = await tx.assistantConversation.create({
            data: {
              userId: ctx.payload.sub,
              workspaceId: body.wid,
              taskId: body.taskId,
            },
          });
          convId = conv.id;
        }
        // 存储 user message
        await tx.assistantMessage.create({
          data: {
            conversationId: convId,
            role: "user",
            content: body.message,
          },
        });
        // 存储 assistant response
        await tx.assistantMessage.create({
          data: {
            conversationId: convId,
            role: "assistant",
            content: result.content,
            capabilityUsed: result.capabilityId,
          },
        });
        return convId;
      },
      ctx.payload.sub,
    ).catch((e: unknown) => {
      // 历史存储失败不影响主流程，仅记日志
      logger.warn("[POST ai/assistant/chat] 存储对话历史失败", {
        error: e instanceof Error ? e.message : String(e),
        conversationId: body.conversationId,
      });
      return body.conversationId ?? null;
    });

    // 10) 返回 AssistantResult + conversationId
    return NextResponse.json({
      code: 0,
      data: { ...result, conversationId },
    });
  } catch (error) {
    console.error("[POST ai/assistant/chat] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}
