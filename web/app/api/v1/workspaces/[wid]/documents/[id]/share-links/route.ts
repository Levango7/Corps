import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { apiMsg } from "@/lib/api-messages";
import { hash as hashPassword } from "@/lib/crypto";
import { randomBytes } from "crypto";

/**
 * 分享链接增强 API（任务 443）
 *
 * 路由：/v1/workspaces/{wid}/documents/{id}/share-links
 *  - GET    列出文档的所有 ShareLinkPermission 记录（分页）
 *  - POST   创建分享链接（生成 shareToken，配置权限/密码/过期/下载/打印/复制/最大访问次数）
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

/**
 * GET /v1/workspaces/{wid}/documents/{id}/share-links — 分享链接列表
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string }> },
) {
  const { wid, id: did } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const url = new URL(req.url);
    const paginationSchema = z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(50),
    });
    const { page, pageSize } = paginationSchema.parse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
    });
    const take = pageSize;
    const skip = (page - 1) * pageSize;

    // 验证文档存在且属于该工作区
    const docExists = await runWithWorkspace(
      wid,
      (tx) =>
        tx.document.findFirst({
          where: { id: did, workspaceId: wid },
          select: { id: true },
        }),
      ctx.payload.sub,
    );
    if (!docExists) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "documentNotFound"), data: null },
        { status: 404 },
      );
    }

    const [shareLinks, total] = await runWithWorkspace(
      wid,
      async (tx) =>
        Promise.all([
          tx.shareLinkPermission.findMany({
            where: { documentId: did, workspaceId: wid },
            orderBy: [{ createdAt: "desc" }],
            take,
            skip,
          }),
          tx.shareLinkPermission.count({
            where: { documentId: did, workspaceId: wid },
          }),
        ]),
      ctx.payload.sub,
    );

    // 剥离 passwordHash 字段
    const safeItems = shareLinks.map(stripSensitive);

    return NextResponse.json({
      code: 200,
      data: { items: safeItems, total, hasMore: skip + take < total },
    });
  } catch (error) {
    console.error("[GET share-links] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

const createShareLinkSchema = z.object({
  permission: z.enum(["view", "comment", "edit"]).default("view"),
  allowDownload: z.boolean().default(false),
  allowPrint: z.boolean().default(false),
  allowCopy: z.boolean().default(true),
  password: z.string().min(4).max(100).optional(),
  expiresAt: z.string().datetime().optional(),
  maxViews: z.number().int().min(1).optional(),
});

/**
 * POST /v1/workspaces/{wid}/documents/{id}/share-links — 创建分享链接
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string }> },
) {
  const { wid, id: did } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const body = await req.json();
    const validated = createShareLinkSchema.parse(body);

    // 鉴权：需 manage 权限 / 作者 / owner / admin
    const allowed = await canManageDoc(wid, did, ctx.payload.sub, ctx.member.role);
    if (!allowed) {
      return NextResponse.json(
        { code: 403, message: apiMsg(req, "noManagePermission"), data: null },
        { status: 403 },
      );
    }

    // 确认文档存在且属于该工作区
    const docExists = await runWithWorkspace(
      wid,
      (tx) =>
        tx.document.findFirst({
          where: { id: did, workspaceId: wid },
          select: { id: true },
        }),
      ctx.payload.sub,
    );
    if (!docExists) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "documentNotFound"), data: null },
        { status: 404 },
      );
    }

    // 生成 64 字符随机 shareToken
    const shareToken = randomBytes(32).toString("hex");

    // 如果提供了密码，使用 scrypt 生成 hash
    let passwordHash: string | undefined;
    if (validated.password) {
      passwordHash = await hashPassword(validated.password);
    }

    // 解析 expiresAt 字符串为 Date
    let expiresAt: Date | undefined;
    if (validated.expiresAt) {
      expiresAt = new Date(validated.expiresAt);
    }

    const shareLink = await runWithWorkspace(
      wid,
      (tx) =>
        tx.shareLinkPermission.create({
          data: {
            documentId: did,
            workspaceId: wid,
            shareToken,
            permission: validated.permission,
            allowDownload: validated.allowDownload,
            allowPrint: validated.allowPrint,
            allowCopy: validated.allowCopy,
            passwordHash,
            expiresAt,
            maxViews: validated.maxViews,
            createdBy: ctx.payload.sub,
          },
        }),
      ctx.payload.sub,
    );

    // 返回时剥离 passwordHash
    const safeData = stripSensitive(shareLink);

    return NextResponse.json({ code: 201, data: safeData }, { status: 201 });
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
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { code: 409, message: apiMsg(req, "prismaUniqueConstraint"), data: null },
        { status: 409 },
      );
    }
    console.error("[POST share-link] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
