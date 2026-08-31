"use client";

/**
 * 分析面板 · /w/[wid]/analytics
 *
 * P2 数据埋点：注册/激活/留存/转化漏斗可视化（FUNNEL-METRICS §5）。
 *
 * 数据流：
 *  - GET /api/v1/workspaces/:wid/analytics/overview →
 *      { funnel: { acquisition, activation }, daily, topEvents, totalEvents,
 *        activeUsers, coreActiveUsers, waw: { weekStart, users },
 *        retention: { d1, d7, d30 }, sessions }
 *
 * 权限：owner/admin 可见（API 层 403 兜底，前端隐藏入口在 layout）。
 *
 * 图表优先级（FUNNEL-METRICS §5）：
 *  - P0 北极星卡：WAW 周活跃工作区 + 周起始
 *  - P0 AARRR 两段漏斗：获客段（landing→signup→submit→register）+ 激活段（register→task→activation）
 *  - P0 留存条：D1/D7/D30 回访率
 *  - P1 每日趋势折线（保留现有 SVG 折线，D1 时区修复后数据）
 *  - P1 热门事件列表
 *
 * 设计：
 *  - 漏斗图：横向条形，每步骤显示用户数 + 转化率
 *  - 趋势线：最近 14 天每日事件计数（简易 SVG 折线，不引第三方图表库）
 *  - Top 事件：列表 + 计数 + 占比条
 *  - 所有色值走 var(--token)，图标仅用 lucide-react
 *  - 收敛低调：北极星卡用 accent 色微强调，其余 surface 色收敛
 */

import { use, useEffect, useState } from "react";
import {
  BarChart3,
  TrendingUp,
  Users,
  Activity,
  AlertTriangle,
  Star,
  Filter,
  Repeat,
  Layers,
} from "lucide-react";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/Skeleton";
import { useTranslations } from "next-intl";

/** 漏斗单步结果（与 lib/analytics-funnel.ts StepResult 对齐）。 */
interface FunnelStep {
  name: string;
  label: string;
  users: number;
  rate: number;
}

/** 每日趋势点（D1 修复后按 Asia/Shanghai 日界分桶）。 */
interface DailyPoint {
  date: string;
  _total: number;
  [event: string]: number | string;
}

/** 留存单点：active/eligible/rate。 */
interface RetentionPoint {
  active: number;
  eligible: number;
  rate: number;
}

/** overview API 返回结构（与 overview/route.ts 返回体一一对齐）。 */
interface OverviewData {
  range: { days: number; since: string };
  funnel: { acquisition: FunnelStep[]; activation: FunnelStep[] };
  daily: DailyPoint[];
  topEvents: { name: string; count: number }[];
  totalEvents: number;
  /** 过渡保留：14 天任意事件去重 userId（面板切换完成后移除）。 */
  activeUsers: number;
  /** 严格口径：窗口内 CORE_EVENTS 去重 userId。 */
  coreActiveUsers: number;
  /** WAW 周活跃：本工作区内当前周（周一 00:00 UTC+8 起）CORE_EVENTS 去重 userId。 */
  waw: { weekStart: string; users: number };
  /** D_n 回访率（FUNNEL-METRICS §3.3）。 */
  retention: Record<string, RetentionPoint>;
  /** 窗口内去重 sessionId 计数（D3 修复）。 */
  sessions: number;
}

export default function AnalyticsPage({ params }: { params: Promise<{ wid: string }> }) {
  const { wid } = use(params);
  const [data, setData] = useState<OverviewData | null>(null);
  const t = useTranslations("analytics");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api<OverviewData>(`/api/v1/workspaces/${wid}/analytics/overview`)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : t("loadFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [wid]);

  if (loading) return <AnalyticsSkeleton />;
  if (error) return <ErrorState message={error} />;
  if (!data) return null;

  const maxDaily = Math.max(1, ...data.daily.map((d) => d._total));
  const maxTopEvent = Math.max(1, ...data.topEvents.map((e) => e.count));

  // 留存观察点顺序（FUNNEL-METRICS §3.3）
  const retentionPoints = [
    { key: "d1", labelKey: "retentionD1" },
    { key: "d7", labelKey: "retentionD7" },
    { key: "d30", labelKey: "retentionD30" },
  ] as const;

  return (
    <div className="max-w-4xl mx-auto">
      {/* 标题 */}
      <div className="mb-[var(--space-6)]">
        <h1 className="flex items-center gap-2 text-[length:var(--text-2xl)] font-[var(--weight-semibold)] text-[var(--fg)]">
          <BarChart3 size={20} className="text-[var(--muted)]" />
          {t("title")}
        </h1>
        <p className="mt-1 text-[length:var(--text-sm)] text-[var(--muted)]">
          {t("subtitle", { days: data.range.days })}
        </p>
      </div>

      {/* 北极星卡 + 概览卡 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-[var(--space-3)] mb-[var(--space-6)]">
        {/* WAW 北极星卡（占 2 列，突出展示） */}
        <div className="col-span-2 sm:col-span-2 bg-[var(--surface)] border border-[var(--accent-soft)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] p-4">
          <div className="flex items-center gap-2 mb-2">
            <Star size={16} className="text-[var(--accent)]" fill="currentColor" />
            <span className="text-[length:var(--text-sm)] text-[var(--fg-2)]">{t("wawTitle")}</span>
          </div>
          <div className="text-[length:var(--text-3xl)] font-[var(--weight-semibold)] text-[var(--fg)] tabular-nums tracking-[-0.02em]">
            {data.waw.users}
          </div>
          <div className="mt-1 text-[length:var(--text-xs)] text-[var(--meta)]">
            {t("wawWeekStart", { date: data.waw.weekStart })}
          </div>
        </div>
        <StatCard
          icon={Activity}
          label={t("totalEvents")}
          value={data.totalEvents}
          color="var(--accent)"
        />
        <StatCard
          icon={Users}
          label={t("coreActive")}
          value={data.coreActiveUsers}
          color="var(--success)"
        />
      </div>

      {/* 次级概览：会话数 + 日均事件 + 活跃用户（过渡） */}
      <div className="grid grid-cols-3 gap-[var(--space-3)] mb-[var(--space-6)]">
        <StatCard icon={Layers} label={t("sessions")} value={data.sessions} color="var(--accent)" />
        <StatCard
          icon={TrendingUp}
          label={t("dailyAvgEvents")}
          value={Math.round(data.totalEvents / data.range.days)}
          color="var(--warn)"
        />
        <StatCard
          icon={Users}
          label={t("activeUsers")}
          value={data.activeUsers}
          color="var(--muted)"
        />
      </div>

      {/* 获客段漏斗 */}
      <FunnelSection
        title={t("acquisitionFunnel")}
        description={t("acquisitionDesc")}
        steps={data.funnel.acquisition}
      />

      {/* 激活段漏斗 */}
      <FunnelSection
        title={t("activationFunnel")}
        description={t("activationDesc")}
        steps={data.funnel.activation}
        className="mb-[var(--space-5)]"
      />

      {/* 留存回访率 */}
      <section className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] p-4 sm:p-5 mb-[var(--space-5)]">
        <h2 className="flex items-center gap-2 text-[length:var(--text-md)] font-[var(--weight-semibold)] text-[var(--fg)] mb-4">
          <Repeat size={16} className="text-[var(--muted)]" />
          {t("retentionTitle")}
        </h2>
        <div className="grid grid-cols-3 gap-[var(--space-3)]">
          {retentionPoints.map(({ key, labelKey }) => {
            const r = data.retention[key];
            return (
              <div
                key={key}
                className="bg-[var(--surface-2)] rounded-[var(--radius-sm)] p-3 text-center"
              >
                <div className="text-[length:var(--text-xs)] text-[var(--muted)] mb-1">
                  {t(labelKey)}
                </div>
                <div className="text-[length:var(--text-2xl)] font-[var(--weight-semibold)] text-[var(--fg)] tabular-nums">
                  {r ? `${r.rate}%` : "—"}
                </div>
                <div className="mt-1 text-[length:var(--text-xs)] text-[var(--meta)] tabular-nums">
                  {r ? `${r.active}/${r.eligible}` : "0/0"}
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-4 text-[length:var(--text-xs)] text-[var(--meta)]">
          {t("retentionFormula")}
        </p>
      </section>

      {/* 趋势线 */}
      <section className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] p-4 sm:p-5 mb-[var(--space-5)]">
        <h2 className="text-[length:var(--text-md)] font-[var(--weight-semibold)] text-[var(--fg)] mb-4">
          {t("dailyTrendTitle")}
        </h2>
        {data.daily.length === 0 ? (
          <p className="text-[length:var(--text-sm)] text-[var(--muted)] py-8 text-center">
            {t("noData")}
          </p>
        ) : (
          <DailyTrendChart daily={data.daily} maxDaily={maxDaily} />
        )}
      </section>

      {/* Top 事件 */}
      <section className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] p-4 sm:p-5">
        <h2 className="text-[length:var(--text-md)] font-[var(--weight-semibold)] text-[var(--fg)] mb-4">
          {t("topEventsTitle")}
        </h2>
        {data.topEvents.length === 0 ? (
          <p className="text-[length:var(--text-sm)] text-[var(--muted)] py-8 text-center">
            {t("noData")}
          </p>
        ) : (
          <ul className="space-y-2">
            {data.topEvents.map((e) => {
              const widthPct = (e.count / maxTopEvent) * 100;
              const pct = Math.round((e.count / data.totalEvents) * 100);
              return (
                <li key={e.name} className="flex items-center gap-3">
                  <code className="w-40 sm:w-48 shrink-0 font-[family-name:var(--font-mono)] text-[length:var(--text-xs)] text-[var(--fg-2)] truncate">
                    {e.name}
                  </code>
                  <div className="flex-1 min-w-0">
                    <div className="relative h-5 bg-[var(--surface-2)] rounded-[var(--radius-sm)] overflow-hidden">
                      <div
                        className="absolute inset-y-0 left-0 bg-[var(--accent-soft)] rounded-[var(--radius-sm)]"
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                  </div>
                  <div className="w-16 shrink-0 text-right text-[length:var(--text-xs)] text-[var(--fg-2)] tabular-nums">
                    {e.count}
                  </div>
                  <div className="w-10 shrink-0 text-right text-[length:var(--text-xs)] text-[var(--meta)] tabular-nums">
                    {pct}%
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/** 概览卡：图标 + 标签 + 数值。 */
function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof Activity;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} style={{ color }} />
        <span className="text-[length:var(--text-sm)] text-[var(--fg-2)]">{label}</span>
      </div>
      <div className="text-[length:var(--text-2xl)] font-[var(--weight-semibold)] text-[var(--fg)] tabular-nums tracking-[-0.02em]">
        {value}
      </div>
    </div>
  );
}

/** 漏斗段：横向条形图，每步骤显示用户数 + 相对上一步转化率。 */
function FunnelSection({
  title,
  description,
  steps,
  className,
}: {
  title: string;
  description: string;
  steps: FunnelStep[];
  className?: string;
}) {
  const maxFunnel = Math.max(1, ...steps.map((s) => s.users));

  return (
    <section
      className={`bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] p-4 sm:p-5 mb-[var(--space-5)] ${
        className ?? ""
      }`}
    >
      <h2 className="flex items-center gap-2 text-[length:var(--text-md)] font-[var(--weight-semibold)] text-[var(--fg)] mb-1">
        <Filter size={16} className="text-[var(--muted)]" />
        {title}
      </h2>
      <p className="text-[length:var(--text-xs)] text-[var(--meta)] mb-4">{description}</p>
      <div className="space-y-3">
        {steps.map((step, i) => {
          const widthPct = (step.users / maxFunnel) * 100;
          return (
            <div key={step.name} className="flex items-center gap-3">
              <div className="w-20 sm:w-24 shrink-0 text-[length:var(--text-sm)] text-[var(--fg-2)] truncate">
                {step.label}
              </div>
              <div className="flex-1 min-w-0">
                <div className="relative h-7 bg-[var(--surface-2)] rounded-[var(--radius-sm)] overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 bg-[var(--accent)] rounded-[var(--radius-sm)] transition-[width] duration-[var(--motion-base)]"
                    style={{ width: `${widthPct}%` }}
                  />
                  <span className="absolute inset-0 flex items-center px-2 text-[length:var(--text-xs)] font-[var(--weight-medium)] text-[var(--fg)] tabular-nums">
                    {step.users}
                  </span>
                </div>
              </div>
              <div className="w-12 shrink-0 text-right text-[length:var(--text-xs)] text-[var(--muted)] tabular-nums">
                {i === 0 ? "—" : `${step.rate}%`}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * 每日趋势图：简易 SVG 折线 + 面积填充。
 * 不引第三方图表库，保持 bundle 轻量。
 */
function DailyTrendChart({ daily, maxDaily }: { daily: DailyPoint[]; maxDaily: number }) {
  const W = 600;
  const t = useTranslations("analytics");

  const H = 160;
  const PAD = 24;
  const innerW = W - PAD * 2;
  const innerH = H - PAD * 2;
  const stepX = daily.length > 1 ? innerW / (daily.length - 1) : 0;

  const points = daily.map((d, i) => ({
    x: PAD + i * stepX,
    y: PAD + innerH - (d._total / maxDaily) * innerH,
  }));

  const pathD = points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(" ");
  const areaD = `${pathD} L ${points[points.length - 1].x} ${PAD + innerH} L ${points[0].x} ${PAD + innerH} Z`;

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto min-w-[400px]"
        role="img"
        aria-label={t("trendChartAria")}
      >
        {/* 网格线 */}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <line
            key={t}
            x1={PAD}
            x2={W - PAD}
            y1={PAD + innerH * t}
            y2={PAD + innerH * t}
            stroke="var(--border)"
            strokeWidth={1}
          />
        ))}
        {/* 面积 */}
        <path d={areaD} fill="color-mix(in srgb, var(--accent) 12%, transparent)" />
        {/* 折线 */}
        <path d={pathD} fill="none" stroke="var(--accent)" strokeWidth={2} />
        {/* 数据点 */}
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={3} fill="var(--accent)" />
        ))}
        {/* X 轴标签：首/中/末 */}
        {[0, Math.floor(daily.length / 2), daily.length - 1]
          .filter((i, j, arr) => arr.indexOf(i) === j && i < daily.length)
          .map((i) => (
            <text
              key={i}
              x={PAD + i * stepX}
              y={H - 4}
              textAnchor="middle"
              className="fill-[var(--meta)]"
              style={{ fontSize: 10 }}
            >
              {daily[i].date.slice(5)}
            </text>
          ))}
      </svg>
    </div>
  );
}

/** 错误状态：403 时提示权限不足。 */
function ErrorState({ message }: { message: string }) {
  const t = useTranslations("analytics");
  const forbidden = /403|Forbidden/i.test(message);
  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex flex-col items-center justify-center py-[var(--space-16)] text-center">
        <AlertTriangle
          size={48}
          className="text-[var(--muted)] opacity-40 mb-4"
          strokeWidth={1.5}
        />
        <p className="text-[length:var(--text-base)] text-[var(--fg-2)]">
          {forbidden ? t("needAdmin") : t("loadFailed")}
        </p>
        <p className="mt-1 text-[length:var(--text-sm)] text-[var(--muted)]">
          {forbidden ? t("needAdminDesc") : message || t("retryLater")}
        </p>
      </div>
    </div>
  );
}

/** 加载骨架（与新布局对齐：北极星卡 + 概览卡 + 两段漏斗 + 留存 + 趋势 + 热门事件）。 */
function AnalyticsSkeleton() {
  return (
    <div className="max-w-4xl mx-auto" aria-busy="true">
      <div className="mb-[var(--space-6)]">
        <Skeleton className="h-8 w-32 mb-2" />
        <Skeleton className="h-4 w-48" />
      </div>
      {/* 北极星 + 概览卡骨架 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-[var(--space-3)] mb-[var(--space-6)]">
        <div className="col-span-2 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] p-4">
          <Skeleton className="h-4 w-32 mb-2" />
          <Skeleton className="h-9 w-20 mb-1" />
          <Skeleton className="h-3 w-40" />
        </div>
        {Array.from({ length: 2 }).map((_, i) => (
          <div
            key={i}
            className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] p-4"
          >
            <Skeleton className="h-4 w-20 mb-2" />
            <Skeleton className="h-7 w-16" />
          </div>
        ))}
      </div>
      {/* 次级概览骨架 */}
      <div className="grid grid-cols-3 gap-[var(--space-3)] mb-[var(--space-6)]">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] p-4"
          >
            <Skeleton className="h-4 w-16 mb-2" />
            <Skeleton className="h-7 w-12" />
          </div>
        ))}
      </div>
      {/* 漏斗段骨架 ×2 */}
      {Array.from({ length: 2 }).map((_, idx) => (
        <div
          key={idx}
          className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] p-5 mb-[var(--space-5)]"
        >
          <Skeleton className="h-5 w-28 mb-4" />
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="w-20 h-4 shrink-0" />
                <Skeleton className="flex-1 h-7" />
                <Skeleton className="w-12 h-4 shrink-0" />
              </div>
            ))}
          </div>
        </div>
      ))}
      {/* 留存骨架 */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] p-5 mb-[var(--space-5)]">
        <Skeleton className="h-5 w-28 mb-4" />
        <div className="grid grid-cols-3 gap-[var(--space-3)]">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-[var(--surface-2)] rounded-[var(--radius-sm)] p-3">
              <Skeleton className="h-3 w-8 mx-auto mb-2" />
              <Skeleton className="h-7 w-12 mx-auto mb-1" />
              <Skeleton className="h-3 w-10 mx-auto" />
            </div>
          ))}
        </div>
      </div>
      {/* 趋势骨架 */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] p-5 mb-[var(--space-5)]">
        <Skeleton className="h-5 w-32 mb-4" />
        <Skeleton className="h-40 w-full" />
      </div>
      {/* 热门事件骨架 */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] p-5">
        <Skeleton className="h-5 w-24 mb-4" />
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="w-40 h-4 shrink-0" />
              <Skeleton className="flex-1 h-5" />
              <Skeleton className="w-16 h-4 shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
