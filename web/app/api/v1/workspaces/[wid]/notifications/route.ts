import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";

/**
 * 通知 API（Spec：协作平台通知中心）
 * - GET  列表 / 未读计数
 * - PATCH 标记已读（单条 / 全部）
 *
 * 认证：依赖 httpOnly access_token cookie，经 getWorkspaceContext 校验工作区成员身份。
 * 数据：通过 runWithWorkspace 注入 RLS 上下文，保证仅访问当前工作区通知。
 */

const NOTIFICATION_LIMIT = 50;

/** GET /v1/workspaces/{wid}/notifications */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });

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

    // 默认：返回通知列表（createdAt 降序，limit 50）
    const notifications = await runWithWorkspace(wid, (tx) =>
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
        take: NOTIFICATION_LIMIT,
      }),
    );

    return NextResponse.json({ code: 200, data: { notifications } });
  } catch (error) {
    console.error("[GET notifications] error:", error);
    return NextResponse.json({ code: 500, data: null, message: "服务器内部错误" }, { status: 500 });
  }
}

const patchSchema = z
  .object({
    id: z.string().uuid().optional(),
    all: z.boolean().optional(),
  })
  .refine((v) => v.all === true || !!v.id, {
    message: "必须提供 id 或 all=true",
  });

/** PATCH /v1/workspaces/{wid}/notifications — 标记已读 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });

  try {
    const validated = patchSchema.parse(await req.json());
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
        { code: 400, message: error.issues[0]?.message ?? "参数校验失败" },
        { status: 400 },
      );
    }
    console.error("Patch notification error:", error);
    return NextResponse.json({ code: 500, message: "Internal server error" }, { status: 500 });
  }
}
