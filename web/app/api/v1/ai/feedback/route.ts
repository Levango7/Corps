// POST /api/v1/ai/feedback — 提交 AI 结果反馈
// GET  /api/v1/ai/feedback — 查询反馈列表（分页）
//
// 方向 D：AI 结果反馈循环。用户对 AI 输出点赞/点踩并可选提供修正建议，
// 反馈数据用于优化后续 prompt（few-shot 示例）与统计满意度。

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";
import { submitFeedback, getFeedbackStats } from "@/lib/ai/feedback";
import { prisma } from "@/lib/prisma";
import { getWorkspaceContext } from "@/lib/auth";
import { Prisma } from "@prisma/client";

// ─── POST 校验 schema ──────────────────────────────────────────────────────
const postSchema = z.object({
  workspaceId: z.string().uuid(),
  capability: z.string().min(1).max(50),
  rating: z.enum(["positive", "negative"]),
  comment: z.string().max(5000).optional(),
  originalOutput: z.unknown().optional(),
  correctedOutput: z.unknown().optional(),
  metadata: z.unknown().optional(),
});

// ─── GET 校验 schema ───────────────────────────────────────────────────────
const getSchema = z.object({
  workspaceId: z.string().uuid(),
  capability: z.string().min(1).max(50).optional(),
  rating: z.enum(["positive", "negative"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * POST /api/v1/ai/feedback — 提交反馈
 *
 * 请求体：{ workspaceId, capability, rating, comment?, originalOutput?, correctedOutput?, metadata? }
 * 限流：60 秒内 30 次
 */
export async function POST(req: NextRequest) {
  // 1) 认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) 限流：60s 内最多 30 次
  const limited = await checkRateLimit(req, "ai-feedback", { windowMs: 60_000, max: 30 });
  if (limited) return limited;

  // 3) body 校验
  let body: z.infer<typeof postSchema>;
  try {
    body = postSchema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: e.issues[0]?.message ?? apiMsg(req, "validationFailed"), data: null },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "invalidBody"), data: null },
      { status: 400 },
    );
  }

  // 4) 工作区归属校验（P0-1：防止越权访问其他工作区）
  const ctx = await getWorkspaceContext(req, body.workspaceId);
  if (!ctx) {
    return NextResponse.json(
      { code: 403, message: apiMsg(req, "noPermission"), data: null },
      { status: 403 },
    );
  }

  // 5) 持久化反馈
  try {
    const feedback = await submitFeedback({
      workspaceId: body.workspaceId,
      userId,
      capability: body.capability,
      rating: body.rating,
      comment: body.comment,
      originalOutput: body.originalOutput as Prisma.InputJsonValue,
      correctedOutput: body.correctedOutput as Prisma.InputJsonValue,
      metadata: body.metadata as Prisma.InputJsonValue,
    });

    return NextResponse.json({ code: 0, data: feedback, message: "OK" });
  } catch (error) {
    console.error("[ai/feedback] POST error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}

/**
 * GET /api/v1/ai/feedback — 查询反馈列表（分页）
 *
 * 查询参数：workspaceId(必填), capability?, rating?, limit?(默认20,最大100), offset?(默认0)
 * 限流：60 秒内 60 次
 *
 * 返回：{ items, total, stats } — items 为反馈列表，total 为筛选条件下的总数，
 *       stats 为该工作区(+capability)的满意度统计
 */
export async function GET(req: NextRequest) {
  // 1) 认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) 限流：60s 内最多 60 次
  const limited = await checkRateLimit(req, "ai-feedback-query", { windowMs: 60_000, max: 60 });
  if (limited) return limited;

  // 3) 查询参数校验
  const url = new URL(req.url);
  let params: z.infer<typeof getSchema>;
  try {
    params = getSchema.parse({
      workspaceId: url.searchParams.get("workspaceId") ?? undefined,
      capability: url.searchParams.get("capability") ?? undefined,
      rating: url.searchParams.get("rating") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      offset: url.searchParams.get("offset") ?? undefined,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: e.issues[0]?.message ?? apiMsg(req, "validationFailed"), data: null },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "invalidParams"), data: null },
      { status: 400 },
    );
  }

  // 4) 工作区归属校验（P0-1：防止越权访问其他工作区）
  const ctx = await getWorkspaceContext(req, params.workspaceId);
  if (!ctx) {
    return NextResponse.json(
      { code: 403, message: apiMsg(req, "noPermission"), data: null },
      { status: 403 },
    );
  }

  // 5) 查询反馈列表 + 统计
  try {
    // 普通用户只能看自己的反馈；owner/admin 可看全部
    const isManager =
      ctx.member.role === "owner" || ctx.member.role === "admin";

    const where = {
      workspaceId: params.workspaceId,
      ...(!isManager ? { userId } : {}),
      ...(params.capability ? { capability: params.capability } : {}),
      ...(params.rating ? { rating: params.rating } : {}),
    };

    const [items, total, stats] = await Promise.all([
      prisma.aiFeedback.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: params.limit,
        skip: params.offset,
        select: {
          id: true,
          capability: true,
          rating: true,
          comment: true,
          originalOutput: true,
          correctedOutput: true,
          metadata: true,
          createdAt: true,
        },
      }),
      prisma.aiFeedback.count({ where }),
      // 统计始终按工作区(+capability)维度，不受 rating 筛选影响
      getFeedbackStats(params.workspaceId, params.capability),
    ]);

    return NextResponse.json({
      code: 0,
      data: { items, total, stats },
      message: "OK",
    });
  } catch (error) {
    console.error("[ai/feedback] GET error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}