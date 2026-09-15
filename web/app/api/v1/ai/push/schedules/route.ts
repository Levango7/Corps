// GET  /api/v1/ai/push/schedules — 获取当前用户的推送计划列表
// POST /api/v1/ai/push/schedules — 创建推送计划
//
// 查询/请求体通过 wid 绑定工作区，经 getWorkspaceContext 做 RLS 守卫。
// AiPushSchedule 为用户级配置（userId + workspaceId + capability 唯一约束由业务保证）。

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";

/** 推送能力枚举（与 Prisma schema capability VarChar(50) 对齐） */
const CAPABILITIES = ["daily_briefing", "risk_alert", "progress_anomaly"] as const;

const createSchema = z.object({
  wid: z.string().uuid(),
  capability: z.enum(CAPABILITIES),
  cron: z.string().min(1).max(50),
  enabled: z.boolean().default(true),
  config: z.record(z.unknown()).optional(),
});

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
            config: body.config
              ? (body.config as Prisma.InputJsonValue)
              : undefined,
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