// POST /api/v1/ai/orchestrate — AI 跨能力联动方案生成（非流式）
// 输入：{ wid, userRequest? }
// 输出：{ code: 200, data: OrchestrationPlan }
// 速率限制：3/min
//
// PATCH /api/v1/ai/orchestrate — 执行用户确认的联动方案
// 输入：{ wid, actions: AiAction[] }
// 输出：{ code: 200, data: { success, results } }
// 速率限制：5/min
//
// 安全约束：POST 仅生成建议方案，不执行任何操作；
// PATCH 须用户确认方案后才调用，操作在 RLS 事务内原子执行。
// DEEPSEEK_API_KEY 未配置时返回 503。

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getUserId,
  unauthorizedResponse,
  aiNotConfiguredResponse,
  isAiConfigured,
} from "@/lib/ai/shared";
import { withUsageTracking } from "@/lib/ai/usage-middleware";
import {
  suggestOrchestration,
  executeOrchestration,
  validateActionFields,
  type OrchestrationPlan,
} from "@/lib/ai/orchestrator";
import type { AiAction, AiActionResult } from "@/lib/ai/executor";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";
import { getWorkspaceContext } from "@/lib/auth";

// ─── POST schema：生成联动方案 ───
const postSchema = z.object({
  wid: z.string().uuid(),
  userRequest: z.string().max(500).optional(),
});

// ─── PATCH schema：执行联动方案 ───
// type 用 z.enum 白名单校验（8 种合法 action），passthrough 保留其余字段，
// 必填字段 + 枚举值校验由 validateActionFields 在 handler 内完成
const actionSchema = z
  .object({
    type: z.enum([
      "createTask",
      "linkToOkr",
      "notify",
      "createDocument",
      "scheduleMeeting",
      "updateTaskStatus",
      "createDecision",
      "sendAnnouncement",
    ]),
  })
  .passthrough();
const patchSchema = z.object({
  wid: z.string().uuid(),
  actions: z.array(actionSchema).min(1).max(5),
});

/**
 * POST — 生成跨能力联动方案。
 *
 * 认证 → AI 配置检查 → 速率限制 → body 校验 → 工作区上下文校验 → suggestOrchestration
 */
export async function POST(req: NextRequest) {
  // 1) 认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) AI 服务配置检查
  if (!isAiConfigured()) return aiNotConfiguredResponse(req);

  // 3) 速率限制：每分钟 3 次
  const limited = await checkRateLimit(req, "ai-orchestrate-suggest", {
    windowMs: 60_000,
    max: 3,
  });
  if (limited) return limited;

  // 4) body 校验
  let body: z.infer<typeof postSchema>;
  try {
    body = postSchema.parse(await req.json());
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

  // 6) 生成联动方案
  try {
    // 用 withUsageTracking 包装 suggestOrchestration（内部 generateText 不暴露 usage，
    // 此处记录调用耗时与成败，token 数为 0）
    const plan = await withUsageTracking(
      {
        workspaceId: body.wid,
        userId: ctx.payload.sub,
        capability: "orchestrate",
        model: "deepseek-reasoner",
      },
      async () => {
        const res = await suggestOrchestration(body.wid, ctx.payload.sub, body.userRequest);
        return { result: res };
      },
    );

    if (!plan) {
      return NextResponse.json(
        { code: 500, message: apiMsg(req, "internalError"), data: null },
        { status: 500 },
      );
    }

    return NextResponse.json({
      code: 200,
      data: plan satisfies OrchestrationPlan,
    });
  } catch (error) {
    console.error("[POST ai/orchestrate] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}

/**
 * PATCH — 执行用户确认的联动方案。
 *
 * 认证 → AI 配置检查 → 速率限制 → body 校验 → 工作区上下文校验 → executeOrchestration
 * 操作在 RLS 事务内原子执行（任一失败全部回滚）。
 */
export async function PATCH(req: NextRequest) {
  // 1) 认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) AI 服务配置检查
  if (!isAiConfigured()) return aiNotConfiguredResponse(req);

  // 3) 速率限制：每分钟 5 次
  const limited = await checkRateLimit(req, "ai-orchestrate-execute", {
    windowMs: 60_000,
    max: 5,
  });
  if (limited) return limited;

  // 4) body 校验
  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
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

  // 6) 校验每个 action 的必填字段 + 枚举值（type 已由 z.enum 校验）
  for (const action of body.actions) {
    if (!validateActionFields(action as Record<string, unknown>)) {
      return NextResponse.json(
        {
          code: 400,
          message: apiMsg(req, "validationFailed"),
          data: null,
        },
        { status: 400 },
      );
    }
  }

  // 7) 执行联动方案（RLS 事务内原子执行）
  try {
    // z.enum 已校验 type ∈ 8 种合法枚举，validateActionFields 已校验必填字段 + 枚举值，
    // passthrough 保留所有字段，断言安全
    const actions = body.actions as AiAction[];
    // 用 withUsageTracking 包装 executeOrchestration（与 POST 保持一致，
    // 记录调用耗时与成败，token 数为 0）
    const executeFn = async () => {
      const res = await executeOrchestration(body.wid, ctx.payload.sub, actions);
      return { result: res };
    };
    const results = await withUsageTracking(
      {
        workspaceId: body.wid,
        userId: ctx.payload.sub,
        capability: "orchestrate",
        model: "deepseek-chat",
      },
      executeFn,
    );
    const success = results.every((r) => r.success);

    return NextResponse.json({
      code: 200,
      data: {
        success,
        results: results satisfies AiActionResult[],
      },
    });
  } catch (error) {
    console.error("[PATCH ai/orchestrate] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}
