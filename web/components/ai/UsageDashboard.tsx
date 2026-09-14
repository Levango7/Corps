"use client";

/**
 * AI 使用统计仪表盘（方向 G）
 *
 * 功能：
 *  - 显示今日/本月调用次数、Token 消耗、成本
 *  - 按能力维度展示 Top 5 能力的使用量
 *  - 最近 10 条使用日志
 *  - 限额使用进度条（如果有限额）
 *
 * 数据来源：GET /api/v1/ai/usage/dashboard?workspaceId=...
 *
 * 样式：design token（var(--*)），lucide-react 图标 size 16
 * i18n：useTranslations("ai.usage")
 *
 * 来源：方向 G 任务 5（UsageDashboard.tsx）
 *       经验 2026-09-10-tailwind-v4-utility-class-to-design-token-migration
 *       （先读取 design-tokens.css 确认可用 token，不假设名称）
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Activity,
  Coins,
  Cpu,
  TrendingUp,
  Clock,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { api } from "@/lib/api";

interface UsageDashboardProps {
  /** 工作区 ID */
  wid: string;
}

/** 仪表盘数据（对应 GET /api/v1/ai/usage/dashboard 返回） */
interface DashboardData {
  today: { calls: number; tokens: number; cost: number };
  month: { calls: number; tokens: number; cost: number };
  topCapabilities: Array<{
    capability: string;
    calls: number;
    tokens: number;
    cost: number;
  }>;
  recentLogs: Array<{
    id: string;
    capability: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cost: number;
    durationMs: number;
    success: boolean;
    createdAt: string;
  }>;
  limit: {
    dailyTokenLimit: number | null;
    monthlyTokenLimit: number | null;
    dailyCallLimit: number | null;
    monthlyCallLimit: number | null;
  } | null;
}

/** 格式化 Token 数（1.2k / 3.4M） */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** 格式化成本（美元） */
function formatCost(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

/** 格式化耗时 */
function formatDuration(ms: number): string {
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${ms}ms`;
}

/** 格式化相对时间（i18n 参数化） */
function formatRelativeTime(
  iso: string,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return t("justNow");
  if (diff < 3_600_000) return t("minutesAgo", { n: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t("hoursAgo", { n: Math.floor(diff / 3_600_000) });
  return t("daysAgo", { n: Math.floor(diff / 86_400_000) });
}

export function UsageDashboard({ wid }: UsageDashboardProps) {
  const t = useTranslations("ai.usage");

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // AbortController：组件卸载时中止进行中的请求
  const abortRef = useRef<AbortController | null>(null);

  /** 加载仪表盘数据 */
  const loadDashboard = useCallback(async () => {
    // 中止之前未完成的请求
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setLoading(true);
    setError(null);
    try {
      const result = await api<DashboardData>(
        `/api/v1/ai/usage/dashboard?workspaceId=${wid}`,
        { signal: ac.signal },
      );
      if (ac.signal.aborted) return;
      setData(result);
    } catch (e) {
      if (ac.signal.aborted) return;
      if (e instanceof Error && e.name === "AbortError") return;
      // 不泄露 error.message，仅显示 i18n 文案
      setError(t("loadFailed"));
      if (process.env.NODE_ENV === "development") {
        console.error("[UsageDashboard] loadDashboard error:", e);
      }
    } finally {
      if (!ac.signal.aborted) {
        setLoading(false);
      }
    }
  }, [wid, t]);

  useEffect(() => {
    void loadDashboard();
    // 组件卸载时中止进行中的请求
    return () => abortRef.current?.abort();
  }, [loadDashboard]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--surface)]">
        <div className="text-[length:var(--text-sm)] text-[var(--muted)]">
          {t("dashboard")}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--surface)]">
        <div className="text-[length:var(--text-sm)] text-[var(--danger)]">
          {error}
        </div>
      </div>
    );
  }

  // 限额使用百分比（日 Token）
  const dailyTokenPercent =
    data.limit?.dailyTokenLimit && data.limit.dailyTokenLimit > 0
      ? Math.min(100, (data.today.tokens / data.limit.dailyTokenLimit) * 100)
      : null;

  return (
    <div
      className="flex h-full flex-col gap-[var(--space-4)] overflow-y-auto bg-[var(--surface)] px-[var(--space-5)] py-[var(--space-4)]"
      aria-label={t("dashboard")}
    >
      {/* 标题 */}
      <header className="flex items-center gap-[var(--space-2)]">
        <Activity size={16} className="text-[var(--accent)]" />
        <h1 className="text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
          {t("dashboard")}
        </h1>
      </header>

      {/* 今日 / 本月统计卡片 */}
      <section className="grid grid-cols-2 gap-[var(--space-3)]">
        {/* 今日 */}
        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] px-[var(--space-4)] py-[var(--space-3)]">
          <div className="mb-[var(--space-2)] flex items-center gap-[var(--space-2)]">
            <Clock size={16} className="text-[var(--accent)]" />
            <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]">
              {t("today")}
            </span>
          </div>
          <div className="flex flex-col gap-[var(--space-1)]">
            <StatRow label={t("calls")} value={String(data.today.calls)} />
            <StatRow
              label={t("tokens")}
              value={formatTokens(data.today.tokens)}
            />
            <StatRow
              label={t("cost")}
              value={formatCost(data.today.cost)}
            />
          </div>
        </div>

        {/* 本月 */}
        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] px-[var(--space-4)] py-[var(--space-3)]">
          <div className="mb-[var(--space-2)] flex items-center gap-[var(--space-2)]">
            <TrendingUp size={16} className="text-[var(--accent)]" />
            <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]">
              {t("thisMonth")}
            </span>
          </div>
          <div className="flex flex-col gap-[var(--space-1)]">
            <StatRow label={t("calls")} value={String(data.month.calls)} />
            <StatRow
              label={t("tokens")}
              value={formatTokens(data.month.tokens)}
            />
            <StatRow
              label={t("cost")}
              value={formatCost(data.month.cost)}
            />
          </div>
        </div>
      </section>

      {/* 限额进度条 */}
      {data.limit && dailyTokenPercent !== null && (
        <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] px-[var(--space-4)] py-[var(--space-3)]">
          <div className="mb-[var(--space-2)] flex items-center justify-between">
            <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]">
              {t("dailyTokenLimit")}
            </span>
            <span className="text-[length:var(--text-xs)] text-[var(--muted)]">
              {formatTokens(data.today.tokens)} /{" "}
              {formatTokens(data.limit.dailyTokenLimit!)}
            </span>
          </div>
          <div
            className="h-2 w-full overflow-hidden rounded-[var(--radius-pill)] bg-[var(--surface-3)]"
            role="progressbar"
            aria-valuenow={Math.round(dailyTokenPercent)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t("dailyTokenLimit")}
          >
            <div
              className="h-full rounded-[var(--radius-pill)] bg-[var(--accent)] transition-all duration-[var(--motion-base)]"
              style={{ width: `${dailyTokenPercent}%` }}
            />
          </div>
        </section>
      )}

      {/* Top 能力 */}
      {data.topCapabilities.length > 0 && (
        <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] px-[var(--space-4)] py-[var(--space-3)]">
          <div className="mb-[var(--space-3)] flex items-center gap-[var(--space-2)]">
            <Cpu size={16} className="text-[var(--accent)]" />
            <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]">
              {t("topCapabilities")}
            </span>
          </div>
          <div className="flex flex-col gap-[var(--space-2)]">
            {data.topCapabilities.map((cap) => (
              <div
                key={cap.capability}
                className="flex items-center justify-between text-[length:var(--text-sm)]"
              >
                <span className="text-[var(--fg)]">{cap.capability}</span>
                <div className="flex items-center gap-[var(--space-4)] text-[var(--muted)]">
                  <span>{cap.calls} {t("calls")}</span>
                  <span>{formatTokens(cap.tokens)}</span>
                  <span className="flex items-center gap-[var(--space-1)]">
                    <Coins size={16} className="text-[var(--muted)]" />
                    {formatCost(cap.cost)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 最近日志 */}
      {data.recentLogs.length > 0 && (
        <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] px-[var(--space-4)] py-[var(--space-3)]">
          <div className="mb-[var(--space-3)] flex items-center gap-[var(--space-2)]">
            <Activity size={16} className="text-[var(--accent)]" />
            <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]">
              {t("recentLogs")}
            </span>
          </div>
          <div className="flex flex-col gap-[var(--space-2)]">
            {data.recentLogs.map((log) => (
              <div
                key={log.id}
                className="flex items-center justify-between text-[length:var(--text-sm)]"
              >
                <div className="flex items-center gap-[var(--space-2)]">
                  {log.success ? (
                    <CheckCircle2
                      size={16}
                      className="text-[var(--success)]"
                      aria-label={t("success")}
                    />
                  ) : (
                    <XCircle
                      size={16}
                      className="text-[var(--danger)]"
                      aria-label={t("failed")}
                    />
                  )}
                  <span className="text-[var(--fg)]">{log.capability}</span>
                  <span className="text-[var(--muted)]">
                    {formatRelativeTime(log.createdAt, t)}
                  </span>
                </div>
                <div className="flex items-center gap-[var(--space-3)] text-[var(--muted)]">
                  <span>{formatTokens(log.totalTokens)}</span>
                  <span>{formatDuration(log.durationMs)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** 统计行：标签 + 值 */
function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-[length:var(--text-sm)]">
      <span className="text-[var(--muted)]">{label}</span>
      <span className="font-[weight:var(--weight-medium)] text-[var(--fg)]">
        {value}
      </span>
    </div>
  );
}