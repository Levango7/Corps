// POST /api/v1/mail/send — 发送邮件
//      Body: { wid, accountId, to, cc?, bcc?, subject, bodyText, bodyHtml?, inReplyTo? }
//
// 认证模式：getUserId → checkRateLimit → getWorkspaceContext → runWithWorkspace（RLS 事务）
// 安全：通过 workspaceId + userId 过滤确保账户归属当前用户
// 流程：
//   1. 校验账户归属
//   2. 创建 nodemailer transporter
//   3. 调用 transporter.sendMail()
//   4. 写入 Mail 记录（status: "sent"）
//   5. 错误处理：SMTP 连接失败 → 503
//
// 约定：{ code, data, message }
// 经验来源：2026-09-15-ai-route-unified-pattern-audit-checklist

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";
import { sendMail } from "@/lib/mail/transporter";

/** POST 发送邮件 schema */
const sendSchema = z.object({
  wid: z.string().uuid(),
  accountId: z.string().uuid(),
  to: z.string().min(1).max(5000), // 逗号分隔的收件人
  cc: z.string().max(5000).optional(),
  bcc: z.string().max(5000).optional(),
  subject: z.string().min(1).max(500),
  bodyText: z.string().max(200_000).optional(),
  bodyHtml: z.string().max(500_000).optional(),
  inReplyTo: z.string().max(500).optional(),
});

/**
 * POST /api/v1/mail/send — 发送邮件
 *
 * 1. 校验账户归属当前用户
 * 2. 通过 nodemailer 发送 SMTP 邮件
 * 3. 写入 Mail 记录（status: "sent"，sentAt: now）
 * 4. SMTP 连接/发送失败 → 503 mailSmtpError
 */
export async function POST(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 1.5) 限流：60s 内最多 20 次
  const limited = await checkRateLimit(req, "mail-send", {
    windowMs: 60_000,
    max: 20,
  });
  if (limited) return limited;

  // 2) body 校验
  let body: z.infer<typeof sendSchema>;
  try {
    body = sendSchema.parse(await req.json());
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

  // 3) 工作区成员资格认证
  let ctx: Awaited<ReturnType<typeof getWorkspaceContext>>;
  try {
    ctx = await getWorkspaceContext(req, body.wid);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }
  } catch (error) {
    console.error("[POST mail/send] getWorkspaceContext error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }

  // 4) 查询账户（含 credential，用于创建 transporter）
  let account: Prisma.EmailAccountGetPayload<Record<string, unknown>> | null;
  try {
    account = await runWithWorkspace(
      body.wid,
      (tx) =>
        tx.emailAccount.findFirst({
          where: {
            id: body.accountId,
            workspaceId: body.wid,
            userId: ctx!.payload.sub,
          },
        }),
      ctx.payload.sub,
    );
  } catch (error) {
    console.error("[POST mail/send] findAccount error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }

  if (!account) {
    return NextResponse.json(
      { code: 404, data: null, message: apiMsg(req, "mailAccountNotFound") },
      { status: 404 },
    );
  }

  // 5) 通过 nodemailer 发送邮件
  const fromAddr = account.displayName
    ? `${account.displayName} <${account.email}>`
    : account.email;

  try {
    const info = await sendMail(account, {
      from: fromAddr,
      to: body.to,
      cc: body.cc || undefined,
      bcc: body.bcc || undefined,
      subject: body.subject,
      text: body.bodyText || undefined,
      html: body.bodyHtml || undefined,
      inReplyTo: body.inReplyTo || undefined,
    });

    // 6) 写入 Mail 记录（status: "sent"）
    const mail = await runWithWorkspace(
      body.wid,
      (tx) =>
        tx.mail.create({
          data: {
            workspaceId: body.wid,
            accountId: account!.id,
            messageId: info.messageId ?? null,
            fromAddr,
            toAddr: body.to,
            ccAddr: body.cc ?? null,
            bccAddr: body.bcc ?? null,
            subject: body.subject,
            bodyText: body.bodyText ?? null,
            bodyHtml: body.bodyHtml ?? null,
            status: "sent",
            inReplyTo: body.inReplyTo ?? null,
            attachments: [] as Prisma.InputJsonValue,
            sentAt: new Date(),
          },
          select: {
            id: true,
            messageId: true,
            status: true,
            sentAt: true,
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({
      code: 0,
      data: mail,
      message: apiMsg(req, "ok"),
    });
  } catch (error) {
    // SMTP 连接/发送失败 → 503
    console.error("[POST mail/send] SMTP error:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { code: 503, data: null, message: apiMsg(req, "mailSmtpError") },
      { status: 503 },
    );
  }
}
