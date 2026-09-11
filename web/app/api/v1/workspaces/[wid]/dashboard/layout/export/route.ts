import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { apiMsg } from "@/lib/api-messages";
import { handlePrismaError } from "@/lib/prisma-error";
import { getDefaultLayout, type RGLItem } from "@/lib/default-layouts";
import { extractPref } from "@/lib/dashboard-layout-helpers";

/**
 * F3 Widget 仪表盘 — 布局导出 API。
 *
 * GET /api/v1/workspaces/:wid/dashboard/layout/export
 *   → 返回 { layout: RGLItem[], widgetConfigs: Record<...>, name: string, exportedAt: string }
 *
 * 用于将当前用户的仪表盘布局导出为可分享的 JSON 模板。
 * 导出的模板可通过 POST /layout/import 导入到其他工作区或用户。
 *
 * 认证：getWorkspaceContext 校验成员身份 + 注入 RLS。
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

    // 无记录 → 角色默认布局；有记录 → 提取复合格式
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
      data: {
        layout,
        widgetConfigs,
        name: `dashboard-${wid}-${new Date().toISOString().slice(0, 10)}`,
        exportedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("[GET dashboard/layout/export] error:", error);
    return handlePrismaError(error, req);
  }
}