import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { shanghaiDay, shanghaiWeekKey, CORE_EVENTS } from "@/lib/analytics-time";
import { matchFunnel, type FunnelEvent } from "@/lib/analytics-funnel";

/**
 * GET /api/v1/workspaces/:wid/analytics/overview — 工作区分析概览。
 *
 * P2 数据埋点：注册/激活/留存/转化漏斗。
 *
 * 返回：
 *  - funnel：两段序列化漏斗（获客段 + 激活段，D2 修复）
 *  - daily：最近 14 天每日事件计数（D1 修复：Asia/Shanghai 日界）
 *  - topEvents：Top 8 事件名 + 计数
 *  - waw/coreActiveUsers：周/工作区内核心活跃（D3 修复）
 *  - retention：D1/D7/D30 回访率（D3 修复）
 *  - sessions：窗口内去重 sessionId 计数（D3 修复）
 *  - activeUsers：过渡期保留（面板切换完成前双发），随后移除
 *
 * 权限：owner/admin 可见（成员返回 403）。
 * RLS：走 runWithWorkspace，工作区隔离。
 */

/** 获客段漏斗步骤（按 sessionId 分组串联，匿名可算）。 */
const ACQUISITION_STEPS = [
  { name: "landing_view", label: "落地曝光" },
  { name: "click_signup", label: "点击注册" },
  { name: "register_submit", label: "提交注册" },
  { name: "register_success", label: "注册成功" },
] as const;

/** 激活段漏斗步骤（按 workspaceId+userId 分组串联，全服务端事件）。 */
const ACTIVATION_STEPS = [
  { name: "register_success", label: "注册成功" },
  { name: "create_task", label: "创建任务" },
  { name: "activation_completed", label: "激活完成" },
] as const;

const RANGE_DAYS = 14;
const MS_PER_DAY = 86_400_000;

/** D_n 回访观察点（FUNNEL-METRICS §3.3）。 */
const RETENTION_POINTS = [1, 7, 30] as const;

export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
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
        // 一次拉取窗口内全量事件，内存聚合（容量估算 §6.5 支撑）
        const allEvents = await tx.analyticsEvent.findMany({
          where: { workspaceId: wid, createdAt: { gte: since } },
          select: {
            name: true,
            createdAt: true,
            userId: true,
            sessionId: true,
          },
          orderBy: { createdAt: "asc" },
        });

        // ─── D2 两段序列化漏斗 ───
        // 获客段按 sessionId 分组
        const acquisitionEvents: FunnelEvent[] = allEvents
          .filter((e) =>
            (ACQUISITION_STEPS as readonly { name: string }[]).some((s) => s.name === e.name),
          )
          .map((e) => ({
            name: e.name,
            createdAt: e.createdAt,
            groupKey: e.sessionId ?? "null",
          }));
        const acquisition = matchFunnel(
          acquisitionEvents,
          ACQUISITION_STEPS as readonly { name: string; label: string }[],
        );

        // 激活段按 (workspaceId, userId) 分组——此处 wid 固定，按 userId 分组即可
        const activationEvents: FunnelEvent[] = allEvents
          .filter((e) =>
            (ACTIVATION_STEPS as readonly { name: string }[]).some((s) => s.name === e.name),
          )
          .filter((e) => !!e.userId)
          .map((e) => ({
            name: e.name,
            createdAt: e.createdAt,
            groupKey: e.userId!,
          }));
        const activation = matchFunnel(
          activationEvents,
          ACTIVATION_STEPS as readonly { name: string; label: string }[],
        );

        // ─── D1 修复：daily 按 Asia/Shanghai 日界分桶 ───
        const dailyMap = new Map<string, Record<string, number>>();
        for (const e of allEvents) {
          const day = shanghaiDay(e.createdAt);
          if (!dailyMap.has(day)) dailyMap.set(day, {});
          const dayCounts = dailyMap.get(day)!;
          dayCounts[e.name] = (dayCounts[e.name] ?? 0) + 1;
          dayCounts._total = (dayCounts._total ?? 0) + 1;
        }
        const daily = Array.from(dailyMap.entries())
          .map(([date, counts]) => ({ date, ...counts }))
          .sort((a, b) => a.date.localeCompare(b.date));

        // Top 事件名 + 计数（内存排序，避免 Prisma 6 groupBy orderBy _count 类型不兼容）
        const nameCounts = new Map<string, number>();
        for (const e of allEvents) {
          nameCounts.set(e.name, (nameCounts.get(e.name) ?? 0) + 1);
        }
        const topEvents = Array.from(nameCounts.entries())
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 8);

        const totalEvents = allEvents.length;

        // ─── D3 修复：activeUsers 过渡保留 + coreActiveUsers 严格口径 ───
        // activeUsers（过渡期双发，面板切换完成后移除）：14 天任意事件去重 userId
        const activeUsers = new Set(allEvents.filter((e) => !!e.userId).map((e) => e.userId!)).size;

        // coreActiveUsers：窗口内 CORE_EVENTS 去重 userId（严格口径）
        const coreActiveUsers = new Set(
          allEvents.filter((e) => CORE_EVENTS.has(e.name) && !!e.userId).map((e) => e.userId!),
        ).size;

        // ─── D3 修复：WAW 周活跃 ───
        // 本工作区内：当前周（周一 00:00 UTC+8 起）CORE_EVENTS 去重 userId
        // 全局 WAW 跨工作区聚合另设端点，此处仅出工作区内值
        const now = Date.now();
        const weekStartKey = shanghaiWeekKey(new Date(now));
        const wawUsers = new Set(
          allEvents
            .filter(
              (e) =>
                CORE_EVENTS.has(e.name) &&
                !!e.userId &&
                shanghaiWeekKey(e.createdAt) === weekStartKey,
            )
            .map((e) => e.userId!),
        ).size;

        // ─── D3 修复：retention D1/D7/D30 ───
        // D_n 回访率 ＝ 工作区内 register_success 所在日（Asia/Shanghai）后第 n 天
        // 产生 ≥1 次 CORE_EVENTS 的用户数 ÷ 注册满 n 天的用户数
        // D0 以 register_success 事件 createdAt 为准（批准口径）
        const retention: Record<string, { active: number; eligible: number; rate: number }> = {};
        const registerEvents = allEvents.filter((e) => e.name === "register_success" && !!e.userId);
        for (const n of RETENTION_POINTS) {
          let active = 0;
          let eligible = 0;
          for (const reg of registerEvents) {
            const d0 = shanghaiDay(reg.createdAt);
            const d0Time = new Date(d0 + "T00:00:00+08:00").getTime();
            const targetDayStart = d0Time + n * MS_PER_DAY;
            const targetDayEnd = targetDayStart + MS_PER_DAY;
            // 注册满 n 天：targetDayStart <= now
            if (targetDayStart > now) continue;
            eligible++;
            // 第 n 天内有 CORE_EVENTS
            const hasCore = allEvents.some(
              (e) =>
                CORE_EVENTS.has(e.name) &&
                e.userId === reg.userId &&
                e.createdAt.getTime() >= targetDayStart &&
                e.createdAt.getTime() < targetDayEnd,
            );
            if (hasCore) active++;
          }
          const rate = eligible === 0 ? 0 : Math.round((active / eligible) * 100);
          retention[`d${n}`] = { active, eligible, rate };
        }

        // ─── D3 修复：sessions 窗口内去重 sessionId 计数 ───
        const sessions = new Set(allEvents.filter((e) => !!e.sessionId).map((e) => e.sessionId!))
          .size;

        return {
          funnel: { acquisition, activation },
          daily,
          topEvents,
          totalEvents,
          activeUsers,
          coreActiveUsers,
          waw: { weekStart: weekStartKey, users: wawUsers },
          retention,
          sessions,
        };
      },
      ctx.payload.sub,
    );

    return NextResponse.json({
      code: 200,
      data: {
        range: { days: RANGE_DAYS, since: since.toISOString() },
        ...data,
      },
    });
  } catch (error) {
    console.error("[GET analytics/overview] error:", error);
    return NextResponse.json({ code: 500, data: null, message: "服务器内部错误" }, { status: 500 });
  }
}
