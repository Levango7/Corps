import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContextV2, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";
import { checkRateLimit } from "@/lib/rate-limit";
import { authFailure } from "@/lib/auth-response";
import { withRed } from "@/lib/red-metrics";
import { requirePermission } from "@/lib/permissions";

/**
 * GET /v1/workspaces/{wid}/objectives/{oid} — 目标详情（含关键结果列表）
 */
async function getObjectivesByOid(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; oid: string }> },
) {
  const { wid, oid } = await params;
  const ctx = await getWorkspaceContextV2(req, wid);
  if (!ctx)
    // V2 契约上从不返回 null（见 lib/auth.ts 的 WorkspaceContextV2 文档：
    // "调用方遇到 null 应按 500 处理（fail-closed，不可当作 401 重试）"）。
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  if (!ctx.ok) return authFailure(ctx, req);

  const limited = await checkRateLimit(req, "okr-objective-detail", { windowMs: 60_000, max: 60 });
  if (limited) return limited;

  try {
    const obj = await runWithWorkspace(
      wid,
      (tx) =>
        tx.objective.findUnique({
          where: { id: oid },
          include: {
            keyResults: {
              orderBy: [{ createdAt: "asc" }],
              include: { owner: { select: { id: true, name: true, email: true } } },
            },
            owner: { select: { id: true, name: true, email: true } },
          },
        }),
      ctx.payload.sub,
    );

    if (!obj || obj.workspaceId !== wid) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "objectiveNotFound"), data: null },
        { status: 404 },
      );
    }

    return NextResponse.json({ code: 200, data: obj });
  } catch (error) {
    console.error("[GET objective] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().nullable().optional(),
  ownerId: z.string().uuid().nullable().optional(),
  period: z.string().min(1).max(20).optional(),
  status: z.enum(["draft", "active", "completed", "archived"]).optional(),
});

/** PATCH /v1/workspaces/{wid}/objectives/{oid} — 更新目标 */
async function patchObjectivesByOid(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; oid: string }> },
) {
  const { wid, oid } = await params;
  const ctx = await getWorkspaceContextV2(req, wid);
  if (!ctx)
    // V2 契约上从不返回 null（见 lib/auth.ts 的 WorkspaceContextV2 文档：
    // "调用方遇到 null 应按 500 处理（fail-closed，不可当作 401 重试）"）。
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  if (!ctx.ok) return authFailure(ctx, req);

  // 2026-10-30 T3 收敛批 A：objectives 纳入权限矩阵（viewer 只读；
  // member 可写与 write-policy choke point 现状等价）。
  const denied = await requirePermission(ctx, "objectives", "update", req);
  if (denied) return denied;
  const limited = await checkRateLimit(req, "okr-objective-update", { windowMs: 60_000, max: 30 });
  if (limited) return limited;

  try {
    const body = await req.json();
    const validated = patchSchema.parse(body);

    const existing = await runWithWorkspace(
      wid,
      (tx) =>
        tx.objective.findUnique({ where: { id: oid }, select: { id: true, workspaceId: true } }),
      ctx.payload.sub,
    );
    if (!existing || existing.workspaceId !== wid) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "objectiveNotFound"), data: null },
        { status: 404 },
      );
    }

    const updated = await runWithWorkspace(
      wid,
      (tx) =>
        tx.objective.update({
          where: { id: oid },
          data: validated,
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 200, data: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          code: 400,
          message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"),
          data: null,
          errors: error.issues,
        },
        { status: 400 },
      );
    }
    console.error("[PATCH objective] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/** DELETE /v1/workspaces/{wid}/objectives/{oid} — 删除目标（级联删除 KeyResult） */
async function deleteObjectivesByOid(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; oid: string }> },
) {
  const { wid, oid } = await params;
  const ctx = await getWorkspaceContextV2(req, wid);
  if (!ctx)
    // V2 契约上从不返回 null（见 lib/auth.ts 的 WorkspaceContextV2 文档：
    // "调用方遇到 null 应按 500 处理（fail-closed，不可当作 401 重试）"）。
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  if (!ctx.ok) return authFailure(ctx, req);

  // 2026-10-30 T3 收敛批 A：objectives 纳入权限矩阵（viewer 只读；
  // member 可写与 write-policy choke point 现状等价）。
  const denied = await requirePermission(ctx, "objectives", "delete", req);
  if (denied) return denied;
  const limited = await checkRateLimit(req, "okr-objective-delete", { windowMs: 60_000, max: 30 });
  if (limited) return limited;

  try {
    const existing = await runWithWorkspace(
      wid,
      (tx) =>
        tx.objective.findUnique({ where: { id: oid }, select: { id: true, workspaceId: true } }),
      ctx.payload.sub,
    );
    if (!existing || existing.workspaceId !== wid) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "objectiveNotFound"), data: null },
        { status: 404 },
      );
    }

    // KeyResult 通过 onDelete: Cascade 自动级联删除
    await runWithWorkspace(
      wid,
      (tx) => tx.objective.delete({ where: { id: oid } }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 200, data: null });
  } catch (error) {
    console.error("[DELETE objective] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

// RED 指标接线：Rate/Duration 通过 withRed 包装器自动记录
export const GET = withRed(getObjectivesByOid);
export const PATCH = withRed(patchObjectivesByOid);
export const DELETE = withRed(deleteObjectivesByOid);
