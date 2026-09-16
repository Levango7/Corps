// GET /api/v1/favorites/check?wid=xxx&type=task&targetId=xxx — 检查是否已收藏
//
// 认证模式：getUserId → checkRateLimit → getWorkspaceContext → runWithWorkspace（RLS 事务）
// 安全：通过 workspaceId + userId 过滤确保只能检查自己的收藏状态
// 约定：{ code, data, message }；返回 { favorited: boolean, favoriteId: string | null }

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getUserId,
  unauthorizedResponse,
} from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";

/** 合法收藏目标类型枚举 */
const TARGET_TYPE_VALUES = [
  "task",
  "document",
  "message",
  "wiki",
  "whiteboard",
  "form",
  "meeting",
] as const;

/** GET 查询参数 schema */
const checkQuerySchema = z.object({
  wid: z.string().uuid(),
  type: z.enum(TARGET_TYPE_VALUES),
  targetId: z.string().uuid(),
});

/** 检查结果 */
interface CheckResult {
  favorited: boolean;
  favoriteId: string | null;
}

/**
 * GET /api/v1/favorites/check?wid=xxx&type=task&targetId=xxx
 *
 * 检查当前用户是否已收藏指定目标。
 * 返回 { favorited: boolean, favoriteId: string | null }。
 */
export async function GET(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 1.5) 限流：60s 内最多 120 次（检查操作高频，配额放宽）
  const limited = await checkRateLimit(req, "favorites-check", {
    windowMs: 60_000,
    max: 120,
  });
  if (limited) return limited;

  // 2) 查询参数校验
  const url = new URL(req.url);
  const parsed = checkQuerySchema.safeParse({
    wid: url.searchParams.get("wid") ?? undefined,
    type: url.searchParams.get("type") ?? undefined,
    targetId: url.searchParams.get("targetId") ?? undefined,
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
  const { wid, type, targetId } = parsed.data;

  // 3) 工作区成员资格认证 + 查询
  try {
    const ctx = await getWorkspaceContext(req, wid);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }

    const favorite = await runWithWorkspace(
      wid,
      (tx) =>
        tx.favorite.findUnique({
          where: {
            userId_targetType_targetId: {
              userId: ctx.payload.sub,
              targetType: type,
              targetId,
            },
          },
          select: { id: true },
        }),
      ctx.payload.sub,
    );

    const result: CheckResult = {
      favorited: !!favorite,
      favoriteId: favorite?.id ?? null,
    };

    return NextResponse.json({ code: 0, data: result, message: apiMsg(req, "ok") });
  } catch (error) {
    console.error("[GET favorites/check] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}