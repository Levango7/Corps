// POST   /api/v1/workspaces/{wid}/members/{userId}/temporary-grants
//   创建临时授权（限时角色提升）。仅 owner/admin 可操作。
//   body: { tempRole: "admin"|"member", durationHours: 1-168, reason?: string }
//   自动记录 originalRole（当前成员角色）。
//
// GET    /api/v1/workspaces/{wid}/members/{userId}/temporary-grants
//   列出工作区所有临时授权（仅 owner/admin）。路径 userId 仅用于权限校验上下文，
//   实际返回该工作区全部临时授权（含 user 摘要信息）。
//
// DELETE /api/v1/workspaces/{wid}/members/{userId}/temporary-grants
//   撤销临时授权。优先按路径参数 userId 撤销；若 body 提供 userId 则以 body 为准。
//   仅 owner/admin 可操作。
//
// 治理规则：
//  - member/viewer 一律 403
//  - 不能对 owner 授予临时授权（owner 已全权）
//  - tempRole 不能等于目标用户当前角色（无意义）
//  - durationHours 范围 1-168（1 小时到 7 天）
//  - 同一 (userId, workspaceId) 唯一：重新授权覆盖现有记录

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";
import { handlePrismaError } from "@/lib/prisma-error";
import { requirePermission } from "@/lib/permissions";

/** 创建临时授权请求体 */
const createSchema = z.object({
  tempRole: z.enum(["admin", "member"]),
  durationHours: z.number().int().min(1).max(168),
  reason: z.string().max(500).optional(),
});

/** 删除临时授权请求体（可选；优先用路径 userId） */
const deleteSchema = z.object({
  userId: z.string().uuid().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; userId: string }> },
) {
  const { wid, userId } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }
  // 仅 owner/admin 可授予临时授权
  const denied = await requirePermission(ctx, "members", "update", req);
  if (denied) return denied;

  // 不能对自己授予临时授权（无意义，且可能锁死自己）
  if (userId === ctx.payload.sub) {
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "cannotGrantSelf"), data: null },
      { status: 400 },
    );
  }

  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await req.json());
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

  try {
    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        // 查目标成员当前角色
        const target = await tx.member.findUnique({
          where: { userId_workspaceId: { userId, workspaceId: wid } },
          select: { role: true },
        });
        if (!target) return { kind: "notFound" as const };
        // 不能对 owner 授予临时授权
        if (target.role === "owner") {
          return { kind: "ownerImmutable" as const };
        }
        // tempRole 不能等于当前角色（无意义）
        if (target.role === body.tempRole) {
          return { kind: "sameRole" as const };
        }

        const expiresAt = new Date(
          Date.now() + body.durationHours * 60 * 60 * 1000,
        );

        // upsert：同一 (userId, workspaceId) 唯一，重新授权覆盖现有记录
        const grant = await tx.temporaryGrant.upsert({
          where: { userId_workspaceId: { userId, workspaceId: wid } },
          create: {
            userId,
            workspaceId: wid,
            tempRole: body.tempRole,
            originalRole: target.role,
            expiresAt,
            reason: body.reason,
          },
          update: {
            tempRole: body.tempRole,
            originalRole: target.role,
            expiresAt,
            reason: body.reason,
          },
          select: {
            id: true,
            userId: true,
            workspaceId: true,
            tempRole: true,
            originalRole: true,
            expiresAt: true,
            reason: true,
            createdAt: true,
          },
        });

        return { kind: "ok" as const, grant };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "memberNotFound"), data: null },
        { status: 404 },
      );
    }
    if (result.kind === "ownerImmutable") {
      return NextResponse.json(
        {
          code: 403,
          message: apiMsg(req, "ownerRoleImmutable"),
          data: null,
        },
        { status: 403 },
      );
    }
    if (result.kind === "sameRole") {
      return NextResponse.json(
        {
          code: 400,
          message: apiMsg(req, "tempRoleSameAsCurrent"),
          data: null,
        },
        { status: 400 },
      );
    }

    return NextResponse.json({ code: 201, data: result.grant }, { status: 201 });
  } catch (error) {
    console.error("[POST temporary-grant] error:", error);
    return handlePrismaError(error, req);
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; userId: string }> },
) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }
  // 仅 owner/admin 可列出临时授权
  const denied = await requirePermission(ctx, "members", "read", req);
  if (denied) return denied;

  try {
    const grants = await runWithWorkspace(
      wid,
      (tx) =>
        tx.temporaryGrant.findMany({
          where: { workspaceId: wid },
          include: {
            user: {
              select: { id: true, email: true, name: true, image: true },
            },
          },
          orderBy: { expiresAt: "asc" },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 200, data: { items: grants, total: grants.length } });
  } catch (error) {
    console.error("[GET temporary-grants] error:", error);
    return handlePrismaError(error, req);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; userId: string }> },
) {
  const { wid, userId: pathUserId } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }
  // 仅 owner/admin 可撤销临时授权
  const denied = await requirePermission(ctx, "members", "update", req);
  if (denied) return denied;

  // 解析 body（可选）：若提供 body.userId 则优先使用
  let targetUserId = pathUserId;
  try {
    const raw = await req.json();
    const parsed = deleteSchema.safeParse(raw);
    if (parsed.success && parsed.data.userId) {
      targetUserId = parsed.data.userId;
    }
  } catch {
    // body 可能空（DELETE 常无 body），使用路径参数
  }

  try {
    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        const existing = await tx.temporaryGrant.findUnique({
          where: {
            userId_workspaceId: { userId: targetUserId, workspaceId: wid },
          },
          select: { id: true },
        });
        if (!existing) return { kind: "notFound" as const };

        await tx.temporaryGrant.delete({
          where: {
            userId_workspaceId: { userId: targetUserId, workspaceId: wid },
          },
        });
        return { kind: "ok" as const };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound") {
      // 幂等删除：记录不存在时返回 200（与 OpenAPI 定义一致）
      return NextResponse.json({ code: 200, data: null });
    }

    return NextResponse.json({ code: 200, data: null });
  } catch (error) {
    console.error("[DELETE temporary-grant] error:", error);
    return handlePrismaError(error, req);
  }
}