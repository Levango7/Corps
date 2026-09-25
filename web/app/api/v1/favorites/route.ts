// GET  /api/v1/favorites?wid=xxx&type=task&limit=50 — 获取当前用户在工作区的收藏列表
// POST /api/v1/favorites — 添加收藏
//      Body: { wid, targetType, targetId, note? }
//
// 认证模式：getUserId → checkRateLimit → getWorkspaceContext → runWithWorkspace（RLS 事务）
// 安全：通过 workspaceId + userId 过滤确保用户只能访问自己的收藏
// 约定：{ code, data, message }；利用 @@unique([userId, targetType, targetId]) 防重复收藏。
//
// 经验来源：2026-09-15-ai-route-unified-pattern-audit-checklist
//  - checkRateLimit 认证后立即调用
//  - streamText/DB 操作用 try-catch 包裹，catch 返回 503 internalError

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";

/** 合法收藏目标类型枚举（与 schema 注释保持一致） */
const TARGET_TYPE_VALUES = [
  "task",
  "document",
  "message",
  "wiki",
  "whiteboard",
  "form",
  "meeting",
] as const;

/** GET 查询参数 schema */
const listQuerySchema = z.object({
  wid: z.string().uuid(),
  type: z.enum(TARGET_TYPE_VALUES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** POST 创建收藏 schema */
const createSchema = z.object({
  wid: z.string().uuid(),
  targetType: z.enum(TARGET_TYPE_VALUES),
  targetId: z.string().uuid(),
  note: z.string().max(200).optional(),
});

/**
 * GET /api/v1/favorites?wid=xxx[&type=task][&limit=50]
 *
 * 返回当前用户在指定工作区的收藏列表（按创建时间降序）。
 * type 参数可选过滤目标类型。
 */
export async function GET(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 1.5) 限流：60s 内最多 60 次
  const limited = await checkRateLimit(req, "favorites-list", {
    windowMs: 60_000,
    max: 60,
  });
  if (limited) return limited;

  // 2) 查询参数校验
  const url = new URL(req.url);
  const parsed = listQuerySchema.safeParse({
    wid: url.searchParams.get("wid") ?? undefined,
    type: url.searchParams.get("type") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      {
        code: 400,
        message: parsed.error.issues[0]?.message ?? apiMsg(req, "invalidParams"),
        data: null,
      },
      { status: 400 },
    );
  }
  const { wid, type, limit } = parsed.data;

  // 3) 工作区成员资格认证 + 查询
  try {
    const ctx = await getWorkspaceContext(req, wid);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }

    const favorites = await runWithWorkspace(
      wid,
      (tx) =>
        tx.favorite.findMany({
          where: {
            workspaceId: wid,
            userId: ctx.payload.sub,
            ...(type ? { targetType: type } : {}),
          },
          select: {
            id: true,
            targetType: true,
            targetId: true,
            note: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: limit,
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 0, data: favorites, message: apiMsg(req, "ok") });
  } catch (error) {
    console.error("[GET favorites] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * POST /api/v1/favorites — 添加收藏
 *
 * 在指定工作区为当前用户添加一条收藏。
 * 利用 @@unique([userId, targetType, targetId]) 防止重复收藏：
 *  - 使用 upsert：已存在则更新 note，不存在则创建。
 */
export async function POST(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 1.5) 限流：60s 内最多 30 次
  const limited = await checkRateLimit(req, "favorites-create", {
    windowMs: 60_000,
    max: 30,
  });
  if (limited) return limited;

  // 2) body 校验
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

  // 3) 工作区成员资格认证 + 创建
  try {
    const ctx = await getWorkspaceContext(req, body.wid);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }

    // upsert：利用 @@unique([userId, targetType, targetId]) 防重复
    // 已存在则更新 note（允许用户重新收藏时覆盖备注），不存在则创建
    const favorite = await runWithWorkspace(
      body.wid,
      (tx) =>
        tx.favorite.upsert({
          where: {
            userId_targetType_targetId: {
              userId: ctx.payload.sub,
              targetType: body.targetType,
              targetId: body.targetId,
            },
          },
          create: {
            workspaceId: body.wid,
            userId: ctx.payload.sub,
            targetType: body.targetType,
            targetId: body.targetId,
            note: body.note,
          },
          update: {
            note: body.note,
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json(
      { code: 0, data: favorite, message: apiMsg(req, "ok") },
      { status: 201 },
    );
  } catch (error) {
    // P2002 唯一约束冲突（理论上 upsert 已处理，此处兜底防御并发竞态）
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { code: 409, data: null, message: apiMsg(req, "favoriteAlreadyExists") },
        { status: 409 },
      );
    }
    console.error("[POST favorites] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
