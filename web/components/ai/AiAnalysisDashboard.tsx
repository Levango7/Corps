"use client";

/**
 * AI 数据分析仪表板。
 *
 * 4 个分析类型 tab：
 *  - 燃尽图：调用 /api/v1/ai/analysis/burndown，渲染 BurndownChart
 *  - 团队效能：调用 /api/v1/ai/analysis/team-performance，渲染成员效能表
 *  - 瓶颈分析：调用 /api/v1/ai/analysis/bottleneck，渲染瓶颈列表 + 关键路径
 *  - 自动周报：调用 /api/v1/ai/analysis/weekly-report，渲染周报结构化内容
 *
 * 交互：
 *  - 选择时间范围（本周/上周/本月/自定义）
 *  - 触发分析（点击"开始分析"按钮）
 *  - 查看历史报告（点击"历史报告"按钮，调用 /api/v1/ai/analysis/reports）
 *
 * Design token 样式，lucide-react 图标（size 14/16），useTranslations hook。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Sparkles,
  TrendingDown,
  Users,
  AlertTriangle,
  FileText,
  Loader2,
  RefreshCw,
  History,
  Calendar,
  ChevronRight,
  Target,
  CheckCircle2,
  Flag,
} from "lucide-react";
import { api } from "@/lib/api";
import { BurndownChart, type BurndownPoint } from "./BurndownChart";
import { FeedbackButtons } from "./FeedbackButtons";

type AnalysisType = "burndown" | "team_performance" | "bottleneck" | "weekly_report";
type PeriodPreset = "thisWeek" | "lastWeek" | "thisMonth" | "custom";

/** tab 配置 */
const TABS: ReadonlyArray<{
  type: AnalysisType;
  Icon: typeof Sparkles;
  labelKey: string;
}> = [
  { type: "burndown", Icon: TrendingDown, labelKey: "burndown" },
  { type: "team_performance", Icon: Users, labelKey: "teamPerformance" },
  { type: "bottleneck", Icon: AlertTriangle, labelKey: "bottleneck" },
  { type: "weekly_report", Icon: FileText, labelKey: "weeklyReport" },
];

/** 燃尽图结果 */
interface BurndownResult {
  reportId: string;
  summary: string;
  idealLine: BurndownPoint[];
  actualLine: BurndownPoint[];
  predictedCompletion: string;
  deviation: string;
  insights: string[];
}

/** 团队效能结果 */
interface TeamPerformanceResult {
  reportId: string;
  summary: string;
  members: {
    name: string;
    completionRate: number;
    avgCycleDays: number;
    workload: number;
    strengths: string[];
  }[];
  insights: string[];
}

/** 瓶颈分析结果 */
interface BottleneckResult {
  reportId: string;
  summary: string;
  bottlenecks: {
    taskTitle: string;
    reason: string;
    impact: string;
    suggestion: string;
  }[];
  criticalPath: string[];
  insights: string[];
}

/** 周报结果 */
interface WeeklyReportResult {
  reportId: string;
  summary: string;
  completed: { title: string; owner: string; date: string }[];
  planned: { title: string; owner: string; dueDate: string }[];
  risks: { description: string; level: string }[];
  milestones: { title: string; status: string }[];
  insights: string[];
}

/** 历史报告列表项 */
interface ReportListItem {
  id: string;
  type: string;
  title: string;
  summary: string;
  createdAt: string;
}

interface AiAnalysisDashboardProps {
  /** 工作区 ID */
  wid: string;
}

/** 计算预设周期的 start/end（ISO datetime 字符串） */
function presetPeriod(preset: PeriodPreset): { start: string; end: string } {
  const now = new Date();
  const day = now.getDay();
  const toIso = (d: Date) => {
    const s = new Date(d);
    s.setHours(0, 0, 0, 0);
    return s.toISOString();
  };
  const toIsoEnd = (d: Date) => {
    const s = new Date(d);
    s.setHours(23, 59, 59, 999);
    return s.toISOString();
  };
  switch (preset) {
    case "thisWeek": {
      const monday = new Date(now);
      monday.setDate(now.getDate() - ((day + 6) % 7));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return { start: toIso(monday), end: toIsoEnd(sunday) };
    }
    case "lastWeek": {
      const lastMonday = new Date(now);
      lastMonday.setDate(now.getDate() - ((day + 6) % 7) - 7);
      const lastSunday = new Date(lastMonday);
      lastSunday.setDate(lastMonday.getDate() + 6);
      return { start: toIso(lastMonday), end: toIsoEnd(lastSunday) };
    }
    case "thisMonth": {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { start: toIso(first), end: toIsoEnd(last) };
    }
    case "custom":
    default:
      return { start: toIso(now), end: toIsoEnd(now) };
  }
}

/** 风险等级 → design token 颜色 */
function riskLevelColor(level: string): string {
  switch (level.toLowerCase()) {
    case "high":
      return "var(--danger)";
    case "medium":
      return "var(--warning)";
    case "low":
    default:
      return "var(--success)";
  }
}

export function AiAnalysisDashboard({ wid }: AiAnalysisDashboardProps) {
  const t = useTranslations("ai.aiAnalysis");

  const [activeType, setActiveType] = useState<AnalysisType>("burndown");
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>("thisWeek");
  const [loading, setLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyItems, setHistoryItems] = useState<ReportListItem[]>([]);

  // 各类型结果
  const [burndown, setBurndown] = useState<BurndownResult | null>(null);
  const [teamPerf, setTeamPerf] = useState<TeamPerformanceResult | null>(null);
  const [bottleneck, setBottleneck] = useState<BottleneckResult | null>(null);
  const [weekly, setWeekly] = useState<WeeklyReportResult | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  /** 触发分析 */
  const runAnalysis = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setLoading(true);
    setHasError(false);

    // 清空当前类型结果
    if (activeType === "burndown") setBurndown(null);
    if (activeType === "team_performance") setTeamPerf(null);
    if (activeType === "bottleneck") setBottleneck(null);
    if (activeType === "weekly_report") setWeekly(null);

    try {
      const period = presetPeriod(periodPreset);
      if (activeType === "burndown") {
        const result = await api<BurndownResult>("/api/v1/ai/analysis/burndown", {
          method: "POST",
          body: JSON.stringify({ wid, period }),
          signal: ac.signal,
        });
        if (!ac.signal.aborted) setBurndown(result);
      } else if (activeType === "team_performance") {
        const result = await api<TeamPerformanceResult>(
          "/api/v1/ai/analysis/team-performance",
          {
            method: "POST",
            body: JSON.stringify({ wid, period }),
            signal: ac.signal,
          },
        );
        if (!ac.signal.aborted) setTeamPerf(result);
      } else if (activeType === "bottleneck") {
        const result = await api<BottleneckResult>("/api/v1/ai/analysis/bottleneck", {
          method: "POST",
          body: JSON.stringify({ wid }),
          signal: ac.signal,
        });
        if (!ac.signal.aborted) setBottleneck(result);
      } else if (activeType === "weekly_report") {
        const body: Record<string, unknown> = { wid };
        if (periodPreset !== "custom") {
          body.weekStart = period.start;
        }
        const result = await api<WeeklyReportResult>(
          "/api/v1/ai/analysis/weekly-report",
          {
            method: "POST",
            body: JSON.stringify(body),
            signal: ac.signal,
          },
        );
        if (!ac.signal.aborted) setWeekly(result);
      }
    } catch (e) {
      if (ac.signal.aborted) return;
      if (e instanceof Error && e.name === "AbortError") return;
      console.error("[AiAnalysisDashboard] runAnalysis error:", e);
      setHasError(true);
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [activeType, periodPreset, wid]);

  /** 加载历史报告 */
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const result = await api<{ items: ReportListItem[]; total: number }>(
        `/api/v1/ai/analysis/reports?wid=${encodeURIComponent(wid)}&type=${activeType}&page=1&pageSize=20`,
        { method: "GET" },
      );
      setHistoryItems(result.items);
    } catch (e) {
      console.error("[AiAnalysisDashboard] loadHistory error:", e);
      setHistoryItems([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [wid, activeType]);

  // 切换 tab 时不自动触发分析（用户点击"开始分析"按钮触发）
  // 切换历史面板时加载历史
  useEffect(() => {
    if (showHistory) {
      void loadHistory();
    }
  }, [showHistory, loadHistory]);

  // 卸载时中止请求
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  /** 当前活跃结果用于反馈按钮 */
  const activeReportId =
    burndown?.reportId ?? teamPerf?.reportId ?? bottleneck?.reportId ?? weekly?.reportId ?? null;

  return (
    <div
      className="flex h-full flex-col bg-[var(--surface)]"
      aria-label={t("title")}
    >
      {/* 标题栏 */}
      <header className="flex items-center justify-between border-b border-[var(--border)] px-[var(--space-5)] py-[var(--space-3)]">
        <div className="flex items-center gap-[var(--space-2)]">
          <Sparkles size={16} className="text-[var(--accent)]" />
          <h1 className="text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
            {t("title")}
          </h1>
        </div>
        <button
          type="button"
          onClick={() => setShowHistory((v) => !v)}
          className="inline-flex items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--fg-2)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
          aria-expanded={showHistory}
        >
          <History size={14} />
          {t("history")}
        </button>
      </header>

      {/* Tab 栏 */}
      <nav className="flex items-center gap-[var(--space-1)] border-b border-[var(--border)] px-[var(--space-5)]">
        {TABS.map(({ type, Icon, labelKey }) => {
          const active = type === activeType;
          return (
            <button
              key={type}
              type="button"
              onClick={() => setActiveType(type)}
              className={`inline-flex items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-3)] text-[length:var(--text-sm)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] ${
                active
                  ? "border-b-2 border-[var(--accent)] font-[weight:var(--weight-medium)] text-[var(--fg)]"
                  : "border-b-2 border-transparent text-[var(--muted)] hover:text-[var(--fg)]"
              }`}
              aria-current={active ? "page" : undefined}
            >
              <Icon size={14} />
              {t(labelKey)}
            </button>
          );
        })}
      </nav>

      {/* 控制栏：周期选择 + 分析按钮 */}
      <div className="flex items-center justify-between gap-[var(--space-3)] border-b border-[var(--border)] px-[var(--space-5)] py-[var(--space-2)]">
        <div className="flex items-center gap-[var(--space-2)]">
          <Calendar size={14} className="text-[var(--muted)]" />
          <span className="text-[length:var(--text-sm)] text-[var(--muted)]">
            {t("period")}：
          </span>
          <select
            value={periodPreset}
            onChange={(e) => setPeriodPreset(e.target.value as PeriodPreset)}
            className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-2)] py-[var(--space-1)] text-[length:var(--text-sm)] text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            aria-label={t("period")}
          >
            <option value="thisWeek">{t("thisWeek")}</option>
            <option value="lastWeek">{t("lastWeek")}</option>
            <option value="thisMonth">{t("thisMonth")}</option>
            <option value="custom">{t("custom")}</option>
          </select>
        </div>
        <button
          type="button"
          onClick={runAnalysis}
          disabled={loading}
          className="inline-flex items-center gap-[var(--space-2)] rounded-[var(--radius-md)] bg-[var(--accent)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--on-accent)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
        >
          {loading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Sparkles size={14} />
          )}
          {loading ? t("analyzing") : t("run")}
        </button>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto px-[var(--space-5)] py-[var(--space-4)]">
        {/* 错误提示 */}
        {hasError && (
          <div className="mb-[var(--space-4)] flex flex-col gap-[var(--space-3)]">
            <div className="flex items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--danger)] bg-[var(--danger-soft)] px-[var(--space-3)] py-[var(--space-2)]">
              <AlertTriangle size={14} className="text-[var(--danger)]" />
              <span className="text-[length:var(--text-sm)] text-[var(--danger)]">
                {t("error")}
              </span>
            </div>
            <button
              type="button"
              onClick={runAnalysis}
              className="inline-flex w-fit items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--fg-2)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            >
              <RefreshCw size={14} />
              {t("run")}
            </button>
          </div>
        )}

        {/* 加载中 */}
        {loading && !hasError && (
          <div className="flex items-center gap-[var(--space-2)] py-[var(--space-8)] text-[var(--muted)]">
            <Loader2 size={16} className="animate-spin" />
            <span className="text-[length:var(--text-sm)]">{t("analyzing")}</span>
          </div>
        )}

        {/* 燃尽图视图 */}
        {!loading && !hasError && activeType === "burndown" && burndown && (
          <div className="space-y-[var(--space-4)]">
            <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] p-[var(--space-4)]">
              <h2 className="mb-[var(--space-2)] text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
                {t("summary")}
              </h2>
              <p className="text-[length:var(--text-sm)] text-[var(--fg-2)]">
                {burndown.summary}
              </p>
            </section>
            <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
              <BurndownChart
                idealLine={burndown.idealLine}
                actualLine={burndown.actualLine}
                predictedCompletion={burndown.predictedCompletion}
              />
            </section>
            <div className="grid grid-cols-2 gap-[var(--space-3)]">
              <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] p-[var(--space-3)]">
                <h3 className="mb-[var(--space-1)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
                  {t("predictedCompletion")}
                </h3>
                <p className="text-[length:var(--text-sm)] text-[var(--fg-2)]">
                  {burndown.predictedCompletion || "-"}
                </p>
              </section>
              <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] p-[var(--space-3)]">
                <h3 className="mb-[var(--space-1)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
                  {t("deviation")}
                </h3>
                <p className="text-[length:var(--text-sm)] text-[var(--fg-2)]">
                  {burndown.deviation || "-"}
                </p>
              </section>
            </div>
            {burndown.insights.length > 0 && (
              <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] p-[var(--space-4)]">
                <h3 className="mb-[var(--space-2)] flex items-center gap-[var(--space-2)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
                  <Sparkles size={14} className="text-[var(--accent)]" />
                  {t("insights")}
                </h3>
                <ul className="space-y-[var(--space-1)]">
                  {burndown.insights.map((ins, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--fg-2)]"
                    >
                      <ChevronRight size={14} className="mt-0.5 shrink-0 text-[var(--muted)]" />
                      <span>{ins}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}

        {/* 团队效能视图 */}
        {!loading && !hasError && activeType === "team_performance" && teamPerf && (
          <div className="space-y-[var(--space-4)]">
            <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] p-[var(--space-4)]">
              <h2 className="mb-[var(--space-2)] text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
                {t("summary")}
              </h2>
              <p className="text-[length:var(--text-sm)] text-[var(--fg-2)]">
                {teamPerf.summary}
              </p>
            </section>
            <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
              <div className="overflow-x-auto">
                <table className="w-full text-[length:var(--text-sm)]">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-left text-[var(--muted)]">
                      <th className="py-[var(--space-2)] pr-[var(--space-3)] font-[weight:var(--weight-medium)]">{t("teamPerformance")}</th>
                      <th className="py-[var(--space-2)] px-[var(--space-3)] font-[weight:var(--weight-medium)]">Completion</th>
                      <th className="py-[var(--space-2)] px-[var(--space-3)] font-[weight:var(--weight-medium)]">Avg Days</th>
                      <th className="py-[var(--space-2)] px-[var(--space-3)] font-[weight:var(--weight-medium)]">Workload</th>
                      <th className="py-[var(--space-2)] pl-[var(--space-3)] font-[weight:var(--weight-medium)]">Strengths</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teamPerf.members.map((m, i) => (
                      <tr
                        key={i}
                        className="border-b border-[var(--border-soft)] text-[var(--fg-2)]"
                      >
                        <td className="py-[var(--space-2)] pr-[var(--space-3)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
                          {m.name}
                        </td>
                        <td className="py-[var(--space-2)] px-[var(--space-3)]">
                          {(m.completionRate * 100).toFixed(0)}%
                        </td>
                        <td className="py-[var(--space-2)] px-[var(--space-3)]">
                          {m.avgCycleDays.toFixed(1)}
                        </td>
                        <td className="py-[var(--space-2)] px-[var(--space-3)]">{m.workload}</td>
                        <td className="py-[var(--space-2)] pl-[var(--space-3)] text-[var(--muted)]">
                          {m.strengths.join("、")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            {teamPerf.insights.length > 0 && (
              <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] p-[var(--space-4)]">
                <h3 className="mb-[var(--space-2)] flex items-center gap-[var(--space-2)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
                  <Sparkles size={14} className="text-[var(--accent)]" />
                  {t("insights")}
                </h3>
                <ul className="space-y-[var(--space-1)]">
                  {teamPerf.insights.map((ins, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--fg-2)]"
                    >
                      <ChevronRight size={14} className="mt-0.5 shrink-0 text-[var(--muted)]" />
                      <span>{ins}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}

        {/* 瓶颈分析视图 */}
        {!loading && !hasError && activeType === "bottleneck" && bottleneck && (
          <div className="space-y-[var(--space-4)]">
            <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] p-[var(--space-4)]">
              <h2 className="mb-[var(--space-2)] text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
                {t("summary")}
              </h2>
              <p className="text-[length:var(--text-sm)] text-[var(--fg-2)]">
                {bottleneck.summary}
              </p>
            </section>
            {bottleneck.criticalPath.length > 0 && (
              <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] p-[var(--space-4)]">
                <h3 className="mb-[var(--space-2)] flex items-center gap-[var(--space-2)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
                  <Target size={14} className="text-[var(--accent)]" />
                  {t("criticalPath")}
                </h3>
                <div className="flex flex-wrap items-center gap-[var(--space-1)] text-[length:var(--text-sm)] text-[var(--fg-2)]">
                  {bottleneck.criticalPath.map((task, i) => (
                    <span key={i} className="inline-flex items-center gap-[var(--space-1)]">
                      {i > 0 && <ChevronRight size={14} className="text-[var(--muted)]" />}
                      <span className="rounded-[var(--radius-sm)] bg-[var(--surface-3)] px-[var(--space-2)] py-[var(--space-1)]">
                        {task}
                      </span>
                    </span>
                  ))}
                </div>
              </section>
            )}
            {bottleneck.bottlenecks.length > 0 && (
              <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
                <h3 className="mb-[var(--space-3)] flex items-center gap-[var(--space-2)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
                  <AlertTriangle size={14} className="text-[var(--danger)]" />
                  {t("bottlenecks")}
                </h3>
                <ul className="space-y-[var(--space-3)]">
                  {bottleneck.bottlenecks.map((b, i) => (
                    <li
                      key={i}
                      className="rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--surface-2)] p-[var(--space-3)]"
                    >
                      <p className="mb-[var(--space-1)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
                        {b.taskTitle}
                      </p>
                      <p className="text-[length:var(--text-sm)] text-[var(--muted)]">
                        {t("bottlenecks")}：{b.reason}
                      </p>
                      <p className="mt-[var(--space-1)] text-[length:var(--text-sm)] text-[var(--fg-2)]">
                        {b.impact}
                      </p>
                      <p className="mt-[var(--space-1)] text-[length:var(--text-sm)] text-[var(--accent)]">
                        {b.suggestion}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {bottleneck.insights.length > 0 && (
              <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] p-[var(--space-4)]">
                <h3 className="mb-[var(--space-2)] flex items-center gap-[var(--space-2)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
                  <Sparkles size={14} className="text-[var(--accent)]" />
                  {t("insights")}
                </h3>
                <ul className="space-y-[var(--space-1)]">
                  {bottleneck.insights.map((ins, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--fg-2)]"
                    >
                      <ChevronRight size={14} className="mt-0.5 shrink-0 text-[var(--muted)]" />
                      <span>{ins}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}

        {/* 周报视图 */}
        {!loading && !hasError && activeType === "weekly_report" && weekly && (
          <div className="space-y-[var(--space-4)]">
            <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] p-[var(--space-4)]">
              <h2 className="mb-[var(--space-2)] text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
                {t("summary")}
              </h2>
              <p className="text-[length:var(--text-sm)] text-[var(--fg-2)]">
                {weekly.summary}
              </p>
            </section>
            <div className="grid grid-cols-1 gap-[var(--space-3)] sm:grid-cols-2">
              {/* 本周完成 */}
              <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] p-[var(--space-4)]">
                <h3 className="mb-[var(--space-2)] flex items-center gap-[var(--space-2)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
                  <CheckCircle2 size={14} className="text-[var(--success)]" />
                  {t("completed")}
                </h3>
                <ul className="space-y-[var(--space-1)]">
                  {weekly.completed.map((c, i) => (
                    <li key={i} className="text-[length:var(--text-sm)] text-[var(--fg-2)]">
                      <span className="font-[weight:var(--weight-medium)]">{c.title}</span>
                      <span className="text-[var(--muted)]"> — {c.owner} · {c.date}</span>
                    </li>
                  ))}
                  {weekly.completed.length === 0 && (
                    <li className="text-[length:var(--text-sm)] text-[var(--muted)]">-</li>
                  )}
                </ul>
              </section>
              {/* 下周计划 */}
              <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] p-[var(--space-4)]">
                <h3 className="mb-[var(--space-2)] flex items-center gap-[var(--space-2)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
                  <Calendar size={14} className="text-[var(--accent)]" />
                  {t("planned")}
                </h3>
                <ul className="space-y-[var(--space-1)]">
                  {weekly.planned.map((p, i) => (
                    <li key={i} className="text-[length:var(--text-sm)] text-[var(--fg-2)]">
                      <span className="font-[weight:var(--weight-medium)]">{p.title}</span>
                      <span className="text-[var(--muted)]"> — {p.owner} · {p.dueDate}</span>
                    </li>
                  ))}
                  {weekly.planned.length === 0 && (
                    <li className="text-[length:var(--text-sm)] text-[var(--muted)]">-</li>
                  )}
                </ul>
              </section>
              {/* 风险项 */}
              <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] p-[var(--space-4)]">
                <h3 className="mb-[var(--space-2)] flex items-center gap-[var(--space-2)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
                  <AlertTriangle size={14} className="text-[var(--danger)]" />
                  {t("risks")}
                </h3>
                <ul className="space-y-[var(--space-1)]">
                  {weekly.risks.map((r, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-[var(--space-2)] text-[length:var(--text-sm)]"
                    >
                      <span
                        className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full"
                        style={{ background: riskLevelColor(r.level) }}
                        aria-label={r.level}
                      />
                      <span className="text-[var(--fg-2)]">{r.description}</span>
                    </li>
                  ))}
                  {weekly.risks.length === 0 && (
                    <li className="text-[length:var(--text-sm)] text-[var(--muted)]">-</li>
                  )}
                </ul>
              </section>
              {/* 里程碑 */}
              <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] p-[var(--space-4)]">
                <h3 className="mb-[var(--space-2)] flex items-center gap-[var(--space-2)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
                  <Flag size={14} className="text-[var(--accent)]" />
                  {t("milestones")}
                </h3>
                <ul className="space-y-[var(--space-1)]">
                  {weekly.milestones.map((m, i) => (
                    <li key={i} className="text-[length:var(--text-sm)] text-[var(--fg-2)]">
                      <span className="font-[weight:var(--weight-medium)]">{m.title}</span>
                      <span className="text-[var(--muted)]"> — {m.status}</span>
                    </li>
                  ))}
                  {weekly.milestones.length === 0 && (
                    <li className="text-[length:var(--text-sm)] text-[var(--muted)]">-</li>
                  )}
                </ul>
              </section>
            </div>
            {weekly.insights.length > 0 && (
              <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] p-[var(--space-4)]">
                <h3 className="mb-[var(--space-2)] flex items-center gap-[var(--space-2)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
                  <Sparkles size={14} className="text-[var(--accent)]" />
                  {t("insights")}
                </h3>
                <ul className="space-y-[var(--space-1)]">
                  {weekly.insights.map((ins, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--fg-2)]"
                    >
                      <ChevronRight size={14} className="mt-0.5 shrink-0 text-[var(--muted)]" />
                      <span>{ins}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}

        {/* 空状态 */}
        {!loading && !hasError && !burndown && !teamPerf && !bottleneck && !weekly && (
          <div className="flex flex-col items-center justify-center py-[var(--space-8)] text-[var(--muted)]">
            <Sparkles size={28} className="mb-[var(--space-2)] opacity-40" />
            <p className="text-[length:var(--text-sm)]">{t("noReports")}</p>
          </div>
        )}

        {/* 反馈按钮 */}
        {!loading && !hasError && activeReportId && (
          <div className="mt-[var(--space-4)]">
            <FeedbackButtons
              capability={`analysis-${activeType}`}
              workspaceId={wid}
              originalOutput={
                burndown ?? teamPerf ?? bottleneck ?? weekly ?? null
              }
            />
          </div>
        )}
      </div>

      {/* 历史报告抽屉 */}
      {showHistory && (
        <div
          className="fixed inset-0 z-[var(--z-modal)] flex justify-end bg-[var(--overlay)]"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowHistory(false);
          }}
        >
          <div className="w-[min(90vw,480px)] h-full bg-[var(--surface)] border-l border-[var(--border)] overflow-y-auto">
            <header className="flex items-center justify-between border-b border-[var(--border)] px-[var(--space-5)] py-[var(--space-3)]">
              <h2 className="flex items-center gap-[var(--space-2)] text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
                <History size={16} className="text-[var(--accent)]" />
                {t("history")}
              </h2>
              <button
                type="button"
                onClick={() => setShowHistory(false)}
                className="rounded-[var(--radius-sm)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--muted)] hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                aria-label="close"
              >
                ✕
              </button>
            </header>
            <div className="p-[var(--space-4)]">
              {historyLoading ? (
                <div className="flex items-center gap-[var(--space-2)] py-[var(--space-4)] text-[var(--muted)]">
                  <Loader2 size={14} className="animate-spin" />
                  <span className="text-[length:var(--text-sm)]">{t("analyzing")}</span>
                </div>
              ) : historyItems.length === 0 ? (
                <p className="py-[var(--space-4)] text-center text-[length:var(--text-sm)] text-[var(--muted)]">
                  {t("noReports")}
                </p>
              ) : (
                <ul className="space-y-[var(--space-2)]">
                  {historyItems.map((item) => (
                    <li
                      key={item.id}
                      className="rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--surface-2)] p-[var(--space-3)]"
                    >
                      <p className="font-[weight:var(--weight-medium)] text-[var(--fg)] text-[length:var(--text-sm)]">
                        {item.title}
                      </p>
                      <p className="mt-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--fg-2)]">
                        {item.summary}
                      </p>
                      <p className="mt-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--muted)]">
                        {new Date(item.createdAt).toLocaleString()}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AiAnalysisDashboard;