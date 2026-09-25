import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";
import { hash as hashPassword } from "@/lib/crypto";

/**
 * 分享链接增强 API — 单条操作（任务 443）
 *
 * 路由：/v1/workspaces/{wid}/documents/{id}/share-links/{sid}
 *  - PATCH  更新分享链接配置（权限/密码/过期/下载/打印/复制/最大访问次数）
 *  - DELETE 撤销分享链接
 *
 * 鉴权：调用者需对该文档有 manage 权限，或为文档作者，或工作区 owner/admin。
 * 响应信封统一 { code, data, message }。
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
        select: { id: true, authorId: true },
      });
      if (doc?.authorId === userId) return true;

      const perm = await tx.documentPermission.findFirst({
        where: {
          documentId: did,
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

/** 从 ShareLinkPermission 记录中剥离敏感字段（passwordHash） */
function stripSensitive<T extends { passwordHash?: string | null }>(
  record: T,
): Omit<T, "passwordHash"> {
  const { passwordHash: _omit, ...rest } = record;
  return rest;
}

const updateShareLinkSchema = z.object({
  permission: z.enum(["view", "comment", "edit"]).optional(),
  allowDownload: z.boolean().optional(),
  allowPrint: z.boolean().optional(),
  allowCopy: z.boolean().optional(),
  password: z.string().min(4).max(100).optional(),
  expiresAt: z.string().datetime().optional(),
  maxViews: z.number().int().min(1).optional(),
});

/**
 * PATCH /v1/workspaces/{wid}/documents/{id}/share-links/{sid} — 更新分享链接配置
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string; sid: string }> },
) {
  const { wid, id: did, sid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const body = await req.json();
    const validated = updateShareLinkSchema.parse(body);

    // 鉴权：需 manage 权限 / 作者 / owner / admin
    const allowed = await canManageDoc(wid, did, ctx.payload.sub, ctx.member.role);
    if (!allowed) {
      return NextResponse.json(
        { code: 403, message: apiMsg(req, "noManagePermission"), data: null },
        { status: 403 },
      );
    }

    // 验证文档存在且分享链接属于该文档和工作区
    const existing = await runWithWorkspace(
      wid,
      (tx) =>
        tx.shareLinkPermission.findFirst({
          where: { id: sid, documentId: did, workspaceId: wid },
        }),
      ctx.payload.sub,
    );
    if (!existing) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "shareLinkNotFound"), data: null },
        { status: 404 },
      );
    }

    // 构建更新数据：只更新提供的字段
    const updateData: {
      permission?: string;
      allowDownload?: boolean;
      allowPrint?: boolean;
      allowCopy?: boolean;
      passwordHash?: string;
      expiresAt?: Date;
      maxViews?: number;
    } = {};

    if (validated.permission !== undefined) {
      updateData.permission = validated.permission;
    }
    if (validated.allowDownload !== undefined) {
      updateData.allowDownload = validated.allowDownload;
    }
    if (validated.allowPrint !== undefined) {
      updateData.allowPrint = validated.allowPrint;
    }
    if (validated.allowCopy !== undefined) {
      updateData.allowCopy = validated.allowCopy;
    }
    if (validated.password !== undefined) {
      updateData.passwordHash = await hashPassword(validated.password);
    }
    if (validated.expiresAt !== undefined) {
      updateData.expiresAt = new Date(validated.expiresAt);
    }
    if (validated.maxViews !== undefined) {
      updateData.maxViews = validated.maxViews;
    }

    const updated = await runWithWorkspace(
      wid,
      (tx) =>
        tx.shareLinkPermission.update({
          where: { id: sid },
          data: updateData,
        }),
      ctx.payload.sub,
    );

    // 返回时剥离 passwordHash
    const safeData = stripSensitive(updated);

    return NextResponse.json({ code: 200, data: safeData });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          code: 400,
          message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"),
          data: null,
          errors: error.errors,
        },
        { status: 400 },
      );
    }
    console.error("[PATCH share-link] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * DELETE /v1/workspaces/{wid}/documents/{id}/share-links/{sid} — 撤销分享链接
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string; sid: string }> },
) {
  const { wid, id: did, sid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    // 鉴权：需 manage 权限 / 作者 / owner / admin
    const allowed = await canManageDoc(wid, did, ctx.payload.sub, ctx.member.role);
    if (!allowed) {
      return NextResponse.json(
        { code: 403, message: apiMsg(req, "noManagePermission"), data: null },
        { status: 403 },
      );
    }

    // 验证分享链接存在且属于该文档和工作区
    const existing = await runWithWorkspace(
      wid,
      (tx) =>
        tx.shareLinkPermission.findFirst({
          where: { id: sid, documentId: did, workspaceId: wid },
          select: { id: true },
        }),
      ctx.payload.sub,
    );
    if (!existing) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "shareLinkNotFound"), data: null },
        { status: 404 },
      );
    }

    await runWithWorkspace(
      wid,
      (tx) =>
        tx.shareLinkPermission.delete({
          where: { id: sid },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({
      code: 200,
      data: null,
      message: apiMsg(req, "ok"),
    });
  } catch (error) {
    console.error("[DELETE share-link] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
