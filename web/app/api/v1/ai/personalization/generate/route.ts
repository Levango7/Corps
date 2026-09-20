// POST /api/v1/ai/personalization/generate — 生成个性化推荐
// 输入：{ wid, type? }
// 输出：{ code: 200, data: { recommendations: AiPersonalization[] } }
//
// 流程：查询用户行为历史 → AI 分析生成推荐 → 持久化到 AiPersonalization → 返回
// 使用 withUsageTracking 包装 AI 调用，自动记录 Token / 耗时 / 成败。
// 使用 generateText + cleanJsonResponse + JSON.parse（非流式）。

import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { z } from "zod";
import { Prisma } from "@prisma/client";
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
import { cleanJsonResponse } from "@/lib/ai/orchestrator";
import { getUserBehaviors, recordBehavior } from "@/lib/ai/behavior-tracker";
import {
  buildPersonalizationSystemPrompt,
  buildPersonalizationPrompt,
  type PersonalizationResult,
  type PersonalizationType,
} from "@/lib/ai/prompts/personalization";
import { apiMsg } from "@/lib/api-messages";

const schema = z.object({
  wid: z.string().uuid(),
  type: z
    .enum(["capability_recommendation", "prompt_optimization", "workflow_suggestion"])
    .default("capability_recommendation"),
});

/** 合法推荐类型集合 */
const VALID_TYPES: ReadonlySet<string> = new Set<PersonalizationType>([
  "capability_recommendation",
  "prompt_optimization",
  "workflow_suggestion",
]);

/**
 * 解析 AI 返回的个性化推荐 JSON，含格式校验与降级。
 *
 * @returns PersonalizationResult；解析失败返回空 recommendations
 */
function parseRecommendations(raw: string): PersonalizationResult {
  try {
    const cleaned = cleanJsonResponse(raw);
    const parsed: unknown = JSON.parse(cleaned);
    if (!parsed || typeof parsed !== "object") {
      return { recommendations: [] };
    }
    const obj = parsed as { recommendations?: unknown };
    if (!Array.isArray(obj.recommendations)) {
      return { recommendations: [] };
    }
    const recommendations = obj.recommendations
      .filter((r): r is Record<string, unknown> => r != null && typeof r === "object")
      .map((r) => {
        const type = typeof r.type === "string" && VALID_TYPES.has(r.type)
          ? (r.type as PersonalizationType)
          : "capability_recommendation";
        const content = (r.content ?? {}) as Record<string, unknown>;
        const score = typeof r.score === "number" && r.score >= 0 && r.score <= 1
          ? r.score
          : 0;
        return {
          type,
          content: {
            description: typeof content.description === "string" ? content.description : "",
            suggestion: typeof content.suggestion === "string" ? content.suggestion : "",
            reason: typeof content.reason === "string" ? content.reason : "",
          },
          score,
        };
      })
      // 过滤掉 description + suggestion 均为空的无效推荐
      .filter(
        (r) => r.content.description.trim() !== "" || r.content.suggestion.trim() !== "",
      )
      // 最多保留 5 条
      .slice(0, 5);

    return { recommendations };
  } catch {
    return { recommendations: [] };
  }
}

export async function POST(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) AI 服务配置检查
  if (!isAiConfigured()) return aiNotConfiguredResponse(req);

  // 3) 速率限制：每分钟 5 次（生成推荐较重）
  const limited = await checkRateLimit(req, "ai-personalization-generate", {
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

  try {
    // 6) 查询用户行为历史（最近 200 条）
    const behaviors = await runWithWorkspace(
      body.wid,
      (tx) => getUserBehaviors(tx, ctx.payload.sub, { limit: 200 }),
      ctx.payload.sub,
    );

    // 7) AI 生成个性化推荐（withUsageTracking 包装）
    const result = await withUsageTracking(
      {
        workspaceId: body.wid,
        userId: ctx.payload.sub,
        capability: "personalization-generate",
        model: requireDefaultModel().modelId,
      },
      async () => {
        const res = await generateText({
          model: requireDefaultModel(),
          system: withCoT(buildPersonalizationSystemPrompt(), requireDefaultModel()),
          prompt: buildPersonalizationPrompt(behaviors, body.type),
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

    // 8) 解析 AI 输出
    const parsed = parseRecommendations(result.text);

    // 9) 持久化推荐到 AiPersonalization + 记录生成行为
    const savedRecommendations = await runWithWorkspace(
      body.wid,
      async (tx) => {
        // 记录"生成推荐"行为
        await recordBehavior(
          tx,
          body.wid,
          ctx.payload.sub,
          "use_capability",
          "personalization-generate",
          { type: body.type, count: parsed.recommendations.length } as Prisma.InputJsonValue,
        );

        // 批量创建推荐记录
        if (parsed.recommendations.length === 0) return [];
        return tx.aiPersonalization.createManyAndReturn({
          data: parsed.recommendations.map((r) => ({
            workspaceId: body.wid,
            userId: ctx.payload.sub,
            type: r.type,
            content: r.content as unknown as Prisma.InputJsonValue,
            score: r.score,
          })),
        });
      },
      ctx.payload.sub,
    );

    return NextResponse.json({
      code: 200,
      data: { recommendations: savedRecommendations },
    });
  } catch (error) {
    console.error("[ai/personalization/generate] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}