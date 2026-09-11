// F5：文档分享设置路由
// PATCH /api/v1/workspaces/{wid}/documents/{id}/share — 更新分享有效期/密码
// GET  /api/v1/workspaces/{wid}/documents/{id}/share — 查询当前分享设置
//
// 设计：
//  - 密码存 scrypt hash（复用 lib/crypto.ts 的 hash），明文绝不入库
//  - expiresAt 为 null 表示永不过期
//  - 需要 documents:update 权限
//  - GET 不返回密码 hash，仅返回 hasPassword 布尔值
import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { apiMsg } from "@/lib/api-messages";
import { requirePermission } from "@/lib/permissions";
import { hash as hashSharePassword } from "@/lib/crypto";

const updateShareSchema = z.object({
  /** 分享过期时间（ISO 字符串；null=永不过期；不传=保持原状） */
  expiresAt: z.union([z.string().datetime(), z.null()]).optional(),
  /** 分享密码明文（null=清除密码；不传=保持原状；存 scrypt hash） */
  password: z.union([z.string().min(1).max(128), z.null()]).optional(),
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
        } = {};
        if (validated.expiresAt !== undefined) {
          data.shareExpiresAt = validated.expiresAt
            ? new Date(validated.expiresAt)
            : null;
        }
        if (validated.password !== undefined) {
          data.sharePassword = validated.password
            ? await hashSharePassword(validated.password)
            : null;
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
    // 返回时脱敏：不暴露 sharePassword hash
    return NextResponse.json({
      code: 200,
      data: {
        shareToken: result.doc.shareToken,
        shareExpiresAt: result.doc.shareExpiresAt,
        hasPassword: result.doc.sharePassword !== null,
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
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
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
        shareExpiresAt: doc.shareExpiresAt,
        hasPassword: doc.sharePassword !== null,
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