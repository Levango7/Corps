import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { apiMsg } from "@/lib/api-messages";

/**
 * 空间级权限单条操作（任务 442）
 *
 * 路由：/v1/workspaces/{wid}/spaces/{spaceId}/permissions/{pid}
 *  - PATCH   更新权限级别或 inheritable 标记
 *  - DELETE  移除权限记录
 *
 * 鉴权：owner/admin 全权；其他角色需对该空间有 manage 权限。
 * targetType 固定为 "space"，权限记录必须属于该空间。
 */

/** 判断当前用户是否可管理该空间（manage 权限 / owner / admin） */
async function canManageSpace(
  wid: string,
  sid: string,
  userId: string,
  role: string,
): Promise<boolean> {
  if (role === "owner" || role === "admin") return true;
  return runWithWorkspace(
    wid,
    async (tx) => {
      const perm = await tx.folderPermission.findFirst({
        where: {
          targetType: "space",
          targetId: sid,
          workspaceId: wid,
          granteeType: "user",
          granteeId: userId,
          permission: "manage",
        },
        select: { id: true },
      });
      return !!perm;
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
 * PATCH /v1/workspaces/{wid}/spaces/{spaceId}/permissions/{pid} — 更新权限级别或 inheritable 标记
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; spaceId: string; pid: string }> },
) {
  const { wid, spaceId, pid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const body = await req.json();
    const validated = updatePermissionSchema.parse(body);

    const allowed = await canManageSpace(
      wid,
      spaceId,
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
        // 确认权限记录存在、属于该空间且 targetType=space
        const existing = await tx.folderPermission.findFirst({
          where: {
            id: pid,
            targetType: "space",
            targetId: spaceId,
            workspaceId: wid,
          },
          select: { id: true },
        });
        if (!existing) return { kind: "notFound" as const };

        // 只更新提供的字段
        const updateData: Record<string, unknown> = {};
        if (validated.permission !== undefined) {
          updateData.permission = validated.permission;
        }
        if (validated.inheritable !== undefined) {
          updateData.inheritable = validated.inheritable;
        }

        const perm = await tx.folderPermission.update({
          where: { id: pid },
          data: updateData,
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
    console.error("[PATCH space permission] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * DELETE /v1/workspaces/{wid}/spaces/{spaceId}/permissions/{pid} — 移除权限记录
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; spaceId: string; pid: string }> },
) {
  const { wid, spaceId, pid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const allowed = await canManageSpace(
      wid,
      spaceId,
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
        // 确认权限记录存在、属于该空间且 targetType=space
        const existing = await tx.folderPermission.findFirst({
          where: {
            id: pid,
            targetType: "space",
            targetId: spaceId,
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
    console.error("[DELETE space permission] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}