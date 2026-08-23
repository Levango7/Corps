import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";

/**
 * GET /api/v1/workspaces/:wid/analytics/overview — 工作区分析概览。
 *
 * P2 数据埋点：注册/激活/留存/转化漏斗。
 *
 * 返回：
 *  - funnel：注册→激活→留存→转化各步骤计数与转化率
 *  - daily：最近 14 天每日事件计数（用于趋势线）
 *  - topEvents：Top 8 事件名 + 计数（用于了解用户行为分布）
 *
 * 权限：owner/admin 可见（成员返回 403）。
 * RLS：走 runWithWorkspace，工作区隔离。
 */

/** 漏斗步骤定义：顺序即漏斗顺序。 */
const FUNNEL_STEPS = [
  { name: "register_success", label: "注册" },
  { name: "login_success", label: "登录" },
  { name: "create_task", label: "创建任务" },
  { name: "invite_member", label: "邀请成员" },
  { name: "create_decision", label: "创建决策" },
] as const;

const RANGE_DAYS = 14;
const MS_PER_DAY = 86_400_000;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string }> },
) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });

  // 仅 owner/admin 可见分析数据
  if (ctx.member.role !== "owner" && ctx.member.role !== "admin") {
    return NextResponse.json({ code: 403, message: "Forbidden" }, { status: 403 });
  }

  try {
    const since = new Date(Date.now() - RANGE_DAYS * MS_PER_DAY);

    const data = await runWithWorkspace(
      wid,
      async (tx) => {
        // 漏斗各步骤去重用户计数（按 userId 去重，匿名事件 userId=null 不计）
        const funnel = await Promise.all(
          FUNNEL_STEPS.map(async (step) => {
            const result = await tx.analyticsEvent.groupBy({
              by: ["userId"],
              where: {
                workspaceId: wid,
                name: step.name,
                createdAt: { gte: since },
                userId: { not: null },
              },

            });
            return { name: step.name, label: step.label, users: result.length };
          }),
        );

        // 最近 14 天每日事件计数（按天聚合）
        const dailyEvents = await tx.analyticsEvent.findMany({
          where: { workspaceId: wid, createdAt: { gte: since } },
          select: { name: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        });

        // 按天 + 事件名分组计数
        const dailyMap = new Map<string, Record<string, number>>();
        for (const e of dailyEvents) {
          const day = e.createdAt.toISOString().slice(0, 10);
          if (!dailyMap.has(day)) dailyMap.set(day, {});
          const dayCounts = dailyMap.get(day)!;
          dayCounts[e.name] = (dayCounts[e.name] ?? 0) + 1;
          dayCounts._total = (dayCounts._total ?? 0) + 1;
        }
        const daily = Array.from(dailyMap.entries())
          .map(([date, counts]) => ({ date, ...counts }))
          .sort((a, b) => a.date.localeCompare(b.date));

        // Top 事件名 + 计数（内存排序，避免 Prisma 6 groupBy orderBy _count 类型不兼容）
        const topEventsAgg = await tx.analyticsEvent.groupBy({
          by: ["name"],
          where: { workspaceId: wid, createdAt: { gte: since } },
          _count: true,
        });
        const topEvents = topEventsAgg
          .map((g) => ({ name: g.name, count: g._count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 8);

        // 总事件数 + 活跃用户数（去重 userId）
        const totalEvents = dailyEvents.length;
        const activeUsersAgg = await tx.analyticsEvent.groupBy({
          by: ["userId"],
          where: {
            workspaceId: wid,
            createdAt: { gte: since },
            userId: { not: null },
          },

        });
        const activeUsers = activeUsersAgg.length;

        return { funnel, daily, topEvents, totalEvents, activeUsers };
      },
      ctx.payload.sub,
    );

    // 计算漏斗转化率
    const funnelWithRate = data.funnel.map((step, i) => {
      const prev = i === 0 ? step.users : data.funnel[i - 1].users;
      const rate = prev === 0 ? 0 : Math.round((step.users / prev) * 100);
      return { ...step, rate };
    });

    return NextResponse.json({
      code: 200,
      data: {
        range: { days: RANGE_DAYS, since: since.toISOString() },
        funnel: funnelWithRate,
        daily: data.daily,
        topEvents: data.topEvents,
        totalEvents: data.totalEvents,
        activeUsers: data.activeUsers,
      },
    });
  } catch (error) {
    console.error("[GET analytics/overview] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: "服务器内部错误" },
      { status: 500 },
    );
  }
}