// POST /api/v1/ai/knowledge-qa — 跨模块 AI 知识问答（流式）
// 输入：{ wid, question, scope?, conversationId? }
// 输出：text/event-stream（Vercel AI SDK UI Message Stream）
//
// 聚合跨模块工作区上下文（任务/文档/会议/审批/工时/Wiki/决策/OKR/消息），
// 调用 deepseek-chat 流式回答用户自然语言问题。
//
// 当传入 conversationId 时：从 DB 加载历史消息 → 组装 messages 传给 streamText
// → 用 onFinish 回调异步持久化 user question + assistant answer。
// 不传入时：保持现有单次问答行为。

import { NextRequest, NextResponse } from "next/server";
import { streamText } from "ai";
import { z } from "zod";
import { requireDefaultModel, withCoT } from "@/lib/ai/deepseek";
import {
  getUserId,
  unauthorizedResponse,
  aiNotConfiguredResponse,
  isAiConfigured,
} from "@/lib/ai/shared";
import { fireRecordUsage } from "@/lib/ai/usage-middleware";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { buildAiContext, type AiContextScope } from "@/lib/ai/context";
import {
  buildKnowledgeQaSystemPrompt,
  buildKnowledgeQaUserPrompt,
} from "@/lib/ai/prompts/knowledge-qa";
import { apiMsg } from "@/lib/api-messages";

const schema = z.object({
  wid: z.string().uuid(),
  question: z.string().min(1).max(2000),
  scope: z.array(z.string()).optional(),
  conversationId: z.string().uuid().optional(),
});

/** 知识问答默认上下文聚合范围：跨模块全量聚合 */
const DEFAULT_SCOPES: AiContextScope[] = [
  "tasks:completed:today",
  "tasks:blocked",
  "tasks:overdue",
  "documents:edited:today",
  "meetings:today",
  "approvals:handled:today",
  "approvals:pending",
  "okr:progress",
  "time:today",
  "wiki:edited:today",
  "decisions:recent",
  "im:recent",
];

/** 所有合法 AiContextScope 字面量集合，用于过滤用户传入的 scope。
 *  覆盖全部 20 种 scope（13 基础 + 7 细粒度 v2 扩展），与 AiContextScope 类型定义保持一致。 */
const VALID_SCOPES: ReadonlySet<string> = new Set<AiContextScope>([
  // ─── 基础 scope ───
  "tasks:completed:today",
  "tasks:blocked",
  "tasks:overdue",
  "documents:edited:today",
  "meetings:today",
  "approvals:handled:today",
  "approvals:pending",
  "okr:progress",
  "time:today",
  "time:week",
  "wiki:edited:today",
  "decisions:recent",
  "im:recent",
  // ─── 细粒度 scope（v2 扩展）───
  "tasks:created:today",
  "tasks:high:priority",
  "meetings:upcoming",
  "okr:at:risk",
  "approvals:overdue",
  "im:unread",
  "members:active",
]);

/**
 * 将用户传入的 scope 字符串数组过滤为合法 AiContextScope。
 * 传入空数组或全部非法时回退默认全量范围，保证总有上下文可答。
 */
function resolveScopes(raw: string[] | undefined): AiContextScope[] {
  if (!raw || raw.length === 0) return DEFAULT_SCOPES;
  const filtered = raw.filter((s) => VALID_SCOPES.has(s)) as AiContextScope[];
  return filtered.length > 0 ? filtered : DEFAULT_SCOPES;
}

export async function POST(req: NextRequest) {
  // 1) 基础认证（确认登录身份）
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) AI 服务配置检查
  if (!isAiConfigured()) return aiNotConfiguredResponse(req);

  // 3) 速率限制：每分钟 5 次
  const limited = await checkRateLimit(req, "ai-knowledge-qa", {
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

  // 5) 工作区成员资格认证（wid 守卫 + RLS）+ 上下文聚合 + 流式生成
  try {
    const ctx = await getWorkspaceContext(req, body.wid);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }

    // 6) 聚合跨模块上下文（RLS 事务内，仅聚合用户有权限查看的数据）
    const scopes = resolveScopes(body.scope);
    const context = await runWithWorkspace(
      body.wid,
      (tx) => buildAiContext(body.wid, ctx.payload.sub, scopes, tx),
      ctx.payload.sub,
    );

    // 7) 组装新用户消息（包含上下文）
    const userPrompt = buildKnowledgeQaUserPrompt(body.question, context);
    const systemPrompt = withCoT(buildKnowledgeQaSystemPrompt(), requireDefaultModel());

    // 8) 多轮对话：加载历史消息
    let historyMessages: { role: "user" | "assistant"; content: string }[] = [];
    let conversationId: string | null = null;

    if (body.conversationId) {
      // 验证对话属于该用户 + 加载历史消息
      const conv = await runWithWorkspace(
        body.wid,
        (tx) =>
          tx.aiConversation.findUnique({
            where: { id: body.conversationId },
            select: {
              id: true,
              userId: true,
              workspaceId: true,
              messages: {
                // P1-3: 取最近 20 条（desc）后反转，避免长对话超出 LLM 上下文窗口
                orderBy: { createdAt: "desc" },
                take: 20,
                select: { role: true, content: true },
              },
            },
          }),
        ctx.payload.sub,
      );

      // 二次校验：对话不属于该用户或不在该工作区 → 忽略 conversationId，走单次问答
      if (conv && conv.workspaceId === body.wid && conv.userId === ctx.payload.sub) {
        conversationId = conv.id;
        // P1-3: DB 取 desc + take 20，此处反转回时间升序供 streamText 拼接
        historyMessages = conv.messages
          .slice()
          .reverse()
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          }));
      }
    }

    // 9) 流式生成回答
    // 多轮对话：用 messages 参数（历史 + 新 user 消息）
    // 单次问答：用 prompt 参数（保持现有行为）
    const usageStartTime = Date.now();
    const usageTrackingParams = {
      workspaceId: body.wid,
      userId: ctx.payload.sub,
      capability: "knowledge-qa" as const,
      model: requireDefaultModel().modelId,
    };
    const result =
      conversationId !== null
        ? streamText({
            model: requireDefaultModel(),
            system: systemPrompt,
            messages: [
              ...historyMessages,
              { role: "user" as const, content: userPrompt },
            ],
            onFinish: async ({ text, usage }) => {
              // 流结束后异步记录 usage（fire-and-forget）
              fireRecordUsage(usageTrackingParams, usageStartTime, usage);

              // 异步持久化 user question + assistant answer
              if (!conversationId || !text) return;
              try {
                await runWithWorkspace(
                  body.wid,
                  async (tx) => {
                    // P1-1: 持久化原始 body.question（而非含上下文的 userPrompt），
                    // 避免上下文重复注入 + 历史展示错乱
                    await tx.aiMessage.createMany({
                      data: [
                        {
                          conversationId,
                          role: "user",
                          content: body.question,
                        },
                        {
                          conversationId,
                          role: "assistant",
                          content: text,
                        },
                      ],
                    });
                    // P1-2: 更新 conversation.updatedAt，保证对话列表排序正确
                    await tx.aiConversation.update({
                      where: { id: conversationId },
                      data: { updatedAt: new Date() },
                    });
                  },
                  ctx.payload.sub,
                );
              } catch (e) {
                // P1-4: 持久化失败不影响已返回的流式回答，仅记录错误（含上下文便于排查）
                console.error(
                  `[knowledge-qa] 消息持久化失败 conv=${conversationId} user=${ctx.payload.sub}:`,
                  e,
                );
              }
            },
          })
        : streamText({
            model: requireDefaultModel(),
            system: systemPrompt,
            prompt: userPrompt,
            onFinish: ({ usage }) => {
              // 流结束后异步记录 usage（fire-and-forget）
              fireRecordUsage(usageTrackingParams, usageStartTime, usage);
            },
          });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    console.error("[ai/knowledge-qa] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}
