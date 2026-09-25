import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";
import { checkRateLimit } from "@/lib/rate-limit";
import { computeProgress } from "@/lib/okr";

/**
 * 顶级 KeyResult 端点 · /v1/workspaces/{wid}/key-results/{kid}
 *
 * 用途：前端只持有 kid（如批量进度更新面板）时，免去拼装 oid 路径，
 * 直接按 kid 操作。归属校验：KR → Objective → workspaceId 必须等于 wid。
 *
 * 与嵌套端点 /objectives/{oid}/key-results/{krid} 的区别：
 *  - 嵌套端点在 URL 中显式携带 oid，可校验 oid 与 krid 的从属关系；
 *  - 本端点不携带 oid，从 KR 反查 objectiveId，再校验 objective.workspaceId。
 *  两者均经 runWithWorkspace 注入 RLS，双保险防跨租户访问。
 *
 * 认证模式：getWorkspaceContext → checkRateLimit → zod parse → runWithWorkspace（RLS 事务）
 */

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  /** 目标值（必须为有限数，拒绝 NaN/Infinity） */
  targetValue: z.number().finite().optional(),
  /** 进度当前值（前端进度更新主入口，必须为有限数，拒绝 NaN/Infinity） */
  currentValue: z.number().finite().optional(),
  unit: z.string().max(20).nullable().optional(),
  /** 权重：0-100 之间 */
  weight: z.number().min(0).max(100).optional(),
  ownerId: z.string().uuid().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
});

/**
 * PATCH /v1/workspaces/{wid}/key-results/{kid} — 更新关键结果并重算父目标进度
 *
 * 进度重算：currentValue/targetValue/weight 变更后，父 Objective.progress
 * 按 computeProgress 加权公式重算（与嵌套端点逻辑一致）。
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; kid: string }> },
) {
  const { wid, kid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  // 限流：每分钟 60 次更新（进度面板可能高频拖动滑块）
  const limited = await checkRateLimit(req, "okr-key-result-update", {
    windowMs: 60_000,
    max: 60,
  });
  if (limited) return limited;

  try {
    const body = await req.json();
    const validated = patchSchema.parse(body);

    // 归属校验 + 更新 + 重算父目标进度（同一事务内原子完成）
    // 合并原两次 runWithWorkspace 为单次事务，避免并发场景下校验通过后、
    // 更新前 KR 被另一请求删除导致 Prisma P2025 错误泄漏为 500 而非 404。
    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        // 1. 事务内校验 KR 存在且其 Objective 属于当前工作区
        const kr = await tx.keyResult.findUnique({
          where: { id: kid },
          select: { id: true, objectiveId: true, objective: { select: { workspaceId: true } } },
        });
        if (!kr || kr.objective.workspaceId !== wid) {
          return { notFound: true as const, data: null };
        }

        // 2. 同事务内更新 KR
        const updated = await tx.keyResult.update({
          where: { id: kid },
          data: {
            ...validated,
            dueDate:
              validated.dueDate === null
                ? null
                : validated.dueDate
                  ? new Date(validated.dueDate)
                  : undefined,
          },
        });

        // 3. 同事务内重算父目标进度
        const allKrs = await tx.keyResult.findMany({
          where: { objectiveId: kr.objectiveId },
          select: { currentValue: true, targetValue: true, weight: true },
        });
        await tx.objective.update({
          where: { id: kr.objectiveId },
          data: { progress: computeProgress(allKrs) },
        });

        return { notFound: false as const, data: updated };
      },
      ctx.payload.sub,
    );

    if (result.notFound) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "keyResultNotFound"), data: null },
        { status: 404 },
      );
    }

    return NextResponse.json({ code: 200, data: result.data, message: apiMsg(req, "ok") });
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
    console.error("[PATCH key-result top-level] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * DELETE /v1/workspaces/{wid}/key-results/{kid} — 删除关键结果并重算父目标进度
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; kid: string }> },
) {
  const { wid, kid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  const limited = await checkRateLimit(req, "okr-key-result-delete", {
    windowMs: 60_000,
    max: 30,
  });
  if (limited) return limited;

  try {
    // 归属校验 + 删除 + 重算父目标进度（同一事务内原子完成）
    // 合并原两次 runWithWorkspace 为单次事务，避免并发场景下校验通过后、
    // 删除前 KR 被另一请求删除导致 Prisma P2025 错误泄漏为 500 而非 404。
    const notFound = await runWithWorkspace(
      wid,
      async (tx) => {
        // 1. 事务内校验 KR 存在且其 Objective 属于当前工作区
        const kr = await tx.keyResult.findUnique({
          where: { id: kid },
          select: { id: true, objectiveId: true, objective: { select: { workspaceId: true } } },
        });
        if (!kr || kr.objective.workspaceId !== wid) return true;

        // 2. 同事务内删除 KR
        await tx.keyResult.delete({ where: { id: kid } });

        // 3. 同事务内重算父目标进度
        const allKrs = await tx.keyResult.findMany({
          where: { objectiveId: kr.objectiveId },
          select: { currentValue: true, targetValue: true, weight: true },
        });
        await tx.objective.update({
          where: { id: kr.objectiveId },
          data: { progress: computeProgress(allKrs) },
        });

        return false;
      },
      ctx.payload.sub,
    );

    if (notFound) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "keyResultNotFound"), data: null },
        { status: 404 },
      );
    }

    return NextResponse.json({ code: 200, data: null, message: apiMsg(req, "ok") });
  } catch (error) {
    console.error("[DELETE key-result top-level] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
