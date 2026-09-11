// F5：任务分享设置路由
// PATCH /api/v1/workspaces/{wid}/tasks/{id}/share — 更新分享有效期/密码
// GET  /api/v1/workspaces/{wid}/tasks/{id}/share — 查询当前分享设置
//
// 与 documents share 类似，但针对 Task 模型。
// 密码存 scrypt hash（复用 lib/crypto.ts），需要 tasks:update 权限。
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
  /** 自定义分享路径（null=清除自定义路径回退到 token；不传=保持原状；3-50 字符，小写字母/数字/连字符） */
  shareSlug: z.union([z.string().regex(/^[a-z0-9-]{3,50}$/), z.null()]).optional(),
});

/** PATCH /v1/workspaces/{wid}/tasks/{id}/share — 更新分享有效期/密码 */
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

  // tasks:update 权限检查
  const denied = await requirePermission(ctx, "tasks", "update", req);
  if (denied) return denied;

  try {
    const body = await req.json();
    const validated = updateShareSchema.parse(body);

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        const existing = await tx.task.findFirst({
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
          data.shareExpiresAt = validated.expiresAt
            ? new Date(validated.expiresAt)
            : null;
        }
        if (validated.password !== undefined) {
          data.sharePassword = validated.password
            ? await hashSharePassword(validated.password)
            : null;
        }
        if (validated.shareSlug !== undefined) {
          // 唯一性检查：确保 tasks 表内 shareSlug 不重复（排除当前任务自身）
          if (validated.shareSlug) {
            const conflict = await tx.task.findFirst({
              where: { shareSlug: validated.shareSlug, id: { not: id } },
              select: { id: true },
            });
            if (conflict) return { kind: "slugTaken" as const };
          }
          data.shareSlug = validated.shareSlug;
        }

        const task = await tx.task.update({ where: { id }, data });
        return { kind: "ok" as const, task };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "taskNotFound"), data: null },
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
    const task = result.task;
    return NextResponse.json({
      code: 200,
      data: {
        shareToken: task.shareToken,
        shareSlug: task.shareSlug,
        shareExpiresAt: task.shareExpiresAt,
        hasPassword: task.sharePassword !== null,
        shareUrl: task.shareSlug ? `/s/${task.shareSlug}` : task.shareToken ? `/s/${task.shareToken}` : null,
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
        { code: 404, message: apiMsg(req, "taskNotFound"), data: null },
        { status: 404 },
      );
    }
    console.error("[PATCH task share] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/** GET /v1/workspaces/{wid}/tasks/{id}/share — 查询当前分享设置 */
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
    const task = await runWithWorkspace(
      wid,
      (tx) =>
        tx.task.findFirst({
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

    if (!task) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "taskNotFound"), data: null },
        { status: 404 },
      );
    }
    // 脱敏：不返回密码 hash，仅返回 hasPassword 布尔值
    return NextResponse.json({
      code: 200,
      data: {
        shareToken: task.shareToken,
        shareSlug: task.shareSlug,
        shareExpiresAt: task.shareExpiresAt,
        hasPassword: task.sharePassword !== null,
        shareUrl: task.shareSlug ? `/s/${task.shareSlug}` : task.shareToken ? `/s/${task.shareToken}` : null,
      },
    });
  } catch (error) {
    console.error("[GET task share] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}