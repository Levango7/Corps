import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { apiMsg } from "@/lib/api-messages";
import { handlePrismaError } from "@/lib/prisma-error";
import { importLayoutSchema, extractPref, buildPrefData } from "@/lib/dashboard-layout-helpers";
import { z } from "zod";

/**
 * F3 Widget 仪表盘 — 布局导入 API。
 *
 * POST /api/v1/workspaces/:wid/dashboard/layout/import
 *   body: { layout: RGLItem[], widgetConfigs?: Record<...>, name?: string }
 *   → 校验后 upsert 到 UserDashboardPref
 *   → 返回 { code: 200, data: { layout: RGLItem[], widgetConfigs: Record<...> } }
 *
 * 用于导入通过 GET /layout/export 导出的布局模板。
 * 校验失败返回 400 + Zod errors。
 *
 * 认证：getWorkspaceContext 校验成员身份 + 注入 RLS。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const body = await req.json();
    const validated = importLayoutSchema.parse(body);

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
    console.error("[POST dashboard/layout/import] error:", error);
    return handlePrismaError(error, req);
  }
}