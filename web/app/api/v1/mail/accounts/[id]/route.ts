// DELETE /api/v1/mail/accounts/{id}?wid=xxx — 删除邮箱账户
// PATCH   /api/v1/mail/accounts/{id}        — 更新账户配置
//      Body: { wid, displayName?, smtpHost?, smtpPort?, smtpSecure?, credential?, isDefault? }
//
// 认证模式：getUserId → checkRateLimit → getWorkspaceContext → runWithWorkspace（RLS 事务）
// 安全：通过 workspaceId + userId 过滤确保用户只能操作自己的账户
// 约定：{ code, data, message }；credential 更新时经 Base64 编码。
//
// 经验来源：2026-09-15-ai-route-unified-pattern-audit-checklist

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";
import { encodeCredential } from "@/lib/mail/transporter";

/** PATCH 更新账户 schema（所有字段可选，wid 必填用于鉴权） */
const patchSchema = z.object({
  wid: z.string().uuid(),
  displayName: z.string().max(100).nullable().optional(),
  smtpHost: z.string().max(200).optional(),
  smtpPort: z.coerce.number().int().min(1).max(65535).optional(),
  smtpSecure: z.boolean().optional(),
  credential: z.string().min(1).max(2000).optional(), // 明文密码，存储前 Base64 编码
  isDefault: z.boolean().optional(),
});

/** DELETE 查询参数 schema */
const deleteQuerySchema = z.object({
  wid: z.string().uuid(),
});

/**
 * PATCH /api/v1/mail/accounts/{id} — 更新账户配置
 *
 * 仅允许账户所有者更新。credential 若提供则重新 Base64 编码。
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
  const limited = await checkRateLimit(req, "mail-accounts-update", {
    windowMs: 60_000,
    max: 30,
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

    // 事务内先校验归属再更新
    const result = await runWithWorkspace(
      body.wid,
      async (tx) => {
        const existing = await tx.emailAccount.findFirst({
          where: { id, workspaceId: body.wid, userId: ctx.payload.sub },
          select: { id: true },
        });
        if (!existing) return { kind: "notFound" as const };

        // 组装更新数据（仅包含提供的字段）
        const data: Prisma.EmailAccountUpdateInput = {};
        if (body.displayName !== undefined) data.displayName = body.displayName;
        if (body.smtpHost !== undefined) data.smtpHost = body.smtpHost;
        if (body.smtpPort !== undefined) data.smtpPort = body.smtpPort;
        if (body.smtpSecure !== undefined) data.smtpSecure = body.smtpSecure;
        if (body.isDefault !== undefined) data.isDefault = body.isDefault;
        if (body.credential !== undefined) {
          data.credential = encodeCredential(body.credential);
        }

        const updated = await tx.emailAccount.update({
          where: { id },
          data,
          select: {
            id: true,
            email: true,
            displayName: true,
            provider: true,
            smtpHost: true,
            smtpPort: true,
            smtpSecure: true,
            isDefault: true,
            updatedAt: true,
          },
        });
        return { kind: "ok" as const, account: updated };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound") {
      return NextResponse.json(
        { code: 404, data: null, message: apiMsg(req, "mailAccountNotFound") },
        { status: 404 },
      );
    }

    return NextResponse.json({
      code: 0,
      data: result.account,
      message: apiMsg(req, "ok"),
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json(
        { code: 404, data: null, message: apiMsg(req, "mailAccountNotFound") },
        { status: 404 },
      );
    }
    console.error("[PATCH mail/accounts/:id] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/v1/mail/accounts/{id}?wid=xxx — 删除邮箱账户
 *
 * 仅允许账户所有者删除。关联的 Mail 记录因 onDelete: Cascade 自动级联删除。
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
  const limited = await checkRateLimit(req, "mail-accounts-delete", {
    windowMs: 60_000,
    max: 10,
  });
  if (limited) return limited;

  // 2) 查询参数校验
  const url = new URL(req.url);
  const parsed = deleteQuerySchema.safeParse({
    wid: url.searchParams.get("wid") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      {
        code: 400,
        message: parsed.error.issues[0]?.message ?? apiMsg(req, "invalidParams"),
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

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        const existing = await tx.emailAccount.findFirst({
          where: { id, workspaceId: wid, userId: ctx.payload.sub },
          select: { id: true },
        });
        if (!existing) return { kind: "notFound" as const };

        await tx.emailAccount.delete({ where: { id } });
        return { kind: "ok" as const };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound") {
      return NextResponse.json(
        { code: 404, data: null, message: apiMsg(req, "mailAccountNotFound") },
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
        { code: 404, data: null, message: apiMsg(req, "mailAccountNotFound") },
        { status: 404 },
      );
    }
    console.error("[DELETE mail/accounts/:id] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
