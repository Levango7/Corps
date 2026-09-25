import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { apiMsg } from "@/lib/api-messages";

/**
 * 文件夹级权限 CRUD（任务 441）
 *
 * 路由：/v1/workspaces/{wid}/folders/{fid}/permissions
 *  - GET    列出文件夹的所有 FolderPermission 记录（分页）
 *  - POST   新增权限（granteeType/granteeId/permission/inheritable）
 *
 * 鉴权：调用者需对该文件夹（或其父级空间）有 manage 权限，或工作区 owner/admin。
 * 响应信封统一 { code, data, message }。
 */

/** 工作区中有效的角色名 */
const VALID_ROLES = new Set(["owner", "admin", "member", "viewer"]);

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
  // owner/admin 全权
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

/**
 * GET /v1/workspaces/{wid}/folders/{fid}/permissions — 权限列表
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; fid: string }> },
) {
  const { wid, fid } = await params;
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

    // 验证文件夹存在且属于该工作区
    const folderExists = await runWithWorkspace(
      wid,
      (tx) =>
        tx.folder.findFirst({
          where: { id: fid, workspaceId: wid },
          select: { id: true },
        }),
      ctx.payload.sub,
    );
    if (!folderExists) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "folderNotFound"), data: null },
        { status: 404 },
      );
    }

    const [permissions, total] = await runWithWorkspace(
      wid,
      async (tx) =>
        Promise.all([
          tx.folderPermission.findMany({
            where: { targetType: "folder", targetId: fid, workspaceId: wid },
            include: {
              granter: { select: { id: true, name: true, email: true } },
            },
            orderBy: [{ createdAt: "asc" }],
            take,
            skip,
          }),
          tx.folderPermission.count({
            where: { targetType: "folder", targetId: fid, workspaceId: wid },
          }),
        ]),
      ctx.payload.sub,
    );

    return NextResponse.json({
      code: 200,
      data: { items: permissions, total, hasMore: skip + take < total },
    });
  } catch (error) {
    console.error("[GET folder permissions] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

const createPermissionSchema = z.object({
  granteeType: z.enum(["user", "role"]),
  granteeId: z.string().min(1).max(100),
  permission: z.enum(["view", "comment", "edit", "manage"]),
  inheritable: z.boolean().default(true),
});

/**
 * POST /v1/workspaces/{wid}/folders/{fid}/permissions — 添加权限
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; fid: string }> },
) {
  const { wid, fid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const body = await req.json();
    const validated = createPermissionSchema.parse(body);

    // 鉴权：需 manage 权限 / owner / admin
    const allowed = await canManageFolder(wid, fid, ctx.payload.sub, ctx.member.role);
    if (!allowed) {
      return NextResponse.json(
        { code: 403, message: apiMsg(req, "noManagePermission"), data: null },
        { status: 403 },
      );
    }

    // 确认文件夹存在且属于该工作区
    const folderExists = await runWithWorkspace(
      wid,
      (tx) =>
        tx.folder.findFirst({
          where: { id: fid, workspaceId: wid },
          select: { id: true },
        }),
      ctx.payload.sub,
    );
    if (!folderExists) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "folderNotFound"), data: null },
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
        tx.folderPermission.create({
          data: {
            workspaceId: wid,
            targetType: "folder",
            targetId: fid,
            granteeType: validated.granteeType,
            granteeId: validated.granteeId,
            permission: validated.permission,
            inheritable: validated.inheritable,
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
          message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"),
          data: null,
          errors: error.errors,
        },
        { status: 400 },
      );
    }
    // P2002: 唯一约束冲突（同一 targetType+targetId+granteeType+granteeId 已存在）
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { code: 409, message: apiMsg(req, "prismaUniqueConstraint"), data: null },
        { status: 409 },
      );
    }
    console.error("[POST folder permission] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
