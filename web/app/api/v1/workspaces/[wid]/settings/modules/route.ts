import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";

import { getWorkspaceContextV2, runWithWorkspace } from "@/lib/auth";
import { authFailure } from "@/lib/auth-response";
import { apiMsg } from "@/lib/api-messages";
import { requirePermission } from "@/lib/permissions";
import {
  invalidOptionalModuleIds,
  readSidebarSettings,
  withSidebarSettings,
} from "@/lib/workspace-settings";
import { withRed } from "@/lib/red-metrics";

/**
 * PATCH /api/v1/workspaces/:wid/settings/modules — 侧栏可选模块开关（P1-B2）。
 *
 * 语义：`enabledModules` 是**完整的启用集合**（不是增量）。空数组 = 全部收进「更多」。
 *
 * 权限：`settings:update`（与 GET/PATCH 权限矩阵同一口径）。注意矩阵里 admin 的
 * settings 是 `r`——也就是说工作区级配置归 owner；这与「权限矩阵只有 owner 能改」
 * 的既有口径一致，而 workspace 改名那条 PATCH 走的是 owner/admin，是历史差异，
 * 本路由不跟着放宽（宁可与矩阵一致，也不新增 ad-hoc 比较）。
 *
 * 校验：只接受可选模块 id。首屏模块、已删除模块、乱造的 id 一律 400 并回列非法项，
 * 不做"静默丢弃"——静默丢弃会让前端以为自己存成功了。
 */
const bodySchema = z.object({
  enabledModules: z.array(z.string()).max(64),
});

async function patchSettingsModules(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string }> },
) {
  const { wid } = await params;
  const ctx = await getWorkspaceContextV2(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  if (!ctx.ok) return authFailure(ctx, req);

  const denied = await requirePermission(ctx, "settings", "update", req);
  if (denied) return denied;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "validationError"), errors: error.issues, data: null },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "invalidBody"), data: null },
      { status: 400 },
    );
  }

  const invalid = invalidOptionalModuleIds(body.enabledModules);
  if (invalid.length > 0) {
    return NextResponse.json(
      {
        code: 400,
        message: apiMsg(req, "validationError"),
        data: { invalidModules: invalid },
      },
      { status: 400 },
    );
  }

  try {
    const enabled = await runWithWorkspace(
      wid,
      async (tx) => {
        const current = await tx.workspace.findUnique({
          where: { id: wid },
          select: { settings: true },
        });
        if (!current) return null;
        const next = withSidebarSettings(current.settings, body.enabledModules);
        await tx.workspace.update({
          where: { id: wid },
          data: { settings: next as Prisma.InputJsonValue },
        });
        return readSidebarSettings(next).enabledModules;
      },
      ctx.payload.sub,
    );

    if (enabled === null)
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "workspaceNotFound"), data: null },
        { status: 404 },
      );

    return NextResponse.json({ code: 200, data: { enabledModules: enabled } });
  } catch (error) {
    console.error("[PATCH settings/modules] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}

// RED 指标接线：Rate/Duration 通过 withRed 包装器自动记录
export const PATCH = withRed(patchSettingsModules);
