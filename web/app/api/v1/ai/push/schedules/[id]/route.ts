// PATCH  /api/v1/ai/push/schedules/[id] — 更新推送计划（enabled/config/cron）
// DELETE /api/v1/ai/push/schedules/[id] — 删除推送计划
//
// 通过 body.wid 绑定工作区做 RLS 守卫；仅计划所属用户可操作（userId 匹配）。

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";

const patchSchema = z.object({
  wid: z.string().uuid(),
  cron: z.string().min(1).max(50).optional(),
  enabled: z.boolean().optional(),
  config: z.record(z.unknown()).optional(),
});

/** PATCH /api/v1/ai/push/schedules/{id} — 更新推送计划 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  const limited = await checkRateLimit(req, "ai-push-schedules-update", {
    windowMs: 60_000,
    max: 20,
  });
  if (limited) return limited;

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

  const ctx = await getWorkspaceContext(req, body.wid);
  if (!ctx) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  try {
    // 先校验计划归属当前用户（RLS 事务内查询）
    const existing = await runWithWorkspace(
      body.wid,
      (tx) =>
        tx.aiPushSchedule.findFirst({
          where: { id, workspaceId: body.wid, userId: ctx.payload.sub },
          select: { id: true },
        }),
      ctx.payload.sub,
    );
    if (!existing) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "workspaceNotFound"), data: null },
        { status: 404 },
      );
    }

    const updated = await runWithWorkspace(
      body.wid,
      (tx) =>
        tx.aiPushSchedule.update({
          where: { id },
          data: {
            cron: body.cron,
            enabled: body.enabled,
            config: body.config ? (body.config as Prisma.InputJsonValue) : undefined,
          },
        }),
      ctx.payload.sub,
    );
    return NextResponse.json({ code: 200, data: updated });
  } catch (error) {
    console.error("[PATCH ai/push/schedules/[id]] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}

/** DELETE /api/v1/ai/push/schedules/{id} — 删除推送计划 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  const limited = await checkRateLimit(req, "ai-push-schedules-delete", {
    windowMs: 60_000,
    max: 10,
  });
  if (limited) return limited;

  // wid 从 query 参数获取（DELETE 通常无 body）
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
    // 校验归属后删除（级联删除关联的 AiPushRecord）
    const existing = await runWithWorkspace(
      wid,
      (tx) =>
        tx.aiPushSchedule.findFirst({
          where: { id, workspaceId: wid, userId: ctx.payload.sub },
          select: { id: true },
        }),
      ctx.payload.sub,
    );
    if (!existing) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "workspaceNotFound"), data: null },
        { status: 404 },
      );
    }

    await runWithWorkspace(
      wid,
      (tx) => tx.aiPushSchedule.delete({ where: { id } }),
      ctx.payload.sub,
    );
    return NextResponse.json({ code: 200, data: null });
  } catch (error) {
    console.error("[DELETE ai/push/schedules/[id]] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}
