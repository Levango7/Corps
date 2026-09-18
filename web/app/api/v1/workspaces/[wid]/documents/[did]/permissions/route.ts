import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { apiMsg } from "@/lib/api-messages";

/**
 * 文档级权限 CRUD（阶段 6 · 任务 222）
 *
 * 路由：/v1/workspaces/{wid}/documents/{did}/permissions
 *  - GET    列出文档的所有 DocumentPermission 记录
 *  - POST   新增权限（granteeType/granteeId/permission）
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
  // owner/admin 全权
  if (role === "owner" || role === "admin") return true;
  return runWithWorkspace(
    wid,
    async (tx) => {
      // 文档作者可管理
      const doc = await tx.document.findFirst({
        where: { id: did, workspaceId: wid },
        select: { authorId: true },
      });
      if (!doc) return false;
      if (doc.authorId === userId) return true;
      // 显式 manage 权限
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

/**
 * GET /v1/workspaces/{wid}/documents/{did}/permissions — 权限列表
 * L3: GET 请求也验证工作区成员身份 + 文档存在性
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; did: string }> },
) {
  const { wid, did } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    // L3: 验证文档存在且属于该工作区（隐式校验工作区成员身份 via getWorkspaceContext）
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

    const permissions = await runWithWorkspace(
      wid,
      (tx) =>
        tx.documentPermission.findMany({
          where: { documentId: did, workspaceId: wid },
          include: {
            granter: { select: { id: true, name: true, email: true } },
          },
          orderBy: [{ createdAt: "asc" }],
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 200, data: { items: permissions } });
  } catch (error) {
    console.error("[GET document permissions] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

const createPermissionSchema = z.object({
  granteeType: z.enum(["user", "role"]),
  granteeId: z.string().min(1).max(255),
  // M2: 添加 transfer 权限操作（comment 已有）
  // transfer: 允许转移文档所有权；comment: 允许添加评论
  permission: z.enum(["view", "comment", "edit", "manage", "transfer"]),
});

/** 工作区中有效的角色名 */
const VALID_ROLES = new Set(["owner", "admin", "member", "viewer"]);

/**
 * POST /v1/workspaces/{wid}/documents/{did}/permissions — 添加权限
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; did: string }> },
) {
  const { wid, did } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const body = await req.json();
    const validated = createPermissionSchema.parse(body);

    // 鉴权：需 manage 权限 / 作者 / owner / admin
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

    // granteeId 校验：
    // - granteeType="user"：验证该用户是当前工作区成员
    // - granteeType="role"：验证是有效角色名
    if (validated.granteeType === "role") {
      if (!VALID_ROLES.has(validated.granteeId)) {
        return NextResponse.json(
          { code: 400, message: apiMsg(req, "invalidGrantee"), data: null },
          { status: 400 },
        );
      }
    } else {
      // granteeType="user"：验证该用户是当前工作区成员
      const memberExists = await runWithWorkspace(
        wid,
        (tx) =>
          tx.member.findFirst({
            where: { workspaceId: wid, userId: validated.granteeId },
            select: { userId: true },
          }),
        ctx.payload.sub,
      );
      if (!memberExists) {
        return NextResponse.json(
          { code: 400, message: apiMsg(req, "granteeNotInWorkspace"), data: null },
          { status: 400 },
        );
      }
    }

    const permission = await runWithWorkspace(
      wid,
      (tx) =>
        tx.documentPermission.create({
          data: {
            documentId: did,
            workspaceId: wid,
            granteeType: validated.granteeType,
            granteeId: validated.granteeId,
            permission: validated.permission,
            grantedBy: ctx.payload.sub,
          },
          include: {
            granter: { select: { id: true, name: true, email: true } },
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 201, data: permission }, { status: 201 });
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
    // P2002: 唯一约束冲突（同一 documentId+granteeType+granteeId 已存在）
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { code: 409, message: apiMsg(req, "prismaUniqueConstraint"), data: null },
        { status: 409 },
      );
    }
    console.error("[POST document permission] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}