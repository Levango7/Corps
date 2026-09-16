// GET /api/v1/notifications/unread?workspaceId=xxx&limit=20 — 获取未读通知数量 + 列表
//
// 认证模式：getUserId → checkRateLimit → getWorkspaceContext → runWithWorkspace（RLS 事务）
// 安全：通过 workspaceId + userId 过滤确保用户只能访问自己的通知
// 约定：{ code, data, message }；按 createdAt 降序
//
// 经验来源：2026-09-15-ai-route-unified-pattern-audit-checklist
//  - checkRateLimit 认证后立即调用
//  - DB 操作用 try-catch 包裹，catch 返回 503 internalError

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";

/** GET 查询参数 schema */
const querySchema = z.object({
  workspaceId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** 未读通知响应 */
interface UnreadNotificationsResult {
  /** 未读总数 */
  total: number;
  /** 未读通知列表（按 createdAt 降序，最多 limit 条） */
  items: Array<{
    id: string;
    type: string;
    entityId: string;
    entityTitle: string;
    read: boolean;
    createdAt: string;
  }>;
}

/**
 * GET /api/v1/notifications/unread?workspaceId=xxx&limit=20
 *
 * 返回当前用户在指定工作区的未读通知数量 + 列表。
 */
export async function GET(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 1.5) 限流：60s 内最多 60 次
  const limited = await checkRateLimit(req, "notifications-unread", {
    windowMs: 60_000,
    max: 60,
  });
  if (limited) return limited;

  // 2) 查询参数校验
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    workspaceId: url.searchParams.get("workspaceId") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
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
  const { workspaceId, limit } = parsed.data;

  // 3) 工作区成员资格认证 + 查询
  try {
    const ctx = await getWorkspaceContext(req, workspaceId);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }

    // 并行查询未读总数 + 未读列表
    const [total, items] = await runWithWorkspace(
      workspaceId,
      async (tx) => {
        const where = {
          workspaceId,
          userId: ctx.payload.sub,
          read: false,
        };
        const [count, list] = await Promise.all([
          tx.notification.count({ where }),
          tx.notification.findMany({
            where,
            select: {
              id: true,
              type: true,
              entityId: true,
              entityTitle: true,
              read: true,
              createdAt: true,
            },
            orderBy: { createdAt: "desc" },
            take: limit,
          }),
        ]);
        return [count, list] as const;
      },
      ctx.payload.sub,
    );

    const data: UnreadNotificationsResult = {
      total,
      items: items.map((n) => ({
        ...n,
        createdAt: n.createdAt.toISOString(),
      })),
    };

    return NextResponse.json({ code: 0, data, message: "OK" });
  } catch (error) {
    console.error("[GET notifications/unread] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}