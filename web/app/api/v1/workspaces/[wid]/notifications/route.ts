import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";

/**
 * 通知 API（Spec：协作平台通知中心）
 * - GET  列表 / 未读计数
 * - PATCH 标记已读（单条 / 全部）
 *
 * 认证：依赖 httpOnly access_token cookie，经 getWorkspaceContext 校验工作区成员身份。
 * 数据：通过 runWithWorkspace 注入 RLS 上下文，保证仅访问当前工作区通知。
 */

/** 通知列表分页参数校验：page 默认 1，limit 默认 50，最大 100 */
const listNotificationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** GET /v1/workspaces/{wid}/notifications */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized") }, { status: 401 });

  try {
    const url = new URL(req.url);
    const unreadOnly = url.searchParams.get("unread") === "true";
    const countOnly = url.searchParams.get("count") === "true";

    const userId = ctx.payload.sub;
    const baseWhere = { userId, workspaceId: wid } as const;
    const where = unreadOnly ? { ...baseWhere, read: false } : baseWhere;

    // count=true：仅返回未读计数
    if (countOnly) {
      const unread = await runWithWorkspace(wid, (tx) =>
        tx.notification.count({ where: { ...baseWhere, read: false } }),
      );
      return NextResponse.json({ code: 200, data: { unread } });
    }

    // 默认：返回通知列表（createdAt 降序，分页）
    const parsed = listNotificationsQuerySchema.safeParse({
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "validationFailed"), errors: parsed.error.errors },
        { status: 400 },
      );
    }
    const { page, limit } = parsed.data;
    const skip = (page - 1) * limit;

    const [notifications, total] = await runWithWorkspace(wid, (tx) =>
      Promise.all([
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
          skip,
          take: limit,
        }),
        tx.notification.count({ where }),
      ]),
    );

    return NextResponse.json({ code: 200, data: { notifications, total, page, limit } });
  } catch (error) {
    console.error("[GET notifications] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

const patchSchema = z.object({
  id: z.string().uuid().optional(),
  all: z.boolean().optional(),
});

/** PATCH /v1/workspaces/{wid}/notifications — 标记已读 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized") }, { status: 401 });

  try {
    const validated = patchSchema.parse(await req.json());
    // refine 检查移到 handler：refine 的 message 在模块级 schema 中无法访问
    // 请求语言（apiMsg 需要 req），故在 req 可用处校验并本地化
    if (validated.all !== true && !validated.id) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "notificationsNeedIdOrAll") },
        { status: 400 },
      );
    }
    const userId = ctx.payload.sub;

    const where =
      validated.all === true
        ? { userId, workspaceId: wid, read: false } // 标记当前用户在该工作区的所有未读通知
        : { id: validated.id!, userId, workspaceId: wid }; // 标记单条（仅当属于当前用户且属于当前工作区）

    await runWithWorkspace(wid, (tx) =>
      tx.notification.updateMany({
        where,
        data: { read: true },
      }),
    );

    return NextResponse.json({ code: 200, data: { success: true } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: error.issues[0]?.message ?? apiMsg(req, "invalidParams") },
        { status: 400 },
      );
    }
    console.error("Patch notification error:", error);
    return NextResponse.json({ code: 500, message: apiMsg(req, "internalError") }, { status: 500 });
  }
}
