import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { apiMsg } from "@/lib/api-messages";
import { handlePrismaError } from "@/lib/prisma-error";
import { getDefaultLayout, isRGLLayout, type RGLItem } from "@/lib/default-layouts";
import { z } from "zod";

/**
 * F3 Widget 仪表盘 — 布局偏好 API。
 *
 * GET  /api/v1/workspaces/:wid/dashboard/layout
 *   → 返回用户在该工作区的布局配置（无记录则返回角色默认布局）
 * PUT  /api/v1/workspaces/:wid/dashboard/layout
 *   → upsert 布局（userId + workspaceId 唯一）
 *
 * 认证：getWorkspaceContext 校验成员身份 + 注入 RLS。
 * 数据：UserDashboardPref 表（F3），layout 字段为 react-grid-layout JSON。
 */

/** PUT body 校验：layout 为 RGLItem 数组 */
const layoutItemSchema = z.object({
  i: z.string().min(1),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
  minW: z.number().int().min(1).optional(),
  minH: z.number().int().min(1).optional(),
});

const putLayoutSchema = z.object({
  layout: z.array(layoutItemSchema).min(1),
});

/**
 * GET /api/v1/workspaces/:wid/dashboard/layout
 * 响应：{ code: 200, data: { layout: RGLItem[] } }
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const userId = ctx.payload.sub;
    const pref = await runWithWorkspace(
      wid,
      (tx) =>
        tx.userDashboardPref.findUnique({
          where: { userId_workspaceId: { userId, workspaceId: wid } },
          select: { layout: true },
        }),
      userId,
    );

    // 无记录 → 角色默认布局；有记录 → 校验 JSON 形态后返回（防历史脏数据）
    const layout: RGLItem[] = pref && isRGLLayout(pref.layout)
      ? (pref.layout as RGLItem[])
      : getDefaultLayout(ctx.member.role);

    return NextResponse.json({ code: 200, data: { layout } });
  } catch (error) {
    console.error("[GET dashboard/layout] error:", error);
    return handlePrismaError(error, req);
  }
}

/**
 * PUT /api/v1/workspaces/:wid/dashboard/layout
 * body: { layout: [{ i: "task-stats", x: 0, y: 0, w: 1, h: 1 }, ...] }
 * 响应：{ code: 200, data: { layout: RGLItem[] } }
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const body = await req.json();
    const validated = putLayoutSchema.parse(body);

    const userId = ctx.payload.sub;
    const saved = await runWithWorkspace(
      wid,
      (tx) =>
        tx.userDashboardPref.upsert({
          where: { userId_workspaceId: { userId, workspaceId: wid } },
          create: {
            userId,
            workspaceId: wid,
            layout: validated.layout,
          },
          update: {
            layout: validated.layout,
          },
          select: { layout: true },
        }),
      userId,
    );

    return NextResponse.json({
      code: 200,
      data: { layout: saved.layout as unknown as RGLItem[] },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          code: 400,
          message: apiMsg(req, "validationError"),
          errors: error.errors,
          data: null,
        },
        { status: 400 },
      );
    }
    console.error("[PUT dashboard/layout] error:", error);
    return handlePrismaError(error, req);
  }
}