/**
 * IM 消息编辑/撤回端点
 *
 * 路由：
 *  - PATCH /api/v1/im/messages/{id}  编辑消息（5 分钟内可编辑）
 *  - DELETE /api/v1/im/messages/{id} 撤回消息（5 分钟内可撤回）
 *
 * ─── 业务规则 ─────────────────────────────────────────────────
 *  1. 仅消息作者可编辑；作者可撤回，管理员可撤回他人消息
 *  2. 已撤回消息不可编辑/再次撤回（revokedAt === null）
 *  3. 发送 5 分钟内可编辑/撤回（管理员撤回不受时间限制）
 *  4. 撤回为软删除：保留行，前端展示"此消息已撤回"
 *  5. 编辑更新 body + editedAt = now()，允许多次编辑（5 分钟内）
 *
 * ─── 安全 ─────────────────────────────────────────────────────
 *  - getWorkspaceContext 校验工作区成员资格 + RLS 上下文
 *  - checkRateLimit 防滥用（60s 内 30 次）
 *  - zod 校验请求体
 *  - 所有 DB 操作经 runWithWorkspace 注入 RLS
 *  - apiMsg 双语响应
 *
 * ─── 信封约定 ─────────────────────────────────────────────────
 *  成功：{ code: 200, data, message }
 *  失败：{ code: <http>, message, data: null }
 */

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";
import { z } from "zod";
import { Prisma } from "@prisma/client";

/** 编辑/撤回时间窗口（毫秒）：5 分钟 */
const EDIT_WINDOW_MS = 5 * 60 * 1000;

/** 编辑请求体 schema */
const patchSchema = z.object({
  workspaceId: z.string().uuid(),
  body: z.string().min(1).max(10000),
});

/** 撤回请求体 schema（DELETE 也用 body 传 workspaceId，更符合既有模式） */
const deleteSchema = z.object({
  workspaceId: z.string().uuid(),
});

/**
 * PATCH /api/v1/im/messages/{id} — 编辑消息
 *
 * 请求体：{ workspaceId, body }
 *  - body 非空字符串，最长 10000
 *
 * 校验链：
 *  1. 认证 + 工作区成员资格
 *  2. 限流
 *  3. 消息存在 + 属于该工作区
 *  4. 作者 === 当前用户
 *  5. 未撤回
 *  6. 距 createdAt < 5 分钟
 *
 * 返回更新后的消息（含 author 内联）。
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  // 1) 解析请求体（先于认证，以便 zod 错误统一格式）
  let parsed: z.infer<typeof patchSchema>;
  try {
    const json = await req.json();
    parsed = patchSchema.parse(json);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          code: 400,
          message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"),
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

  const { workspaceId, body } = parsed;

  // 2) 认证 + 工作区上下文
  const ctx = await getWorkspaceContext(req, workspaceId);
  if (!ctx) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  // 3) 限流（认证后立即调用，防滥用）
  const limited = await checkRateLimit(req, "im-message-edit", {
    windowMs: 60_000,
    max: 30,
  });
  if (limited) return limited;

  try {
    // 4) 事务内完成存在性校验 + 编辑窗口校验 + 更新
    const result = await runWithWorkspace(
      workspaceId,
      async (tx) => {
        const existing = await tx.message.findFirst({
          where: { id, workspaceId },
          select: {
            id: true,
            authorId: true,
            revokedAt: true,
            createdAt: true,
          },
        });

        if (!existing) return { kind: "notFound" as const };
        if (existing.authorId !== ctx.payload.sub) {
          return { kind: "forbidden" as const };
        }
        if (existing.revokedAt !== null) {
          return { kind: "revoked" as const };
        }
        if (Date.now() - existing.createdAt.getTime() > EDIT_WINDOW_MS) {
          return { kind: "expired" as const };
        }

        const updated = await tx.message.update({
          where: { id },
          data: {
            body,
            editedAt: new Date(),
          },
          include: {
            author: { select: { id: true, name: true, email: true, image: true } },
          },
        });
        return { kind: "ok" as const, message: updated };
      },
      ctx.payload.sub,
    );

    switch (result.kind) {
      case "notFound":
        return NextResponse.json(
          { code: 404, message: apiMsg(req, "messageNotFound"), data: null },
          { status: 404 },
        );
      case "forbidden":
        return NextResponse.json(
          { code: 403, message: apiMsg(req, "canOnlyEditOwnMessage"), data: null },
          { status: 403 },
        );
      case "revoked":
        return NextResponse.json(
          { code: 409, message: apiMsg(req, "messageRevoked"), data: null },
          { status: 409 },
        );
      case "expired":
        return NextResponse.json(
          { code: 403, message: apiMsg(req, "revokeTimeExceeded"), data: null },
          { status: 403 },
        );
      case "ok":
        return NextResponse.json({
          code: 200,
          data: result.message,
          message: apiMsg(req, "ok"),
        });
    }
  } catch (error) {
    // P2025：记录不存在（并发删除场景）→ 404
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "messageNotFound"), data: null },
        { status: 404 },
      );
    }
    console.error("[PATCH /im/messages/:id] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/v1/im/messages/{id} — 撤回消息
 *
 * 请求体：{ workspaceId }
 *
 * 校验链：
 *  1. 认证 + 工作区成员资格
 *  2. 限流
 *  3. 消息存在 + 属于该工作区
 *  4. 作者可撤回（5 分钟内）；管理员可撤回他人消息（不受时间限制）
 *  5. 未撤回
 *
 * 软删除：设置 revokedAt + revokedBy，不删除行。
 * 前端展示"此消息已撤回"。
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  // 1) 解析请求体
  let parsed: z.infer<typeof deleteSchema>;
  try {
    const json = await req.json();
    parsed = deleteSchema.parse(json);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          code: 400,
          message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"),
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

  const { workspaceId } = parsed;

  // 2) 认证 + 工作区上下文
  const ctx = await getWorkspaceContext(req, workspaceId);
  if (!ctx) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  // 3) 限流
  const limited = await checkRateLimit(req, "im-message-revoke", {
    windowMs: 60_000,
    max: 30,
  });
  if (limited) return limited;

  try {
    // 4) 事务内完成校验 + 软删除
    const result = await runWithWorkspace(
      workspaceId,
      async (tx) => {
        const existing = await tx.message.findFirst({
          where: { id, workspaceId },
          select: {
            id: true,
            authorId: true,
            revokedAt: true,
            createdAt: true,
            conversationId: true,
          },
        });

        if (!existing) return { kind: "notFound" as const };

        const isAuthor = existing.authorId === ctx.payload.sub;
        // 查询会话成员角色（如果有 conversationId），判断是否为管理员
        let isAdmin = false;
        if (existing.conversationId) {
          const membership = await tx.conversationMember.findFirst({
            where: {
              conversationId: existing.conversationId,
              userId: ctx.payload.sub,
            },
            select: { role: true },
          });
          isAdmin = membership?.role === "owner" || membership?.role === "admin";
        }

        // 权限校验：作者或管理员可撤回
        if (!isAuthor && !isAdmin) {
          return { kind: "forbidden" as const };
        }
        if (existing.revokedAt !== null) {
          return { kind: "revoked" as const };
        }
        // 时间窗口：作者 5 分钟内，管理员不受限
        if (isAuthor && !isAdmin && Date.now() - existing.createdAt.getTime() > EDIT_WINDOW_MS) {
          return { kind: "expired" as const };
        }

        await tx.message.update({
          where: { id },
          data: {
            revokedAt: new Date(),
            revokedBy: ctx.payload.sub,
          },
        });
        return { kind: "ok" as const };
      },
      ctx.payload.sub,
    );

    switch (result.kind) {
      case "notFound":
        return NextResponse.json(
          { code: 404, message: apiMsg(req, "messageNotFound"), data: null },
          { status: 404 },
        );
      case "forbidden":
        return NextResponse.json(
          { code: 403, message: apiMsg(req, "forbidden"), data: null },
          { status: 403 },
        );
      case "revoked":
        return NextResponse.json(
          { code: 409, message: apiMsg(req, "messageRevoked"), data: null },
          { status: 409 },
        );
      case "expired":
        return NextResponse.json(
          { code: 403, message: apiMsg(req, "revokeTimeExceeded"), data: null },
          { status: 403 },
        );
      case "ok":
        return NextResponse.json({
          code: 200,
          data: null,
          message: apiMsg(req, "ok"),
        });
    }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "messageNotFound"), data: null },
        { status: 404 },
      );
    }
    console.error("[DELETE /im/messages/:id] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}
