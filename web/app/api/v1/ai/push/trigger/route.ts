// POST /api/v1/ai/push/trigger — 手动触发 AI 推送
//
// 输入：{ wid, capability, scheduleId }
// 流程：
//   1. 认证 + AI 配置检查 + 速率限制
//   2. body 校验 + 工作区守卫
//   3. 校验 schedule 归属当前用户（外键约束 + 权限）
//   4. 调用 generatePush（共享执行器，与 cron 自动执行器复用同一逻辑）
//   5. 返回完整 AiPushRecord
//
// 共享逻辑抽取至 @/lib/ai/push-runner（CAPABILITIES / SCOPES_BY_CAPABILITY /
// PROMPT_BUILDERS / safeSlice / extractPushContent / generatePush），
// 本路由仅保留 HTTP 层：认证 / 速率限制 / body 校验 / 工作区守卫 / schedule 归属校验。
//
// 来源：
//  - 经验 2026-09-15-usage-tracking-per-call-site-integration-by-mode（withUsageTracking 非流式包装）
//  - 经验 2026-09-15-ai-route-streaming-mode-and-model-pairing-rules（非流式 + 模型选择）

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
import { CAPABILITIES, type PushCapability, generatePush } from "@/lib/ai/push-runner";

const triggerSchema = z.object({
  wid: z.string().uuid(),
  capability: z.enum(CAPABILITIES),
  /** 关联的推送计划 ID（AiPushRecord.scheduleId 为必填外键） */
  scheduleId: z.string().uuid(),
});

/** POST /api/v1/ai/push/trigger — 手动触发推送 */
export async function POST(req: NextRequest) {
  // 1) 认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) AI 配置检查
  if (!isAiConfigured()) return aiNotConfiguredResponse(req);

  // 3) 速率限制：每分钟 5 次（AI 调用较重）
  const limited = await checkRateLimit(req, "ai-push-trigger", {
    windowMs: 60_000,
    max: 5,
  });
  if (limited) return limited;

  // 4) body 校验
  let body: z.infer<typeof triggerSchema>;
  try {
    body = triggerSchema.parse(await req.json());
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
    // 6) 校验 schedule 归属当前用户（外键约束 + 权限）
    //    先校验避免 generatePush 内部外键失败导致难以区分 404 vs 500
    const schedule = await runWithWorkspace(
      body.wid,
      (tx) =>
        tx.aiPushSchedule.findFirst({
          where: {
            id: body.scheduleId,
            workspaceId: body.wid,
            userId: ctx.payload.sub,
          },
          select: { id: true },
        }),
      ctx.payload.sub,
    );
    if (!schedule) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "workspaceNotFound"), data: null },
        { status: 404 },
      );
    }

    // 7) 调用 generatePush 生成推送内容并落库（AiPushRecord + 更新 schedule.lastRunAt）
    //    不传 tx：内部用 runWithWorkspace 自建 RLS 事务
    const pushResult = await generatePush({
      capability: body.capability as PushCapability,
      workspaceId: body.wid,
      userId: ctx.payload.sub,
      scheduleId: body.scheduleId,
    });

    if (!pushResult) {
      return NextResponse.json(
        { code: 500, message: apiMsg(req, "internalError"), data: null },
        { status: 500 },
      );
    }

    // 8) 返回完整 AiPushRecord（保持原 API 响应语义，前端依赖 record 完整字段）
    const record = await runWithWorkspace(
      body.wid,
      (tx) => tx.aiPushRecord.findUnique({ where: { id: pushResult.recordId } }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 200, data: record }, { status: 201 });
  } catch (error) {
    console.error("[POST ai/push/trigger] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}
