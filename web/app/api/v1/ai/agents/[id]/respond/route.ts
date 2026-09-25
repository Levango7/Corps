// POST /api/v1/ai/agents/[id]/respond — 单个 Agent 响应消息（非流式）
// 输入：{ wid, message }
// 输出：{ code: 200, data: { response, handoff, messageId } }
// 速率限制：10/min
//
// 流程：
//  1) 查询指定 Agent（含 systemPrompt）
//  2) 用 buildAgentResponsePrompt 构建 prompt
//  3) generateText + cleanJsonResponse + JSON.parse 解析响应
//  4) 计入 AiAgentMessage（request + response）
//  5) 返回响应结果
//
// 用 withUsageTracking 包装；用 generateText + cleanJsonResponse + JSON.parse。
// DEEPSEEK_API_KEY 未配置时返回 503。

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateText } from "ai";
import { requireDefaultModel, withCoT } from "@/lib/ai/deepseek";
import {
  getUserId,
  unauthorizedResponse,
  aiNotConfiguredResponse,
  isAiConfigured,
} from "@/lib/ai/shared";
import { withUsageTracking } from "@/lib/ai/usage-middleware";
import { cleanJsonResponse } from "@/lib/ai/orchestrator";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";
import { Prisma } from "@prisma/client";
import { buildAgentResponsePrompt } from "@/lib/ai/prompts/agent-collaboration";

/** POST schema */
const schema = z.object({
  wid: z.string().uuid(),
  message: z.string().min(1).max(4000),
});

/** UUID 正则校验 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 从 URL 路径提取 Agent ID（倒数第二段，因为最后一段是 respond） */
function extractAgentId(req: NextRequest): string | null {
  const segments = new URL(req.url).pathname.split("/");
  // 路径形如 /api/v1/ai/agents/<id>/respond
  // segments: ['', 'api', 'v1', 'ai', 'agents', '<id>', 'respond']
  const id = segments[segments.length - 2];
  if (!id || !UUID_RE.test(id)) return null;
  return id;
}

/** Agent 响应结果（返回给前端） */
interface AgentRespondResult {
  response: string;
  handoff: string | null;
  messageId: string | null;
}

/**
 * 安全解析 JSON：cleanJsonResponse → JSON.parse，失败返回 null。
 */
function safeParseJson(text: string): unknown | null {
  try {
    return JSON.parse(cleanJsonResponse(text));
  } catch {
    return null;
  }
}

/**
 * 规范化 Agent 响应结果。
 *
 * 校验：response 为字符串，handoff 为字符串或 null。
 */
function normalizeAgentResponse(raw: unknown): {
  response: string;
  handoff: string | null;
} | null {
  if (raw == null || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.response !== "string") return null;
  const handoff = typeof obj.handoff === "string" ? obj.handoff : null;
  return {
    response: obj.response.slice(0, 8000),
    handoff: handoff ? handoff.slice(0, 4000) : null,
  };
}

export async function POST(req: NextRequest) {
  // 1) 认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) AI 服务配置检查
  if (!isAiConfigured()) return aiNotConfiguredResponse(req);

  // 3) 速率限制：每分钟 10 次
  const limited = await checkRateLimit(req, "ai-agent-respond", {
    windowMs: 60_000,
    max: 10,
  });
  if (limited) return limited;

  // 4) 参数提取
  const agentId = extractAgentId(req);
  if (!agentId) {
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "invalidParams"), data: null },
      { status: 400 },
    );
  }

  // 5) body 校验
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

  // 6) 工作区成员资格认证
  const ctx = await getWorkspaceContext(req, body.wid);
  if (!ctx) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  // 7) Agent 响应
  try {
    const result = await withUsageTracking(
      {
        workspaceId: body.wid,
        userId: ctx.payload.sub,
        capability: "agent-respond",
        model: requireDefaultModel().modelId,
      },
      async () => {
        // 7.1) 查询 Agent
        const agent = await runWithWorkspace(
          body.wid,
          (tx) =>
            tx.aiAgent.findFirst({
              where: { id: agentId, workspaceId: body.wid },
              select: {
                id: true,
                name: true,
                role: true,
                systemPrompt: true,
                model: true,
              },
            }),
          ctx.payload.sub,
        );

        if (!agent) {
          throw new Error("AGENT_NOT_FOUND");
        }

        // 7.2) 构建 prompt 并调用 LLM
        const systemPrompt = buildAgentResponsePrompt(
          agent.name,
          agent.role,
          agent.systemPrompt,
          body.message,
        );

        let responseText = "";
        let handoff: string | null = null;
        try {
          const llmResult = await generateText({
            model: requireDefaultModel(),
            system: withCoT(systemPrompt, requireDefaultModel()),
            prompt: `请基于你的角色和专长响应以上消息，返回 JSON。`,
          });
          const parsed = safeParseJson(llmResult.text);
          const normalized = normalizeAgentResponse(parsed);
          if (normalized) {
            responseText = normalized.response;
            handoff = normalized.handoff;
          } else {
            // JSON 解析失败，降级为原始文本
            responseText = llmResult.text.slice(0, 8000) || "（无响应）";
          }
        } catch (e) {
          console.error(`[ai/agents/[id]/respond] Agent ${agent.name} 响应失败:`, e);
          responseText = `Agent ${agent.name} 响应失败`;
        }

        // 7.3) 计入 AiAgentMessage（request + response）
        let messageId: string | null = null;
        try {
          await runWithWorkspace(
            body.wid,
            async (tx) => {
              // request 消息：记录用户向 Agent 发送的请求
              // fromAgentId = agent.id（Agent 接收请求），toAgentId = null（广播）
              await tx.aiAgentMessage.create({
                data: {
                  workspaceId: body.wid,
                  fromAgentId: agent.id,
                  toAgentId: null,
                  content: body.message,
                  type: "request",
                  metadata: {
                    source: "user",
                  } as Prisma.InputJsonValue,
                },
              });

              // response 消息：Agent 的响应
              const responseMsg = await tx.aiAgentMessage.create({
                data: {
                  workspaceId: body.wid,
                  fromAgentId: agent.id,
                  toAgentId: null,
                  content: responseText,
                  type: "response",
                  metadata: {
                    handoff,
                  } as Prisma.InputJsonValue,
                },
              });
              messageId = responseMsg.id;

              // handoff 消息（若有）
              if (handoff) {
                await tx.aiAgentMessage.create({
                  data: {
                    workspaceId: body.wid,
                    fromAgentId: agent.id,
                    toAgentId: null,
                    content: handoff,
                    type: "handoff",
                    metadata: {
                      source: "agent",
                    } as Prisma.InputJsonValue,
                  },
                });
              }
            },
            ctx.payload.sub,
          );
        } catch (e) {
          // 消息持久化失败不影响主流程，仅记录错误
          console.error("[ai/agents/[id]/respond] 消息持久化失败:", e);
        }

        // 7.4) 返回响应结果
        return {
          result: {
            response: responseText,
            handoff,
            messageId,
          } satisfies AgentRespondResult,
        };
      },
    );

    return NextResponse.json({ code: 0, data: result, message: "OK" });
  } catch (error) {
    // Agent 不存在时返回 404
    if (error instanceof Error && error.message === "AGENT_NOT_FOUND") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "itemNotFound"), data: null },
        { status: 404 },
      );
    }
    console.error("[POST ai/agents/[id]/respond] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}
