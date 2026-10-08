// GET  /api/v1/ai/usage/limits — 查询限额配置
//   查询参数：workspaceId（必填）、userId（可选，查特定用户限额）
//   返回：限额配置（用户级优先，回退工作空间级默认）
//
// PUT /api/v1/ai/usage/limits — 设置限额配置（需管理员权限）
//   请求体：{ workspaceId, userId?, dailyTokenLimit?, monthlyTokenLimit?,
//             dailyCallLimit?, monthlyCallLimit? }
//   使用 findFirst + update/create（workspaceId + userId 唯一约束）
//   权限：仅 workspace owner / admin 可设置
//
// 2026-10-08：全部查询改走 runWithWorkspace 注入 GUC——ai_usage_limits 是
// FORCE RLS 表，裸查询在加固模式（生产默认）下静默读空/写入被拒。
// P2002 竞态恢复放在独立小事务中：Postgres 事务在约束冲突后即中止，
// 同一交互式事务内无法继续查询并发记录。

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { Prisma } from "@prisma/client";

// ─── GET ──────────────────────────────────────────────────────────────────────

const querySchema = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().uuid().optional(),
});

export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  const rateLimited = await checkRateLimit(req, "ai-usage-limits-get", {
    windowMs: 60_000,
    max: 60,
  });
  if (rateLimited) return rateLimited;

  const url = new URL(req.url);
  const params = Object.fromEntries(url.searchParams.entries());
  let parsed: z.infer<typeof querySchema>;
  try {
    parsed = querySchema.parse(params);
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
      { code: 400, message: apiMsg(req, "invalidParams"), data: null },
      { status: 400 },
    );
  }

  // 工作区归属校验（P0-4：防止越权访问其他工作区）
  const ctx = await getWorkspaceContext(req, parsed.workspaceId);
  if (!ctx) {
    return NextResponse.json(
      { code: 403, message: apiMsg(req, "noPermission"), data: null },
      { status: 403 },
    );
  }

  // 查询其他用户限额时要求 admin/owner 角色（P0-4）
  if (
    parsed.userId &&
    parsed.userId !== userId &&
    ctx.member.role !== "owner" &&
    ctx.member.role !== "admin"
  ) {
    return NextResponse.json(
      { code: 403, message: apiMsg(req, "noPermission"), data: null },
      { status: 403 },
    );
  }

  try {
    const limit = await runWithWorkspace(
      parsed.workspaceId,
      async (tx) => {
        if (parsed.userId) {
          const userLimit = await tx.aiUsageLimit.findFirst({
            where: { workspaceId: parsed.workspaceId, userId: parsed.userId },
          });
          if (userLimit) return userLimit;
        }
        return tx.aiUsageLimit.findFirst({
          where: { workspaceId: parsed.workspaceId, userId: null },
        });
      },
      userId,
    );

    return NextResponse.json({ code: 0, data: limit, message: "OK" });
  } catch (error) {
    console.error("[ai-usage/limits GET] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

// ─── PUT ──────────────────────────────────────────────────────────────────────

const bodySchema = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().uuid().nullable().optional(),
  dailyTokenLimit: z.number().int().min(0).nullable().optional(),
  monthlyTokenLimit: z.number().int().min(0).nullable().optional(),
  dailyCallLimit: z.number().int().min(0).nullable().optional(),
  monthlyCallLimit: z.number().int().min(0).nullable().optional(),
});

export async function PUT(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  const rateLimited = await checkRateLimit(req, "ai-usage-limits-put", {
    windowMs: 60_000,
    max: 20,
  });
  if (rateLimited) return rateLimited;

  // 解析请求体
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
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
    // 管理员权限检查：仅 workspace owner / admin 可设置限额
    const ctx = await getWorkspaceContext(req, body.workspaceId);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }
    if (ctx.member.role !== "owner" && ctx.member.role !== "admin") {
      return NextResponse.json(
        { code: 403, message: apiMsg(req, "noPermission"), data: null },
        { status: 403 },
      );
    }

    // upsert 语义：workspaceId + userId 唯一约束
    // userId 为 null 表示工作空间级默认限额
    // 注意：Prisma 对含 nullable 字段的复合唯一键 upsert where 子句支持不一致，
    // 改用 findFirst + update/create 显式实现，避免运行时错误。
    const targetUserId = body.userId ?? null;

    // P1-4：当 body.userId 非空时，验证目标用户属于该 workspace
    if (body.userId) {
      // 收窄后的局部量：闭包内 TS 不会保留对 body.userId 的收窄
      const checkedUserId = body.userId;
      const targetMember = await runWithWorkspace(
        body.workspaceId,
        (tx) =>
          tx.member.findFirst({
            where: { workspaceId: body.workspaceId, userId: checkedUserId },
            select: { userId: true },
          }),
        userId,
      );
      if (!targetMember) {
        return NextResponse.json(
          { code: 400, message: apiMsg(req, "invalidBody"), data: null },
          { status: 400 },
        );
      }
    }

    const existing = await runWithWorkspace(
      body.workspaceId,
      (tx) =>
        tx.aiUsageLimit.findFirst({
          where: { workspaceId: body.workspaceId, userId: targetUserId },
        }),
      userId,
    );

    const limitData = {
      dailyTokenLimit: body.dailyTokenLimit,
      monthlyTokenLimit: body.monthlyTokenLimit,
      dailyCallLimit: body.dailyCallLimit,
      monthlyCallLimit: body.monthlyCallLimit,
    };

    let limit;
    if (existing) {
      limit = await runWithWorkspace(
        body.workspaceId,
        (tx) => tx.aiUsageLimit.update({ where: { id: existing.id }, data: limitData }),
        userId,
      );
    } else {
      // P1-3：捕获唯一约束冲突后重新 findFirst + update（各自独立小事务：
      // 约束冲突会中止当前 PG 事务，同一交互式事务内不能继续查询）
      try {
        limit = await runWithWorkspace(
          body.workspaceId,
          (tx) =>
            tx.aiUsageLimit.create({
              data: {
                workspaceId: body.workspaceId,
                userId: targetUserId,
                ...limitData,
              },
            }),
          userId,
        );
      } catch (createError) {
        if (
          createError instanceof Prisma.PrismaClientKnownRequestError &&
          createError.code === "P2002"
        ) {
          // 并发下另一请求已创建同一记录，重新查找并更新
          const raceExisting = await runWithWorkspace(
            body.workspaceId,
            (tx) =>
              tx.aiUsageLimit.findFirst({
                where: { workspaceId: body.workspaceId, userId: targetUserId },
              }),
            userId,
          );
          if (raceExisting) {
            limit = await runWithWorkspace(
              body.workspaceId,
              (tx) => tx.aiUsageLimit.update({ where: { id: raceExisting.id }, data: limitData }),
              userId,
            );
          } else {
            throw createError;
          }
        } else {
          throw createError;
        }
      }
    }

    return NextResponse.json({ code: 0, data: limit, message: "OK" });
  } catch (error) {
    console.error("[ai-usage/limits PUT] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
