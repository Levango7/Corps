// GET /api/v1/mail/inbox?wid=xxx&status=sent&isRead=false&page=1&pageSize=20 — 收件箱/邮件列表
//
// 认证模式：getUserId → checkRateLimit → getWorkspaceContext → runWithWorkspace（RLS 事务）
// 安全：通过 workspaceId + accountId（归属当前用户）过滤确保用户只能访问自己的邮件
// 约定：{ code, data, message }；按 createdAt 降序分页。
//
// 经验来源：2026-09-15-ai-route-unified-pattern-audit-checklist

import { NextRequest, NextResponse } from "next/server";
import {
  getUserId,
  unauthorizedResponse,
} from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";
import { z } from "zod";

/** 邮件状态枚举 */
const STATUS_VALUES = ["draft", "sent", "received"] as const;

/** GET 查询参数 schema */
const listQuerySchema = z.object({
  wid: z.string().uuid(),
  accountId: z.string().uuid().optional(),
  status: z.enum(STATUS_VALUES).optional(),
  isRead: z.coerce.boolean().optional(),
  isStarred: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * GET /api/v1/mail/inbox?wid=xxx[&accountId=][&status=][&isRead=][&isStarred=][&page=1][&pageSize=20]
 *
 * 返回当前用户在指定工作区的邮件列表（按 createdAt 降序分页）。
 * 支持按 accountId / status / isRead / isStarred 过滤。
 */
export async function GET(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 1.5) 限流：60s 内最多 60 次
  const limited = await checkRateLimit(req, "mail-inbox-list", {
    windowMs: 60_000,
    max: 60,
  });
  if (limited) return limited;

  // 2) 查询参数校验
  const url = new URL(req.url);
  const parsed = listQuerySchema.safeParse({
    wid: url.searchParams.get("wid") ?? undefined,
    accountId: url.searchParams.get("accountId") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    isRead: url.searchParams.get("isRead") ?? undefined,
    isStarred: url.searchParams.get("isStarred") ?? undefined,
    page: url.searchParams.get("page") ?? undefined,
    pageSize: url.searchParams.get("pageSize") ?? undefined,
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
  const { wid, accountId, status, isRead, isStarred, page, pageSize } = parsed.data;

  // 3) 工作区成员资格认证 + 查询
  try {
    const ctx = await getWorkspaceContext(req, wid);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }

    // 先查出当前用户的所有账户 ID，用于过滤 Mail（确保只能看到自己账户下的邮件）
    const accountIds = await runWithWorkspace(
      wid,
      (tx) =>
        tx.emailAccount.findMany({
          where: { workspaceId: wid, userId: ctx.payload.sub },
          select: { id: true },
        }),
      ctx.payload.sub,
    );

    if (accountIds.length === 0) {
      return NextResponse.json({
        code: 0,
        data: { items: [], total: 0, page, pageSize },
        message: apiMsg(req, "ok"),
      });
    }

    const allowedAccountIds = accountIds.map((a) => a.id);
    // 若指定了 accountId，校验其归属当前用户
    if (accountId && !allowedAccountIds.includes(accountId)) {
      return NextResponse.json(
        { code: 404, data: null, message: apiMsg(req, "mailAccountNotFound") },
        { status: 404 },
      );
    }

    const where = {
      workspaceId: wid,
      accountId: accountId ?? { in: allowedAccountIds },
      ...(status ? { status } : {}),
      ...(isRead !== undefined ? { isRead } : {}),
      ...(isStarred !== undefined ? { isStarred } : {}),
    };

    const [items, total] = await runWithWorkspace(
      wid,
      (tx) =>
        Promise.all([
          tx.mail.findMany({
            where,
            select: {
              id: true,
              accountId: true,
              fromAddr: true,
              toAddr: true,
              ccAddr: true,
              subject: true,
              status: true,
              isRead: true,
              isStarred: true,
              sentAt: true,
              createdAt: true,
            },
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * pageSize,
            take: pageSize,
          }),
          tx.mail.count({ where }),
        ]),
      ctx.payload.sub,
    );

    return NextResponse.json({
      code: 0,
      data: { items, total, page, pageSize },
      message: apiMsg(req, "ok"),
    });
  } catch (error) {
    console.error("[GET mail/inbox] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}