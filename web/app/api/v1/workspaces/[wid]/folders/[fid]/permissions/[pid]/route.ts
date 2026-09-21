import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { apiMsg } from "@/lib/api-messages";

/**
 * 文件夹级权限单条操作（任务 441）
 *
 * 路由：/v1/workspaces/{wid}/folders/{fid}/permissions/{pid}
 *  - PATCH   更新权限级别或 inheritable 标记
 *  - DELETE  移除权限
 *
 * 鉴权：调用者需对该文件夹（或其父级空间）有 manage 权限，或工作区 owner/admin。
 */

/**
 * 判断当前用户是否可管理该文件夹：
 * 1. owner/admin 全权
 * 2. 文件夹级 manage 权限（targetType=folder）
 * 3. 父级空间 manage 权限（targetType=space，通过 inheritable 继承）
 */
async function canManageFolder(
  wid: string,
  fid: string,
  userId: string,
  role: string,
): Promise<boolean> {
  if (role === "owner" || role === "admin") return true;
  return runWithWorkspace(
    wid,
    async (tx) => {
      // 检查文件夹级 manage 权限
      const folderPerm = await tx.folderPermission.findFirst({
        where: {
          targetType: "folder",
          targetId: fid,
          granteeType: "user",
          granteeId: userId,
          permission: "manage",
        },
        select: { id: true },
      });
      if (folderPerm) return true;

      // 检查父级空间 manage 权限（通过 inheritable 继承到子文件夹）
      const folder = await tx.folder.findFirst({
        where: { id: fid, workspaceId: wid },
        select: { spaceId: true },
      });
      if (!folder) return false;

      const spacePerm = await tx.folderPermission.findFirst({
        where: {
          targetType: "space",
          targetId: folder.spaceId,
          granteeType: "user",
          granteeId: userId,
          permission: "manage",
          inheritable: true,
        },
        select: { id: true },
      });
      return !!spacePerm;
    },
    userId,
  );
}

const updatePermissionSchema = z.object({
  permission: z.enum(["view", "comment", "edit", "manage"]).optional(),
  inheritable: z.boolean().optional(),
}).refine(
  (data) => data.permission !== undefined || data.inheritable !== undefined,
  { message: "At least one of permission or inheritable must be provided" },
);

/**
 * PATCH /v1/workspaces/{wid}/folders/{fid}/permissions/{pid} — 更新权限级别或 inheritable
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; fid: string; pid: string }> },
) {
  const { wid, fid, pid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const body = await req.json();
    const validated = updatePermissionSchema.parse(body);

    const allowed = await canManageFolder(
      wid,
      fid,
      ctx.payload.sub,
      ctx.member.role,
    );
    if (!allowed) {
      return NextResponse.json(
        { code: 403, message: apiMsg(req, "noManagePermission"), data: null },
        { status: 403 },
      );
    }

    const updated = await runWithWorkspace(
      wid,
      async (tx) => {
        // 确认权限记录存在且属于该文件夹
        const existing = await tx.folderPermission.findFirst({
          where: {
            id: pid,
            targetType: "folder",
            targetId: fid,
            workspaceId: wid,
          },
          select: { id: true },
        });
        if (!existing) return { kind: "notFound" as const };

        // 仅更新提供的字段
        const data: Record<string, unknown> = {};
        if (validated.permission !== undefined) {
          data.permission = validated.permission;
        }
        if (validated.inheritable !== undefined) {
          data.inheritable = validated.inheritable;
        }

        const perm = await tx.folderPermission.update({
          where: { id: pid },
          data,
          include: {
            granter: { select: { id: true, name: true, email: true } },
          },
        });
        return { kind: "ok" as const, perm };
      },
      ctx.payload.sub,
    );

    if (updated.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "folderPermissionNotFound"), data: null },
        { status: 404 },
      );
    }
    return NextResponse.json({ code: 200, data: updated.perm });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          code: 400,
          message:
            error.issues[0]?.message ?? apiMsg(req, "validationFailed"),
          data: null,
          errors: error.errors,
        },
        { status: 400 },
      );
    }
    // P2025: 记录不存在（并发删除）
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "folderPermissionNotFound"), data: null },
        { status: 404 },
      );
    }
    console.error("[PATCH folder permission] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * DELETE /v1/workspaces/{wid}/folders/{fid}/permissions/{pid} — 移除权限
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; fid: string; pid: string }> },
) {
  const { wid, fid, pid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const allowed = await canManageFolder(
      wid,
      fid,
      ctx.payload.sub,
      ctx.member.role,
    );
    if (!allowed) {
      return NextResponse.json(
        { code: 403, message: apiMsg(req, "noManagePermission"), data: null },
        { status: 403 },
      );
    }

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        const existing = await tx.folderPermission.findFirst({
          where: {
            id: pid,
            targetType: "folder",
            targetId: fid,
            workspaceId: wid,
          },
          select: { id: true },
        });
        if (!existing) return { kind: "notFound" as const };

        await tx.folderPermission.delete({ where: { id: pid } });
        return { kind: "ok" as const };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "folderPermissionNotFound"), data: null },
        { status: 404 },
      );
    }
    return NextResponse.json({ code: 200, data: { id: pid, deleted: true } });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "folderPermissionNotFound"), data: null },
        { status: 404 },
      );
    }
    console.error("[DELETE folder permission] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}