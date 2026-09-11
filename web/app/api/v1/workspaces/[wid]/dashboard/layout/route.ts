import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { apiMsg } from "@/lib/api-messages";
import { handlePrismaError } from "@/lib/prisma-error";
import { getDefaultLayout, type RGLItem } from "@/lib/default-layouts";
import { putLayoutSchema, extractPref, buildPrefData } from "@/lib/dashboard-layout-helpers";
import { z } from "zod";

/**
 * F3 Widget 仪表盘 — 布局偏好 API。
 *
 * GET  /api/v1/workspaces/:wid/dashboard/layout
 *   → 返回用户在该工作区的布局配置（无记录则返回角色默认布局）
 * PUT  /api/v1/workspaces/:wid/dashboard/layout
 *   → upsert 布局（userId + workspaceId 唯一）
 *
 * 导出/导入端点位于子路由：
 * GET  /api/v1/workspaces/:wid/dashboard/layout/export
 * POST /api/v1/workspaces/:wid/dashboard/layout/import
 *
 * 认证：getWorkspaceContext 校验成员身份 + 注入 RLS。
 * 数据：UserDashboardPref 表（F3），layout 字段为复合格式
 *      { items: RGLItem[], widgetConfigs: Record<string, Record<string, unknown>> }。
 *      向后兼容旧数组格式（读取时自动迁移）。
 */

/**
 * GET /api/v1/workspaces/:wid/dashboard/layout
 * 响应：{ code: 200, data: { layout: RGLItem[], widgetConfigs: Record<...>, breakpoint: "lg" } }
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
    let layout: RGLItem[];
    let widgetConfigs: Record<string, Record<string, unknown>>;
    if (pref) {
      const extracted = extractPref(pref.layout);
      layout = extracted.layout.length > 0 ? extracted.layout : getDefaultLayout(ctx.member.role);
      widgetConfigs = extracted.widgetConfigs;
    } else {
      layout = getDefaultLayout(ctx.member.role);
      widgetConfigs = {};
    }

    return NextResponse.json({
      code: 200,
      data: { layout, widgetConfigs, breakpoint: "lg" },
    });
  } catch (error) {
    console.error("[GET dashboard/layout] error:", error);
    return handlePrismaError(error, req);
  }
}

/**
 * PUT /api/v1/workspaces/:wid/dashboard/layout
 * body: { layout: [{ i: "task-stats", x: 0, y: 0, w: 1, h: 1 }, ...], widgetConfigs?: {...} }
 * 响应：{ code: 200, data: { layout: RGLItem[], widgetConfigs: Record<...> } }
 *
 * 持久化采用复合格式 { items, widgetConfigs }，向后兼容旧读取逻辑。
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
    // 复合持久化结构：{ items, widgetConfigs }
    // cast 为 Prisma.InputJsonValue：接口缺少索引签名，运行时为合法 JSON 对象
    const prefData = buildPrefData(validated.layout, validated.widgetConfigs) as unknown as Prisma.InputJsonValue;
    const saved = await runWithWorkspace(
      wid,
      (tx) =>
        tx.userDashboardPref.upsert({
          where: { userId_workspaceId: { userId, workspaceId: wid } },
          create: {
            userId,
            workspaceId: wid,
            layout: prefData,
          },
          update: {
            layout: prefData,
          },
          select: { layout: true },
        }),
      userId,
    );

    const extracted = extractPref(saved.layout);
    return NextResponse.json({
      code: 200,
      data: {
        layout: extracted.layout,
        widgetConfigs: extracted.widgetConfigs,
        breakpoint: validated.breakpoint ?? "lg",
      },
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
