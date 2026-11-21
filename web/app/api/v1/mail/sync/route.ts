// POST /api/v1/mail/sync — 触发当前用户全部邮箱账户的 IMAP 同步
//
// 认证模式：getUserId → checkRateLimit（同步是重操作，涉及外部 IMAP 网络 IO）
// ImapSync 内部逐账户走 runWithWorkspace 作用域短事务（mails 表启用 RLS，
// 全局 prisma 直查在加固模式下写不进——见 lib/mail/imap-sync.ts 注释）。
//
// 约定：{ code, data: { synced, created, failed, results }, message } 信封

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";
import { syncAllAccounts } from "@/lib/mail/imap-sync";
import { withRed } from "@/lib/red-metrics";

/** 单次同步的每账户拉取上限（手动同步不做全量拉取） */
const SYNC_MAX_MESSAGES = 50;

async function postMailSync(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 限流：60s 内最多 5 次（同步涉及外部 IMAP 网络 IO）
  const limited = await checkRateLimit(req, "mail-sync", { windowMs: 60_000, max: 5 });
  if (limited) return limited;

  try {
    const accounts = await prisma.emailAccount.findMany({
      where: { userId },
      orderBy: { isDefault: "desc" },
    });
    if (accounts.length === 0) {
      return NextResponse.json({
        code: 200,
        data: { synced: 0, created: 0, failed: 0, results: [] },
        message: apiMsg(req, "ok"),
      });
    }

    // ImapSync 内部逐账户走 runWithWorkspace 作用域短事务（mails 表启用 RLS）
    const results = await syncAllAccounts(prisma, accounts, {
      maxMessages: SYNC_MAX_MESSAGES,
    });
    const created = [...results.values()].reduce((sum, r) => sum + r.created, 0);
    const failed = [...results.values()].filter((r) => !r.success).length;

    return NextResponse.json({
      code: 200,
      data: {
        synced: accounts.length,
        created,
        failed,
        results: [...results.entries()].map(([accountId, r]) => ({ accountId, ...r })),
      },
      message: apiMsg(req, "ok"),
    });
  } catch (error) {
    console.error("[POST mail/sync] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

export const POST = withRed(postMailSync);
