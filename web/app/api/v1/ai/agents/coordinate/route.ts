// POST /api/v1/ai/agents/coordinate — 协调多 Agent 执行任务（非流式）
// 输入：{ wid, task, agentIds? }
// 输出：{ code: 200, data: { assignments, responses, messages } }
// 速率限制：3/min
//
// 流程：
//  1) 查询启用的 Agent 列表（agentIds 指定时按 ID 过滤，否则全部启用 Agent）
//  2) 用协调器 prompt 分配任务（generateText + reasonerModel）
//  3) 并行调用各 Agent 响应（generateText + defaultModel）
//  4) 计入 AiAgentMessage（request + response）
//  5) 返回汇总结果（assignments + responses + messages）
//
// 用 withUsageTracking 包装；用 generateText + cleanJsonResponse + JSON.parse。
// DEEPSEEK_API_KEY 未配置时返回 503。

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateText } from "ai";
import { requireDefaultModel, requireReasonerModel, withCoT } from "@/lib/ai/deepseek";
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
import {
  buildAgentCoordinationPrompt,
  buildAgentResponsePrompt,
} from "@/lib/ai/prompts/agent-collaboration";

/** POST schema */
const schema = z.object({
  wid: z.string().uuid(),
  task: z.string().min(1).max(4000),
  agentIds: z.array(z.string().uuid()).optional(),
});

/** 协调器分配结果 */
interface Assignment {
  agentName: string;
  subtask: string;
  reason: string;
}

/** Agent 响应结果 */
interface AgentResponse {
  agentId: string;
  agentName: string;
  response: string;
  handoff: string | null;
}

/** 协调结果（返回给前端） */
interface CoordinationResult {
  assignments: Assignment[];
  responses: AgentResponse[];
  messageIds: string[];
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
 * 规范化协调器分配结果。
 *
 * 校验：assignments 为数组，每项含 agentName/subtask/reason 字符串。
 */
function normalizeAssignments(
  raw: unknown,
  validAgentNames: Set<string>,
): Assignment[] {
  if (raw == null || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.assignments)) return [];
  const result: Assignment[] = [];
  for (const item of obj.assignments) {
    if (item == null || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    if (
      typeof a.agentName !== "string" ||
      typeof a.subtask !== "string" ||
      typeof a.reason !== "string"
    ) {
      continue;
    }
    // 仅保留有效 Agent 名称的分配
    if (!validAgentNames.has(a.agentName)) continue;
    result.push({
      agentName: a.agentName,
      subtask: a.subtask.slice(0, 2000),
      reason: a.reason.slice(0, 200),
    });
  }
  return result;
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
  const handoff =
    typeof obj.handoff === "string" ? obj.handoff : null;
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

  // 3) 速率限制：每分钟 3 次（协调任务较重）
  const limited = await checkRateLimit(req, "ai-agents-coordinate", {
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

  // 5) 工作区成员资格认证
  const ctx = await getWorkspaceContext(req, body.wid);
  if (!ctx) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  // 6) 协调多 Agent 执行任务
  try {
    const result = await withUsageTracking(
      {
        workspaceId: body.wid,
        userId: ctx.payload.sub,
        capability: "agents-coordinate",
        model: requireReasonerModel().modelId,
      },
      async () => {
        // 6.1) 查询启用的 Agent 列表
        const agents = await runWithWorkspace(
          body.wid,
          (tx) =>
            tx.aiAgent.findMany({
              where: {
                workspaceId: body.wid,
                enabled: true,
                ...(body.agentIds && body.agentIds.length > 0
                  ? { id: { in: body.agentIds } }
                  : {}),
              },
              select: {
                id: true,
                name: true,
                role: true,
                capabilities: true,
                systemPrompt: true,
                model: true,
              },
            }),
          ctx.payload.sub,
        );

        if (agents.length === 0) {
          return {
            result: {
              assignments: [],
              responses: [],
              messageIds: [],
            } satisfies CoordinationResult,
          };
        }

        // 6.2) 用协调器 prompt 分配任务
        const agentBriefs = agents.map((a) => ({
          name: a.name,
          role: a.role,
          capabilities: Array.isArray(a.capabilities)
            ? (a.capabilities as string[]).filter((c) => typeof c === "string")
            : [],
        }));

        const validAgentNames = new Set(agents.map((a) => a.name));
        const coordinationSystemPrompt = buildAgentCoordinationPrompt(
          agentBriefs,
          body.task,
        );

        let assignments: Assignment[] = [];
        try {
          const coordResult = await generateText({
            model: requireReasonerModel(),
            system: withCoT(coordinationSystemPrompt, requireReasonerModel()),
            prompt: `请分析以上任务并分配给各 Agent，返回 JSON。`,
          });
          const parsed = safeParseJson(coordResult.text);
          assignments = normalizeAssignments(parsed, validAgentNames);
        } catch (e) {
          console.error("[ai/agents/coordinate] 协调器调用失败:", e);
          // 降级：每个 Agent 都分配整体任务
          assignments = agents.map((a) => ({
            agentName: a.name,
            subtask: body.task,
            reason: "协调器调用失败，降级为整体任务分配",
          }));
        }

        // 6.3) 并行调用各 Agent 响应
        // 为每个分配项找到对应的 Agent，并行调用 generateText
        const responsePromises = assignments.map(async (assignment) => {
          const agent = agents.find((a) => a.name === assignment.agentName);
          if (!agent) {
            return {
              agentId: "",
              agentName: assignment.agentName,
              response: `Agent ${assignment.agentName} 未找到`,
              handoff: null,
            } satisfies AgentResponse;
          }

          const responseSystemPrompt = buildAgentResponsePrompt(
            agent.name,
            agent.role,
            agent.systemPrompt,
            assignment.subtask,
          );

          try {
            const agentResult = await generateText({
              model: requireDefaultModel(),
              system: withCoT(responseSystemPrompt, requireDefaultModel()),
              prompt: `请基于你的角色和专长响应以上消息，返回 JSON。`,
            });
            const parsed = safeParseJson(agentResult.text);
            const normalized = normalizeAgentResponse(parsed);
            if (normalized) {
              return {
                agentId: agent.id,
                agentName: agent.name,
                response: normalized.response,
                handoff: normalized.handoff,
              } satisfies AgentResponse;
            }
            // JSON 解析失败，降级为原始文本
            return {
              agentId: agent.id,
              agentName: agent.name,
              response: agentResult.text.slice(0, 8000) || "（无响应）",
              handoff: null,
            } satisfies AgentResponse;
          } catch (e) {
            console.error(
              `[ai/agents/coordinate] Agent ${agent.name} 响应失败:`,
              e,
            );
            return {
              agentId: agent.id,
              agentName: agent.name,
              response: `Agent ${agent.name} 响应失败`,
              handoff: null,
            } satisfies AgentResponse;
          }
        });

        const responses = await Promise.all(responsePromises);

        // 6.4) 计入 AiAgentMessage（request + response）
        // 协调器向每个 Agent 发送 request，Agent 返回 response
        const messageIds: string[] = [];
        try {
          await runWithWorkspace(
            body.wid,
            async (tx) => {
              // 为每个分配创建 request + response 消息
              for (let i = 0; i < assignments.length; i++) {
                const assignment = assignments[i];
                const response = responses[i];
                const agent = agents.find(
                  (a) => a.name === assignment.agentName,
                );
                if (!agent) continue;

                // request 消息：协调器（用第一个 Agent 或特殊标记）→ 目标 Agent
                // 这里用 fromAgentId = agent.id, toAgentId = null 表示广播请求
                // metadata 记录 subtask 和 reason
                const requestMsg = await tx.aiAgentMessage.create({
                  data: {
                    workspaceId: body.wid,
                    fromAgentId: agent.id,
                    toAgentId: null,
                    content: assignment.subtask,
                    type: "request",
                    metadata: {
                      reason: assignment.reason,
                      task: body.task,
                    } as Prisma.InputJsonValue,
                  },
                });
                messageIds.push(requestMsg.id);

                // response 消息：Agent → 协调器（toAgentId = null 表示广播）
                const responseMsg = await tx.aiAgentMessage.create({
                  data: {
                    workspaceId: body.wid,
                    fromAgentId: agent.id,
                    toAgentId: null,
                    content: response.response,
                    type: "response",
                    metadata: {
                      handoff: response.handoff,
                      assignment: assignment.subtask,
                    } as Prisma.InputJsonValue,
                  },
                });
                messageIds.push(responseMsg.id);

                // handoff 消息（若有）
                if (response.handoff) {
                  const handoffMsg = await tx.aiAgentMessage.create({
                    data: {
                      workspaceId: body.wid,
                      fromAgentId: agent.id,
                      toAgentId: null,
                      content: response.handoff,
                      type: "handoff",
                      metadata: {
                        assignment: assignment.subtask,
                      } as Prisma.InputJsonValue,
                    },
                  });
                  messageIds.push(handoffMsg.id);
                }
              }
            },
            ctx.payload.sub,
          );
        } catch (e) {
          // 消息持久化失败不影响主流程，仅记录错误
          console.error("[ai/agents/coordinate] 消息持久化失败:", e);
        }

        // 6.5) 返回汇总结果
        return {
          result: {
            assignments,
            responses,
            messageIds,
          } satisfies CoordinationResult,
        };
      },
    );

    return NextResponse.json({ code: 0, data: result, message: "OK" });
  } catch (error) {
    console.error("[POST ai/agents/coordinate] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}