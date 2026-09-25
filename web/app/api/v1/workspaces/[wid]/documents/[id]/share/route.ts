// F5：文档分享设置路由
// POST   /api/v1/workspaces/{wid}/documents/{id}/share — 创建分享链接（生成 shareToken）
// GET    /api/v1/workspaces/{wid}/documents/{id}/share — 查询当前分享设置
// PATCH  /api/v1/workspaces/{wid}/documents/{id}/share — 更新分享有效期/密码
// DELETE /api/v1/workspaces/{wid}/documents/{id}/share — 撤销分享（清除 token + 过期 + 密码）
//
// 设计：
//  - 密码存 scrypt hash（复用 lib/crypto.ts 的 hash），明文绝不入库
//  - expiresAt 为 null 表示永不过期
//  - POST/DELETE/PATCH 需要 documents:update 权限；GET 需 documents:read
//  - GET 不返回密码 hash，仅返回 hasPassword 布尔值
//  - shareToken 由服务端生成（192 位熵），客户端不可指定
import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { randomBytes } from "crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { apiMsg } from "@/lib/api-messages";
import { requirePermission } from "@/lib/permissions";
import { hash as hashSharePassword } from "@/lib/crypto";
import { logger } from "@/lib/logger";

const updateShareSchema = z.object({
  /** 分享过期时间（ISO 字符串；null=永不过期；不传=保持原状） */
  expiresAt: z.union([z.string().datetime(), z.null()]).optional(),
  /** 分享密码明文（null=清除密码；不传=保持原状；存 scrypt hash） */
  password: z.union([z.string().min(1).max(128), z.null()]).optional(),
  /** 自定义分享路径（null=清除自定义路径回退到 token；不传=保持原状；3-50 字符，小写字母/数字/连字符） */
  shareSlug: z.union([z.string().regex(/^[a-z0-9-]{3,50}$/), z.null()]).optional(),
});

/** POST 创建分享链接入参 */
const createShareSchema = z.object({
  /** 可见性：public=公开（无需登录）；private=私密（需密码或工作区成员） */
  visibility: z.enum(["public", "private"]).default("public"),
  /** 有效期（小时）；不传或 0 = 永不过期 */
  expiresIn: z
    .number()
    .int()
    .min(0)
    .max(24 * 365)
    .optional(),
});

/** PATCH /v1/workspaces/{wid}/documents/{id}/share — 更新分享有效期/密码 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string }> },
) {
  const { wid, id } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  // documents:update 权限检查
  const denied = await requirePermission(ctx, "documents", "update", req);
  if (denied) return denied;

  try {
    const body = await req.json();
    const validated = updateShareSchema.parse(body);

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        const existing = await tx.document.findFirst({
          where: { id, workspaceId: wid },
          select: { id: true },
        });
        if (!existing) return { kind: "notFound" as const };

        const data: {
          shareExpiresAt?: Date | null;
          sharePassword?: string | null;
          shareSlug?: string | null;
        } = {};
        if (validated.expiresAt !== undefined) {
          data.shareExpiresAt = validated.expiresAt ? new Date(validated.expiresAt) : null;
        }
        if (validated.password !== undefined) {
          data.sharePassword = validated.password
            ? await hashSharePassword(validated.password)
            : null;
        }
        if (validated.shareSlug !== undefined) {
          // 唯一性检查：确保 documents 表内 shareSlug 不重复（排除当前文档自身）
          if (validated.shareSlug) {
            const conflict = await tx.document.findFirst({
              where: { shareSlug: validated.shareSlug, id: { not: id } },
              select: { id: true },
            });
            if (conflict) return { kind: "slugTaken" as const };
          }
          data.shareSlug = validated.shareSlug;
        }

        const doc = await tx.document.update({ where: { id }, data });
        return { kind: "ok" as const, doc };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "documentNotFound"), data: null },
        { status: 404 },
      );
    }
    if (result.kind === "slugTaken") {
      return NextResponse.json(
        { code: 409, message: apiMsg(req, "slugTaken"), data: null },
        { status: 409 },
      );
    }
    // 返回时脱敏：不暴露 sharePassword hash
    const doc = result.doc;
    return NextResponse.json({
      code: 200,
      data: {
        shareToken: doc.shareToken,
        shareSlug: doc.shareSlug,
        shareExpiresAt: doc.shareExpiresAt,
        hasPassword: doc.sharePassword !== null,
        shareUrl: doc.shareSlug
          ? `/s/${doc.shareSlug}`
          : doc.shareToken
            ? `/s/${doc.shareToken}`
            : null,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          code: 400,
          message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"),
          data: null,
        },
        { status: 400 },
      );
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "documentNotFound"), data: null },
        { status: 404 },
      );
    }
    console.error("[PATCH document share] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/** GET /v1/workspaces/{wid}/documents/{id}/share — 查询当前分享设置 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string }> },
) {
  const { wid, id } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const doc = await runWithWorkspace(
      wid,
      (tx) =>
        tx.document.findFirst({
          where: { id, workspaceId: wid },
          select: {
            id: true,
            shareToken: true,
            shareSlug: true,
            shareExpiresAt: true,
            sharePassword: true,
          },
        }),
      ctx.payload.sub,
    );

    if (!doc) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "documentNotFound"), data: null },
        { status: 404 },
      );
    }
    // 脱敏：不返回密码 hash，仅返回 hasPassword 布尔值
    return NextResponse.json({
      code: 200,
      data: {
        shareToken: doc.shareToken,
        shareSlug: doc.shareSlug,
        shareExpiresAt: doc.shareExpiresAt,
        hasPassword: doc.sharePassword !== null,
        shareUrl: doc.shareSlug
          ? `/s/${doc.shareSlug}`
          : doc.shareToken
            ? `/s/${doc.shareToken}`
            : null,
      },
    });
  } catch (error) {
    console.error("[GET document share] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
/** POST /v1/workspaces/{wid}/documents/{id}/share — 创建分享链接
 *  - 生成随机 shareToken（192 位熵，base64url）
 *  - visibility=private 时设置文档 visibility=shared（仍可配合密码保护）
 *  - expiresIn（小时）换算为 shareExpiresAt；不传或 0 = 永不过期
 *  - 返回 shareUrl / shareToken / expiresAt
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string }> },
) {
  const { wid, id } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  // documents:update 权限检查（创建分享链接属于修改文档属性）
  const denied = await requirePermission(ctx, "documents", "update", req);
  if (denied) return denied;

  try {
    const body = await req.json().catch(() => ({}));
    const parsed = createShareSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          code: 400,
          message: apiMsg(req, "validationFailed"),
          errors: parsed.error.errors,
          data: null,
        },
        { status: 400 },
      );
    }
    const { visibility, expiresIn } = parsed.data;

    const token = randomBytes(24).toString("base64url");
    const expiresAt =
      expiresIn && expiresIn > 0 ? new Date(Date.now() + expiresIn * 3600_000) : null;

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        const existing = await tx.document.findFirst({
          where: { id, workspaceId: wid },
          select: { id: true },
        });
        if (!existing) return { kind: "notFound" as const };

        const doc = await tx.document.update({
          where: { id },
          data: {
            shareToken: token,
            shareExpiresAt: expiresAt,
            // public → shared（公开可访问）；private → shared（仍可配密码）
            // visibility 字段语义：private=仅工作区可见；workspace=工作区可见；shared=分享开启
            visibility: "shared",
          },
        });
        return { kind: "ok" as const, doc };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "documentNotFound"), data: null },
        { status: 404 },
      );
    }

    const doc = result.doc;
    const shareUrl = `/s/${token}`;
    logger.info("document.share.create", {
      wid,
      id,
      visibility,
      expiresIn: expiresIn ?? 0,
    });

    return NextResponse.json(
      {
        code: 0,
        data: {
          shareUrl,
          shareToken: token,
          expiresAt: doc.shareExpiresAt,
          visibility: doc.visibility,
        },
        message: apiMsg(req, "ok"),
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          code: 400,
          message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"),
          data: null,
        },
        { status: 400 },
      );
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "documentNotFound"), data: null },
        { status: 404 },
      );
    }
    logger.error("document.share.create error", {
      wid,
      id,
      error: String(error),
    });
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/** DELETE /v1/workspaces/{wid}/documents/{id}/share — 撤销分享
 *  - 清除 shareToken / shareExpiresAt / sharePassword / shareSlug
 *  - 文档 visibility 回退为 private（仅工作区可见）
 *  - 旧分享链接立即失效
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string }> },
) {
  const { wid, id } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  // documents:update 权限检查
  const denied = await requirePermission(ctx, "documents", "update", req);
  if (denied) return denied;

  try {
    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        const existing = await tx.document.findFirst({
          where: { id, workspaceId: wid },
          select: { id: true, shareToken: true },
        });
        if (!existing) return { kind: "notFound" as const };
        // 已无 shareToken 视为幂等成功，仍返回 ok
        if (!existing.shareToken) return { kind: "ok" as const, revoked: false };

        await tx.document.update({
          where: { id },
          data: {
            shareToken: null,
            shareExpiresAt: null,
            sharePassword: null,
            shareSlug: null,
            visibility: "private",
          },
        });
        return { kind: "ok" as const, revoked: true };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "documentNotFound"), data: null },
        { status: 404 },
      );
    }

    logger.info("document.share.revoke", { wid, id, revoked: result.revoked });
    return NextResponse.json({
      code: 0,
      data: { revoked: result.revoked },
      message: apiMsg(req, "ok"),
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "documentNotFound"), data: null },
        { status: 404 },
      );
    }
    logger.error("document.share.revoke error", {
      wid,
      id,
      error: String(error),
    });
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
