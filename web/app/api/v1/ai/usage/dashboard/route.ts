// GET /api/v1/ai/usage/dashboard — AI 使用仪表盘数据（总览）
// 查询参数：workspaceId（必填）
// 返回：{
//   today: { calls, tokens, cost },
//   month: { calls, tokens, cost },
//   topCapabilities: [{ capability, calls, tokens, cost }],
//   recentLogs: AiUsageLog[],
//   limit: AiUsageLimit | null,
//   quota: { ok, reason?, usagePercent? } | null,   // 限额状态（超限时 AI 调用返回 429）
// }

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";
import { getWorkspaceContextV2, runWithWorkspace } from "@/lib/auth";
import { checkAiUsageLimit } from "@/lib/ai/usage-limit";
import { authFailure } from "@/lib/auth-response";

const querySchema = z.object({
  workspaceId: z.string().uuid(),
});

export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  const rateLimited = await checkRateLimit(req, "ai-usage-dashboard", {
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

  // 工作区归属校验（P0-5：防止越权访问其他工作区）
  const ctx = await getWorkspaceContextV2(req, parsed.workspaceId);
  if (!ctx)
    // V2 契约上从不返回 null（见 lib/auth.ts 的 WorkspaceContextV2 文档：
    // "调用方遇到 null 应按 500 处理（fail-closed，不可当作 401 重试）"）。
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  if (!ctx.ok) return authFailure(ctx, req);

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const wsWhere = { workspaceId: parsed.workspaceId } as const;
    const todayWhere = { ...wsWhere, createdAt: { gte: todayStart } } as const;
    const monthWhere = { ...wsWhere, createdAt: { gte: monthStart } } as const;

    // 并行查询：今日/本月聚合 + Top 能力 + 最近日志 + 限额配置（同一 GUC 事务）+
    // 限额达成状态（checkAiUsageLimit 内部自建 GUC 事务）。
    // 2026-10-08：全部改走 runWithWorkspace——ai_usage_logs / ai_usage_limits 是
    // FORCE RLS 表，裸查询在加固模式（生产默认）下静默读空，仪表盘恒显示零。
    const [todayAgg, monthAgg, topCapabilitiesRaw, recentLogs, limit] = await runWithWorkspace(
      parsed.workspaceId,
      (tx) =>
        Promise.all([
          tx.aiUsageLog.aggregate({
            where: todayWhere,
            _sum: { totalTokens: true, cost: true },
            _count: true,
          }),
          tx.aiUsageLog.aggregate({
            where: monthWhere,
            _sum: { totalTokens: true, cost: true },
            _count: true,
          }),
          tx.aiUsageLog.groupBy({
            by: ["capability"],
            where: monthWhere,
            _sum: { totalTokens: true, cost: true },
            _count: true,
            orderBy: { _count: { capability: "desc" } },
            take: 5,
          }),
          tx.aiUsageLog.findMany({
            where: wsWhere,
            orderBy: { createdAt: "desc" },
            take: 10,
          }),
          // 工作空间级默认限额（userId = null）
          tx.aiUsageLimit.findFirst({
            where: { workspaceId: parsed.workspaceId, userId: null },
          }),
        ]),
      userId,
    );
    // 限额状态（配额真拦截后本值用于用量页展示与排障：超限时 AI 调用返回 429）
    const quota = await checkAiUsageLimit(userId, parsed.workspaceId);

    const result = {
      today: {
        calls: todayAgg._count,
        tokens: todayAgg._sum.totalTokens ?? 0,
        cost: todayAgg._sum.cost ?? 0,
      },
      month: {
        calls: monthAgg._count,
        tokens: monthAgg._sum.totalTokens ?? 0,
        cost: monthAgg._sum.cost ?? 0,
      },
      topCapabilities: topCapabilitiesRaw.map((row) => ({
        capability: row.capability,
        calls: row._count,
        tokens: row._sum.totalTokens ?? 0,
        cost: row._sum.cost ?? 0,
      })),
      recentLogs,
      limit,
      quota,
    };

    return NextResponse.json({ code: 0, data: result, message: "OK" });
  } catch (error) {
    console.error("[ai-usage/dashboard] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
