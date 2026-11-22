// POST /api/v1/mail/sync?wid=xxx — 手动触发当前用户在该工作区邮箱账户的 IMAP 同步
//
// 认证模式：getUserId → checkRateLimit → getWorkspaceContextV2（进墙）→ runWithWorkspace（RLS 事务）
// ImapSync 内部走 runWithWorkspace 作用域短事务（mails 表启用 RLS，
// 全局 prisma 直查在加固模式下写不进——见 lib/mail/imap-sync.ts 注释）。
//
// 约定：{ code, data: { synced, created, failed, results }, message } 信封

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { getWorkspaceContextV2, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";
import { authFailure } from "@/lib/auth-response";
import { syncAllAccounts } from "@/lib/mail/imap-sync";
import { withRed } from "@/lib/red-metrics";

/** 查询参数：工作区 ID（同步范围=该工作区内属于当前用户的全部账户） */
const syncQuerySchema = z.object({
  wid: z.string().uuid(),
});

/** 单次同步的每账户拉取上限（手动同步不做全量拉取） */
const SYNC_MAX_MESSAGES = 50;

async function postMailSync(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 限流：60s 内最多 5 次（同步涉及外部 IMAP 网络 IO）
  const limited = await checkRateLimit(req, "mail-sync", { windowMs: 60_000, max: 5 });
  if (limited) return limited;

  const url = new URL(req.url);
  const parsed = syncQuerySchema.safeParse({
    wid: url.searchParams.get("wid") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "invalidParams"), data: null },
      { status: 400 },
    );
  }
  const { wid } = parsed.data;

  try {
    const ctx = await getWorkspaceContextV2(req, wid);
    if (!ctx)
      // V2 契约上从不返回 null（见 lib/auth.ts 的 WorkspaceContextV2 文档：
      // "调用方遇到 null 应按 500 处理（fail-closed，不可当作 401 重试）"）。
      return NextResponse.json(
        { code: 500, message: apiMsg(req, "internalError"), data: null },
        { status: 500 },
      );
    if (!ctx.ok) return authFailure(ctx, req);

    // 账户查询走 RLS 作用域事务（email_accounts 受行级安全，裸查读不到行）
    const accounts = await runWithWorkspace(
      wid,
      (tx) =>
        tx.emailAccount.findMany({
          where: { workspaceId: wid, userId: ctx.payload.sub },
          orderBy: { isDefault: "desc" },
        }),
      ctx.payload.sub,
    );
    if (accounts.length === 0) {
      return NextResponse.json({
        code: 200,
        data: { synced: 0, created: 0, failed: 0, results: [] },
        message: apiMsg(req, "ok"),
      });
    }

    // ImapSync 内部逐账户走 runWithWorkspace 作用域短事务（mails 表启用 RLS）
    const results = await syncAllAccounts(accounts, {
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
