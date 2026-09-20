import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { apiMsg } from "@/lib/api-messages";

/**
 * 文档级权限单条操作（阶段 6 · 任务 222）
 *
 * 路由：/v1/workspaces/{wid}/documents/{id}/permissions/{pid}
 *  - PATCH   更新权限级别（view/edit/manage）
 *  - DELETE  移除权限
 *
 * 鉴权：调用者需对该文档有 manage 权限，或为文档作者，或工作区 owner/admin。
 */

/** 判断当前用户是否可管理该文档（manage 权限 / 作者 / owner / admin） */
async function canManageDoc(
  wid: string,
  did: string,
  userId: string,
  role: string,
): Promise<boolean> {
  if (role === "owner" || role === "admin") return true;
  return runWithWorkspace(
    wid,
    async (tx) => {
      const doc = await tx.document.findFirst({
        where: { id: did, workspaceId: wid },
        select: { authorId: true },
      });
      if (!doc) return false;
      if (doc.authorId === userId) return true;
      const perm = await tx.documentPermission.findFirst({
        where: {
          documentId: did,
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
  permission: z.enum(["view", "comment", "edit", "manage"]),
});

/**
 * PATCH /v1/workspaces/{wid}/documents/{did}/permissions/{pid} — 更新权限级别
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string; pid: string }> },
) {
  const { wid, id: did, pid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const body = await req.json();
    const validated = updatePermissionSchema.parse(body);

    const allowed = await canManageDoc(
      wid,
      did,
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
        // 确认权限记录存在且属于该文档
        const existing = await tx.documentPermission.findFirst({
          where: { id: pid, documentId: did, workspaceId: wid },
          select: { id: true },
        });
        if (!existing) return { kind: "notFound" as const };

        const perm = await tx.documentPermission.update({
          where: { id: pid },
          data: { permission: validated.permission },
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
        { code: 404, message: apiMsg(req, "docPermissionNotFound"), data: null },
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
        { code: 404, message: apiMsg(req, "docPermissionNotFound"), data: null },
        { status: 404 },
      );
    }
    console.error("[PATCH document permission] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * DELETE /v1/workspaces/{wid}/documents/{did}/permissions/{pid} — 移除权限
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string; pid: string }> },
) {
  const { wid, id: did, pid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const allowed = await canManageDoc(
      wid,
      did,
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
        const existing = await tx.documentPermission.findFirst({
          where: { id: pid, documentId: did, workspaceId: wid },
          select: { id: true },
        });
        if (!existing) return { kind: "notFound" as const };

        await tx.documentPermission.delete({ where: { id: pid } });
        return { kind: "ok" as const };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "docPermissionNotFound"), data: null },
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
        { code: 404, message: apiMsg(req, "docPermissionNotFound"), data: null },
        { status: 404 },
      );
    }
    console.error("[DELETE document permission] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}