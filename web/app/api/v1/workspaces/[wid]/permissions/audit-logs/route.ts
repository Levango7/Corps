import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { apiMsg } from "@/lib/api-messages";

/**
 * 权限审计日志查询 API（任务 444）
 *
 * 路由：/v1/workspaces/{wid}/permissions/audit-logs
 *  - GET  查询权限变更审计日志，支持筛选与分页
 *
 * 鉴权：
 *  - owner/admin 可查看所有审计日志
 *  - 其他角色只能查看自己相关的日志（granteeId = userId 或 operatorId = userId）
 *
 * 审计日志为只读 API，写入由权限变更操作自动触发。
 */

/** 查询参数 schema */
const querySchema = z.object({
  targetType: z.enum(["document", "folder", "space"]).optional(),
  granteeType: z.enum(["user", "role"]).optional(),
  operatorId: z.string().uuid().optional(),
  action: z.enum(["grant", "revoke", "update"]).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

/**
 * GET /v1/workspaces/{wid}/permissions/audit-logs — 查询权限审计日志
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  try {
    const url = new URL(req.url);
    const parsed = querySchema.safeParse({
      targetType: url.searchParams.get("targetType") ?? undefined,
      granteeType: url.searchParams.get("granteeType") ?? undefined,
      operatorId: url.searchParams.get("operatorId") ?? undefined,
      action: url.searchParams.get("action") ?? undefined,
      startDate: url.searchParams.get("startDate") ?? undefined,
      endDate: url.searchParams.get("endDate") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        {
          code: 400,
          message: parsed.error.issues[0]?.message ?? apiMsg(req, "validationFailed"),
          data: null,
          errors: parsed.error.errors,
        },
        { status: 400 },
      );
    }

    const { targetType, granteeType, operatorId, action, startDate, endDate, page, pageSize } =
      parsed.data;

    const take = pageSize;
    const skip = (page - 1) * pageSize;

    // 构建查询条件
    const where: Prisma.PermissionAuditLogWhereInput = { workspaceId: wid };

    if (targetType) where.targetType = targetType;
    if (granteeType) where.granteeType = granteeType;
    if (operatorId) where.operatorId = operatorId;
    if (action) where.action = action;

    // 时间范围筛选
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    // 鉴权：非 owner/admin 只能查看自己相关的日志
    const role = ctx.member.role;
    const userId = ctx.payload.sub;
    if (role !== "owner" && role !== "admin") {
      where.OR = [{ granteeId: userId }, { operatorId: userId }];
    }

    // 查询审计日志（PermissionAuditLog 无 operator 关联，需手动补充）
    const [logs, total] = await runWithWorkspace(
      wid,
      async (tx) =>
        Promise.all([
          tx.permissionAuditLog.findMany({
            where,
            orderBy: [{ createdAt: "desc" }],
            take,
            skip,
          }),
          tx.permissionAuditLog.count({ where }),
        ]),
      userId,
    );

    // 批量查询 operator 用户信息
    const operatorIds = [...new Set(logs.map((log) => log.operatorId))];
    const operators =
      operatorIds.length > 0
        ? await runWithWorkspace(
            wid,
            (tx) =>
              tx.user.findMany({
                where: { id: { in: operatorIds } },
                select: { id: true, name: true, email: true },
              }),
            userId,
          )
        : [];

    const operatorMap = new Map(operators.map((op) => [op.id, op]));

    // 合并 operator 信息到响应中
    const items = logs.map((log) => ({
      id: log.id,
      action: log.action,
      targetType: log.targetType,
      targetId: log.targetId,
      granteeType: log.granteeType,
      granteeId: log.granteeId,
      oldPermission: log.oldPermission,
      newPermission: log.newPermission,
      operatorId: log.operatorId,
      operator: operatorMap.get(log.operatorId) ?? {
        id: log.operatorId,
        name: null,
        email: null,
      },
      reason: log.reason,
      createdAt: log.createdAt,
    }));

    return NextResponse.json({
      code: 200,
      data: { items, total, hasMore: skip + take < total },
    });
  } catch (error) {
    console.error("[GET permission audit logs] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
