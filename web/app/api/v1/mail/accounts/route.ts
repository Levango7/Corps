// GET  /api/v1/mail/accounts?wid=xxx — 获取当前用户的邮箱账户列表
// POST /api/v1/mail/accounts — 添加邮箱账户
//      Body: { wid, email, smtpHost, smtpPort, credential, displayName?, smtpSecure?, provider? }
//
// 认证模式：getUserId → checkRateLimit → getWorkspaceContext → runWithWorkspace（RLS 事务）
// 安全：通过 workspaceId + userId 过滤确保用户只能访问自己的账户
// 约定：{ code, data, message }；利用 @@unique([userId, email]) 防重复账户。
//       credential（SMTP 密码）以 Base64 编码存储。
//
// 经验来源：2026-09-15-ai-route-unified-pattern-audit-checklist
//  - checkRateLimit 认证后立即调用
//  - DB 操作用 try-catch 包裹，catch 返回 500 internalError

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";
import { encodeCredential } from "@/lib/mail/transporter";

/** GET 查询参数 schema */
const listQuerySchema = z.object({
  wid: z.string().uuid(),
});

/** POST 创建邮箱账户 schema */
const createSchema = z.object({
  wid: z.string().uuid(),
  email: z.string().email().max(200),
  smtpHost: z.string().max(200),
  smtpPort: z.coerce.number().int().min(1).max(65535).default(587),
  smtpSecure: z.boolean().default(false),
  credential: z.string().min(1).max(2000), // 明文密码，存储前 Base64 编码
  displayName: z.string().max(100).optional(),
  provider: z.string().max(50).default("custom"),
  isDefault: z.boolean().default(false),
});

/**
 * GET /api/v1/mail/accounts?wid=xxx
 *
 * 返回当前用户在指定工作区的邮箱账户列表（按创建时间降序）。
 * 不返回 credential 字段（敏感信息）。
 */
export async function GET(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 1.5) 限流：60s 内最多 60 次
  const limited = await checkRateLimit(req, "mail-accounts-list", {
    windowMs: 60_000,
    max: 60,
  });
  if (limited) return limited;

  // 2) 查询参数校验
  const url = new URL(req.url);
  const parsed = listQuerySchema.safeParse({
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

  // 3) 工作区成员资格认证 + 查询
  try {
    const ctx = await getWorkspaceContext(req, wid);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }

    const accounts = await runWithWorkspace(
      wid,
      (tx) =>
        tx.emailAccount.findMany({
          where: {
            workspaceId: wid,
            userId: ctx.payload.sub,
          },
          select: {
            id: true,
            email: true,
            displayName: true,
            provider: true,
            smtpHost: true,
            smtpPort: true,
            smtpSecure: true,
            imapHost: true,
            imapPort: true,
            isDefault: true,
            createdAt: true,
            updatedAt: true,
            // 不返回 credential（敏感信息）
          },
          orderBy: { createdAt: "desc" },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 0, data: accounts, message: apiMsg(req, "ok") });
  } catch (error) {
    console.error("[GET mail/accounts] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * POST /api/v1/mail/accounts — 添加邮箱账户
 *
 * 在指定工作区为当前用户添加一条邮箱账户配置。
 * credential（明文密码）存储前经 Base64 编码。
 * 利用 @@unique([userId, email]) 防止重复添加同一邮箱。
 */
export async function POST(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 1.5) 限流：60s 内最多 10 次（添加账户是低频操作）
  const limited = await checkRateLimit(req, "mail-accounts-create", {
    windowMs: 60_000,
    max: 10,
  });
  if (limited) return limited;

  // 2) body 校验
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

  // 3) 工作区成员资格认证 + 创建
  try {
    const ctx = await getWorkspaceContext(req, body.wid);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }

    // Base64 编码密码后存储
    const encodedCredential = encodeCredential(body.credential);

    const account = await runWithWorkspace(
      body.wid,
      (tx) =>
        tx.emailAccount.create({
          data: {
            workspaceId: body.wid,
            userId: ctx.payload.sub,
            email: body.email,
            displayName: body.displayName,
            provider: body.provider,
            smtpHost: body.smtpHost,
            smtpPort: body.smtpPort,
            smtpSecure: body.smtpSecure,
            credential: encodedCredential,
            isDefault: body.isDefault,
          },
          select: {
            id: true,
            email: true,
            displayName: true,
            provider: true,
            smtpHost: true,
            smtpPort: true,
            smtpSecure: true,
            isDefault: true,
            createdAt: true,
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json(
      { code: 0, data: account, message: apiMsg(req, "ok") },
      { status: 201 },
    );
  } catch (error) {
    // P2002 唯一约束冲突（同一用户重复添加同一邮箱）
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { code: 409, data: null, message: apiMsg(req, "mailAccountAlreadyExists") },
        { status: 409 },
      );
    }
    console.error("[POST mail/accounts] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
