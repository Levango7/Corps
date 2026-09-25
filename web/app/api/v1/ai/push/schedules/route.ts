// GET  /api/v1/ai/push/schedules — 获取当前用户的推送计划列表
// POST /api/v1/ai/push/schedules — 创建推送计划
//
// 查询/请求体通过 wid 绑定工作区，经 getWorkspaceContext 做 RLS 守卫。
// AiPushSchedule 为用户级配置（userId + workspaceId + capability 唯一约束由业务保证）。

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import {
  getUserId,
  unauthorizedResponse,
  isAiConfigured,
  aiNotConfiguredResponse,
} from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace, runWithAuthOp } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";
import { logger } from "@/lib/logger";

/** 推送能力枚举（与 Prisma schema capability VarChar(50) 对齐） */
const CAPABILITIES = ["daily_briefing", "risk_alert", "progress_anomaly"] as const;

const createSchema = z.object({
  wid: z.string().uuid(),
  capability: z.enum(CAPABILITIES),
  cron: z.string().min(1).max(50),
  enabled: z.boolean().default(true),
  config: z.record(z.unknown()).optional(),
});

/** 推送频率枚举（M2 闭环完善） */
const FREQUENCIES = ["daily", "weekly", "hourly"] as const;

/** PATCH 请求体校验：静默时段 + 推送频率配置 */
const patchSchema = z
  .object({
    scheduleId: z.string().uuid(),
    quietHoursStart: z.number().int().min(0).max(23).optional(),
    quietHoursEnd: z.number().int().min(0).max(23).optional(),
    frequency: z.enum(FREQUENCIES).optional(),
  })
  .refine(
    (data) =>
      data.quietHoursStart !== undefined ||
      data.quietHoursEnd !== undefined ||
      data.frequency !== undefined,
    { message: "至少需要提供一个可更新字段" },
  );

/** GET /api/v1/ai/push/schedules?wid=<uuid> — 当前用户的推送计划列表 */
export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  const limited = await checkRateLimit(req, "ai-push-schedules-list", {
    windowMs: 60_000,
    max: 30,
  });
  if (limited) return limited;

  const url = new URL(req.url);
  const wid = url.searchParams.get("wid");
  if (!wid) {
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "invalidParams"), data: null },
      { status: 400 },
    );
  }

  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  try {
    const schedules = await runWithWorkspace(
      wid,
      (tx) =>
        tx.aiPushSchedule.findMany({
          where: { workspaceId: wid, userId: ctx.payload.sub },
          orderBy: { createdAt: "desc" },
        }),
      ctx.payload.sub,
    );
    return NextResponse.json({ code: 200, data: schedules });
  } catch (error) {
    console.error("[GET ai/push/schedules] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}

/** POST /api/v1/ai/push/schedules — 创建推送计划 */
export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  const limited = await checkRateLimit(req, "ai-push-schedules-create", {
    windowMs: 60_000,
    max: 10,
  });
  if (limited) return limited;

  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await req.json());
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

  const ctx = await getWorkspaceContext(req, body.wid);
  if (!ctx) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  try {
    const schedule = await runWithWorkspace(
      body.wid,
      (tx) =>
        tx.aiPushSchedule.create({
          data: {
            workspaceId: body.wid,
            userId: ctx.payload.sub,
            capability: body.capability,
            cron: body.cron,
            enabled: body.enabled,
            config: body.config ? (body.config as Prisma.InputJsonValue) : undefined,
          },
        }),
      ctx.payload.sub,
    );
    return NextResponse.json({ code: 200, data: schedule }, { status: 201 });
  } catch (error) {
    console.error("[POST ai/push/schedules] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}
/**
 * PATCH /api/v1/ai/push/schedules — 更新推送计划配置（静默时段 + 推送频率）
 *
 * 请求体：{ scheduleId, quietHoursStart?, quietHoursEnd?, frequency? }
 * - scheduleId 必填，定位要更新的计划
 * - quietHoursStart/quietHoursEnd：静默时段起止小时（0-23），传 null/undefined 清除
 * - frequency：推送频率（daily/weekly/hourly）
 *
 * 鉴权：getUserId + isAiConfigured + checkRateLimit
 * RLS：先查 schedule 拿 workspaceId（runWithAuthOp cron 逃生口），校验 userId 归属后
 *      用 runWithWorkspace(wid) 在 RLS 事务内更新。
 *
 * 返回 { code: 0, data, message } 信封格式。
 */
export async function PATCH(req: NextRequest) {
  // 1) 认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) AI 服务配置检查
  if (!isAiConfigured()) return aiNotConfiguredResponse(req);

  // 3) 限流
  const limited = await checkRateLimit(req, "ai-push-schedules-update", {
    windowMs: 60_000,
    max: 30,
  });
  if (limited) return limited;

  // 4) 解析 + 校验请求体
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

  try {
    // 5) 查 schedule 拿 workspaceId + userId（cron 逃生口绕过 RLS 只读元数据）
    const schedule = await runWithAuthOp("cron", async (tx) => {
      return tx.aiPushSchedule.findUnique({
        where: { id: body.scheduleId },
        select: { workspaceId: true, userId: true },
      });
    });

    if (!schedule) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "pushScheduleNotFound"), data: null },
        { status: 404 },
      );
    }

    // 6) 校验 schedule 归属当前用户（防越权改他人计划）
    if (schedule.userId !== userId) {
      return NextResponse.json(
        { code: 403, message: apiMsg(req, "forbidden"), data: null },
        { status: 403 },
      );
    }

    // 7) 在 RLS 事务内更新（仅更新提供的字段）
    const updated = await runWithWorkspace(
      schedule.workspaceId,
      (tx) =>
        tx.aiPushSchedule.update({
          where: { id: body.scheduleId },
          data: {
            quietHoursStart: body.quietHoursStart,
            quietHoursEnd: body.quietHoursEnd,
            frequency: body.frequency,
          },
        }),
      userId,
    );

    return NextResponse.json({
      code: 0,
      data: updated,
      message: apiMsg(req, "ok"),
    });
  } catch (error) {
    logger.warn("[PATCH ai/push/schedules] error", {
      error: error instanceof Error ? error.message : String(error),
      scheduleId: body.scheduleId,
    });
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}
