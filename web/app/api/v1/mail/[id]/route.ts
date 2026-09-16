// GET    /api/v1/mail/{id}?wid=xxx          — 邮件详情
// PATCH  /api/v1/mail/{id}                  — 更新邮件（isRead, isStarred）
//        Body: { wid, isRead?, isStarred?, status? }
// DELETE /api/v1/mail/{id}?wid=xxx          — 删除邮件
//
// 认证模式：getUserId → checkRateLimit → getWorkspaceContext → runWithWorkspace（RLS 事务）
// 安全：通过 workspaceId + accountId（归属当前用户）过滤确保用户只能操作自己的邮件
// 约定：{ code, data, message }
//
// 经验来源：2026-09-15-ai-route-unified-pattern-audit-checklist

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import {
  getUserId,
  unauthorizedResponse,
} from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";

/** PATCH 更新邮件 schema */
const patchSchema = z.object({
  wid: z.string().uuid(),
  isRead: z.boolean().optional(),
  isStarred: z.boolean().optional(),
  status: z.enum(["draft", "sent", "received"]).optional(),
});

/** GET/DELETE 查询参数 schema */
const querySchema = z.object({
  wid: z.string().uuid(),
});

/**
 * GET /api/v1/mail/{id}?wid=xxx — 邮件详情
 *
 * 返回邮件完整信息（含正文）。仅允许邮件所属账户的拥有者查看。
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 1.5) 限流
  const limited = await checkRateLimit(req, "mail-detail", {
    windowMs: 60_000,
    max: 60,
  });
  if (limited) return limited;

  // 2) 查询参数校验
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    wid: url.searchParams.get("wid") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      {
        code: 400,
        message:
          parsed.error.issues[0]?.message ?? apiMsg(req, "invalidParams"),
        data: null,
      },
      { status: 400 },
    );
  }
  const { wid } = parsed.data;

  // 3) 工作区成员资格认证 + 查询
  try {
    const ctx = await getWorkspaceContext(req, wid);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }

    // 先查出当前用户的所有账户 ID，用于过滤 Mail
    const accountIds = await runWithWorkspace(
      wid,
      (tx) =>
        tx.emailAccount.findMany({
          where: { workspaceId: wid, userId: ctx.payload.sub },
          select: { id: true },
        }),
      ctx.payload.sub,
    );

    const allowedAccountIds = accountIds.map((a) => a.id);

    const mail = await runWithWorkspace(
      wid,
      (tx) =>
        tx.mail.findFirst({
          where: {
            id,
            workspaceId: wid,
            accountId: { in: allowedAccountIds },
          },
          select: {
            id: true,
            accountId: true,
            messageId: true,
            fromAddr: true,
            toAddr: true,
            ccAddr: true,
            bccAddr: true,
            subject: true,
            bodyText: true,
            bodyHtml: true,
            status: true,
            attachments: true,
            isRead: true,
            isStarred: true,
            inReplyTo: true,
            sentAt: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
      ctx.payload.sub,
    );

    if (!mail) {
      return NextResponse.json(
        { code: 404, data: null, message: apiMsg(req, "mailNotFound") },
        { status: 404 },
      );
    }

    return NextResponse.json({ code: 0, data: mail, message: "OK" });
  } catch (error) {
    console.error("[GET mail/:id] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/v1/mail/{id} — 更新邮件（isRead, isStarred, status）
 *
 * 仅允许邮件所属账户的拥有者更新。
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 1.5) 限流
  const limited = await checkRateLimit(req, "mail-update", {
    windowMs: 60_000,
    max: 60,
  });
  if (limited) return limited;

  // 2) body 校验
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

  // 3) 工作区成员资格认证 + 更新
  try {
    const ctx = await getWorkspaceContext(req, body.wid);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }

    // 先查出当前用户的所有账户 ID
    const accountIds = await runWithWorkspace(
      body.wid,
      (tx) =>
        tx.emailAccount.findMany({
          where: { workspaceId: body.wid, userId: ctx.payload.sub },
          select: { id: true },
        }),
      ctx.payload.sub,
    );

    const allowedAccountIds = accountIds.map((a) => a.id);

    const result = await runWithWorkspace(
      body.wid,
      async (tx) => {
        const existing = await tx.mail.findFirst({
          where: {
            id,
            workspaceId: body.wid,
            accountId: { in: allowedAccountIds },
          },
          select: { id: true },
        });
        if (!existing) return { kind: "notFound" as const };

        const data: Prisma.MailUpdateInput = {};
        if (body.isRead !== undefined) data.isRead = body.isRead;
        if (body.isStarred !== undefined) data.isStarred = body.isStarred;
        if (body.status !== undefined) data.status = body.status;

        const updated = await tx.mail.update({
          where: { id },
          data,
          select: {
            id: true,
            isRead: true,
            isStarred: true,
            status: true,
            updatedAt: true,
          },
        });
        return { kind: "ok" as const, mail: updated };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound") {
      return NextResponse.json(
        { code: 404, data: null, message: apiMsg(req, "mailNotFound") },
        { status: 404 },
      );
    }

    return NextResponse.json({
      code: 0,
      data: result.mail,
      message: apiMsg(req, "ok"),
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json(
        { code: 404, data: null, message: apiMsg(req, "mailNotFound") },
        { status: 404 },
      );
    }
    console.error("[PATCH mail/:id] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/v1/mail/{id}?wid=xxx — 删除邮件
 *
 * 仅允许邮件所属账户的拥有者删除。
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 1.5) 限流
  const limited = await checkRateLimit(req, "mail-delete", {
    windowMs: 60_000,
    max: 30,
  });
  if (limited) return limited;

  // 2) 查询参数校验
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    wid: url.searchParams.get("wid") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      {
        code: 400,
        message:
          parsed.error.issues[0]?.message ?? apiMsg(req, "invalidParams"),
        data: null,
      },
      { status: 400 },
    );
  }
  const { wid } = parsed.data;

  // 3) 工作区成员资格认证 + 删除
  try {
    const ctx = await getWorkspaceContext(req, wid);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }

    // 先查出当前用户的所有账户 ID
    const accountIds = await runWithWorkspace(
      wid,
      (tx) =>
        tx.emailAccount.findMany({
          where: { workspaceId: wid, userId: ctx.payload.sub },
          select: { id: true },
        }),
      ctx.payload.sub,
    );

    const allowedAccountIds = accountIds.map((a) => a.id);

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        const existing = await tx.mail.findFirst({
          where: {
            id,
            workspaceId: wid,
            accountId: { in: allowedAccountIds },
          },
          select: { id: true },
        });
        if (!existing) return { kind: "notFound" as const };

        await tx.mail.delete({ where: { id } });
        return { kind: "ok" as const };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound") {
      return NextResponse.json(
        { code: 404, data: null, message: apiMsg(req, "mailNotFound") },
        { status: 404 },
      );
    }

    return NextResponse.json({
      code: 0,
      data: null,
      message: apiMsg(req, "ok"),
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json(
        { code: 404, data: null, message: apiMsg(req, "mailNotFound") },
        { status: 404 },
      );
    }
    console.error("[DELETE mail/:id] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}