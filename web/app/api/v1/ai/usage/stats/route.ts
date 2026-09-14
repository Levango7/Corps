// GET /api/v1/ai/usage/stats — AI 使用统计（按时间范围/能力维度聚合）
// 查询参数：workspaceId（必填）、capability（可选）、startDate（可选）、endDate（可选）
// 返回：{ totalCalls, totalTokens, totalCost, avgDurationMs, byCapability: [{ capability, calls, tokens, cost }] }

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";
import { prisma } from "@/lib/prisma";
import { getWorkspaceContext } from "@/lib/auth";

const querySchema = z.object({
  workspaceId: z.string().uuid(),
  capability: z.string().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  const rateLimited = await checkRateLimit(req, "ai-usage-stats", {
    windowMs: 60_000,
    max: 60,
  });
  if (rateLimited) return rateLimited;

  // 解析查询参数
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

  // 工作区归属校验（P0-2：防止越权访问其他工作区）
  const ctx = await getWorkspaceContext(req, parsed.workspaceId);
  if (!ctx) {
    return NextResponse.json(
      { code: 403, message: apiMsg(req, "noPermission"), data: null },
      { status: 403 },
    );
  }

  try {
    // 构建查询 where 条件
    const where: {
      workspaceId: string;
      capability?: string;
      createdAt?: { gte?: Date; lte?: Date };
    } = { workspaceId: parsed.workspaceId };
    if (parsed.capability) where.capability = parsed.capability;
    if (parsed.startDate || parsed.endDate) {
      where.createdAt = {};
      if (parsed.startDate) where.createdAt.gte = new Date(parsed.startDate);
      if (parsed.endDate) where.createdAt.lte = new Date(parsed.endDate);
    }

    // 并行查询：聚合统计 + 按能力分组
    const [aggregate, byCapabilityRaw] = await Promise.all([
      prisma.aiUsageLog.aggregate({
        where,
        _sum: { totalTokens: true, cost: true },
        _avg: { durationMs: true },
        _count: true,
      }),
      prisma.aiUsageLog.groupBy({
        by: ["capability"],
        where,
        _sum: { totalTokens: true, cost: true },
        _count: true,
        orderBy: { _count: { capability: "desc" } },
      }),
    ]);

    const byCapability = byCapabilityRaw.map((row) => ({
      capability: row.capability,
      calls: row._count,
      tokens: row._sum.totalTokens ?? 0,
      cost: row._sum.cost ?? 0,
    }));

    const result = {
      totalCalls: aggregate._count,
      totalTokens: aggregate._sum.totalTokens ?? 0,
      totalCost: aggregate._sum.cost ?? 0,
      avgDurationMs: aggregate._avg.durationMs ?? 0,
      byCapability,
    };

    return NextResponse.json({ code: 0, data: result, message: "OK" });
  } catch (error) {
    console.error("[ai-usage/stats] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}