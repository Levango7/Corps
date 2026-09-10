// GET  /api/v1/workspaces/{wid}/permissions — 返回所有角色的模块权限矩阵（默认 + 覆盖合并）
// PATCH /api/v1/workspaces/{wid}/permissions — 更新权限覆盖（仅 owner）
//
// F2（任务 156）：Viewer 角色 + 模块权限矩阵
//  - GET  需 settings:read（owner/admin 可调用）
//  - PATCH 需 settings:update（仅 owner）
//  - 仅可覆盖 member/viewer 角色；owner/admin 不可覆盖（400 拒绝）
import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";
import { handlePrismaError } from "@/lib/prisma-error";
import {
  requirePermission,
  getMergedPermissions,
  MODULES,
  ROLES,
  type Action,
} from "@/lib/permissions";

/** DB actions（完整动作名）→ 单字符代码 */
const ACTION_TO_CODE: Record<string, string> = {
  create: "c",
  read: "r",
  update: "u",
  delete: "d",
};

/**
 * 将 DB MemberPermission 行数组转为权限覆盖 Map。
 * key: `${role}:${module}`，value: 单字符动作代码串如 "cr"。
 */
function permsToMap(
  perms: { role: string; module: string; actions: string[] }[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of perms) {
    map.set(
      `${p.role}:${p.module}`,
      p.actions
        .map((a) => ACTION_TO_CODE[a] ?? "")
        .filter(Boolean)
        .join(""),
    );
  }
  return map;
}

// ─── GET：返回所有角色的合并权限矩阵 ───

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string }> },
) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  // 仅 owner/admin 可查看权限设置（settings:read）
  const denied = await requirePermission(ctx, "settings", "read", req);
  if (denied) return denied;

  try {
    // 查询该工作区所有权限覆盖（所有 role）
    const allPerms = await runWithWorkspace(
      wid,
      (tx) =>
        tx.memberPermission.findMany({
          where: { workspaceId: wid },
          select: { role: true, module: true, actions: true },
        }),
      ctx.payload.sub,
    );
    const overrides = permsToMap(allPerms);

    // 为每个角色构建合并后的权限矩阵
    const roles: Record<string, Record<string, Action[]>> = {};
    for (const role of ROLES) {
      roles[role] = getMergedPermissions(role, overrides);
    }

    return NextResponse.json({
      code: 200,
      data: {
        roles,
        modules: [...MODULES],
      },
    });
  } catch (error) {
    console.error("[GET permissions] error:", error);
    return handlePrismaError(error, req);
  }
}

// ─── PATCH：更新权限覆盖（仅 owner） ───

const patchSchema = z.object({
  role: z.enum(["member", "viewer"]),
  module: z.enum([
    "tasks",
    "decisions",
    "documents",
    "messages",
    "members",
    "billing",
    "analytics",
    "settings",
  ]),
  actions: z.array(z.enum(["read", "create", "update", "delete"])),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string }> },
) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  // 仅 owner 可修改权限设置（settings:update）
  const denied = await requirePermission(ctx, "settings", "update", req);
  if (denied) return denied;

  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        {
          code: 400,
          message: e.issues[0]?.message ?? apiMsg(req, "validationFailed"),
          data: null,
        },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "invalidBody"), data: null },
      { status: 400 },
    );
  }

  // schema 已限定 role 为 member/viewer，owner/admin 会被 zod 拒绝（400）
  // actions 已校验为合法动作名子集

  try {
    // upsert 权限覆盖（唯一键 workspaceId+role+module）
    await runWithWorkspace(
      wid,
      async (tx) => {
        await tx.memberPermission.upsert({
          where: {
            uq_member_perm: {
              workspaceId: wid,
              role: body.role,
              module: body.module,
            },
          },
          update: { actions: body.actions },
          create: {
            workspaceId: wid,
            role: body.role,
            module: body.module,
            actions: body.actions,
          },
        });
      },
      ctx.payload.sub,
    );

    // 返回更新后该角色的完整权限矩阵
    const rolePerms = await runWithWorkspace(
      wid,
      (tx) =>
        tx.memberPermission.findMany({
          where: { workspaceId: wid, role: body.role },
          select: { role: true, module: true, actions: true },
        }),
      ctx.payload.sub,
    );
    const overrides = permsToMap(rolePerms);
    const merged = getMergedPermissions(body.role, overrides);

    return NextResponse.json({
      code: 200,
      data: {
        role: body.role,
        permissions: merged,
      },
    });
  } catch (error) {
    console.error("[PATCH permissions] error:", error);
    return handlePrismaError(error, req);
  }
}