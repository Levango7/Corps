// PATCH  /api/v1/notifications/[id]?workspaceId=xxx — 标记已读/未读
//        Body: { read: boolean }
// DELETE /api/v1/notifications/[id]?workspaceId=xxx — 删除通知
//
// 认证模式：getUserId → checkRateLimit → getWorkspaceContext → runWithWorkspace（RLS 事务）
// 安全：先查通知确认属于当前用户 + 工作区，再更新/删除（防越权操作他人通知）
// 约定：{ code, data, message }
//
// 经验来源：2026-09-15-ai-route-unified-pattern-audit-checklist
//  - checkRateLimit 认证后立即调用
//  - 越权风险：先验证通知 ownership 再操作
//  - DB 操作用 try-catch 包裹，catch 返回 503 internalError

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";

/** 查询参数 schema（workspaceId 用于 RLS 上下文） */
const querySchema = z.object({
  workspaceId: z.string().uuid(),
});

/** PATCH body schema */
const patchSchema = z.object({
  read: z.boolean(),
});

/**
 * PATCH /api/v1/notifications/[id]?workspaceId=xxx
 *
 * 标记通知已读/未读。先验证通知属于当前用户 + 工作区，再更新。
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 1.5) 限流：60s 内最多 60 次
  const limited = await checkRateLimit(req, "notification-update", {
    windowMs: 60_000,
    max: 60,
  });
  if (limited) return limited;

  // 2) 路径参数 + 查询参数校验
  const { id } = await params;
  const url = new URL(req.url);
  const parsedQuery = querySchema.safeParse({
    workspaceId: url.searchParams.get("workspaceId") ?? undefined,
  });
  if (!parsedQuery.success) {
    return NextResponse.json(
      {
        code: 400,
        message:
          parsedQuery.error.issues[0]?.message ?? apiMsg(req, "invalidParams"),
        data: null,
      },
      { status: 400 },
    );
  }
  const { workspaceId } = parsedQuery.data;

  // 3) body 校验
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

  // 4) 工作区成员资格认证 + 更新
  try {
    const ctx = await getWorkspaceContext(req, workspaceId);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }

    // 先验证通知属于当前用户 + 工作区（防越权）
    const notification = await runWithWorkspace(
      workspaceId,
      (tx) =>
        tx.notification.findFirst({
          where: {
            id,
            userId: ctx.payload.sub,
            workspaceId,
          },
          select: { id: true },
        }),
      ctx.payload.sub,
    );

    if (!notification) {
      return NextResponse.json(
        { code: 404, data: null, message: apiMsg(req, "itemNotFound") },
        { status: 404 },
      );
    }

    const updated = await runWithWorkspace(
      workspaceId,
      (tx) =>
        tx.notification.update({
          where: { id },
          data: { read: body.read },
          select: {
            id: true,
            type: true,
            entityId: true,
            entityTitle: true,
            read: true,
            createdAt: true,
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({
      code: 0,
      data: { ...updated, createdAt: updated.createdAt.toISOString() },
      message: "OK",
    });
  } catch (error) {
    console.error("[PATCH notifications/[id]] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/v1/notifications/[id]?workspaceId=xxx
 *
 * 删除通知。先验证通知属于当前用户 + 工作区，再删除。
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 1.5) 限流：60s 内最多 30 次
  const limited = await checkRateLimit(req, "notification-delete", {
    windowMs: 60_000,
    max: 30,
  });
  if (limited) return limited;

  // 2) 路径参数 + 查询参数校验
  const { id } = await params;
  const url = new URL(req.url);
  const parsedQuery = querySchema.safeParse({
    workspaceId: url.searchParams.get("workspaceId") ?? undefined,
  });
  if (!parsedQuery.success) {
    return NextResponse.json(
      {
        code: 400,
        message:
          parsedQuery.error.issues[0]?.message ?? apiMsg(req, "invalidParams"),
        data: null,
      },
      { status: 400 },
    );
  }
  const { workspaceId } = parsedQuery.data;

  // 3) 工作区成员资格认证 + 删除
  try {
    const ctx = await getWorkspaceContext(req, workspaceId);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }

    // 先验证通知属于当前用户 + 工作区（防越权）
    const notification = await runWithWorkspace(
      workspaceId,
      (tx) =>
        tx.notification.findFirst({
          where: {
            id,
            userId: ctx.payload.sub,
            workspaceId,
          },
          select: { id: true },
        }),
      ctx.payload.sub,
    );

    if (!notification) {
      return NextResponse.json(
        { code: 404, data: null, message: apiMsg(req, "itemNotFound") },
        { status: 404 },
      );
    }

    await runWithWorkspace(
      workspaceId,
      (tx) => tx.notification.delete({ where: { id } }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 0, data: null, message: "OK" });
  } catch (error) {
    console.error("[DELETE notifications/[id]] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}