"use client";

/**
 * 审批统计仪表盘组件。
 *
 * 功能：
 * - 拉取审批统计数据（GET /api/v1/workspaces/{wid}/approvals/stats）
 * - 顶部4个统计卡片：待我审批 / 已通过 / 已拒绝 / 平均处理时长
 * - 状态分布条形图：pending / approved / rejected / withdrawn 占比
 * - 优先级分布：normal / urgent / critical 数量
 * - 模板使用排行：按 count 降序展示
 * - 时间范围筛选：最近7天 / 最近30天 / 全部
 *
 * 状态颜色映射（design token，禁止裸 hex）：
 * - pending  → var(--warning) / var(--warning-fg)
 * - approved → var(--success) / var(--success-fg)
 * - rejected → var(--danger)  / var(--danger-fg)
 * - withdrawn→ var(--muted)
 *
 * 优先级颜色映射：
 * - normal   → var(--fg-2)
 * - urgent   → var(--warning)
 * - critical → var(--danger)
 */

import { useEffect, useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  Clock,
  CheckCircle2,
  XCircle,
  Timer,
  Loader2,
  AlertCircle,
  MinusCircle,
  FileText,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";

/** 审批统计数据结构（与后端 GET /stats 响应一致） */
interface ApprovalStatsData {
  total: number;
  byStatus: {
    pending: number;
    approved: number;
    rejected: number;
    withdrawn: number;
  };
  byPriority: {
    normal: number;
    urgent: number;
    critical: number;
  };
  byTemplate: Array<{
    templateId: string;
    templateName: string;
    count: number;
  }>;
  avgProcessingHours: number;
  pendingMine: number;
}

type TimeRange = "7d" | "30d" | "all";

interface ApprovalStatsDashboardProps {
  workspaceId: string;
}

/** 状态 → 颜色 token 映射 */
const STATUS_COLORS: Record<string, string> = {
  pending: "var(--warning)",
  approved: "var(--success)",
  rejected: "var(--danger)",
  withdrawn: "var(--muted)",
};

/** 状态 → i18n label key 映射 */
const STATUS_LABEL_KEYS: Record<string, string> = {
  pending: "statusPending",
  approved: "statusApproved",
  rejected: "statusRejected",
  withdrawn: "statusWithdrawn",
};

/** 优先级 → 颜色 token 映射 */
const PRIORITY_COLORS: Record<string, string> = {
  normal: "var(--fg-2)",
  urgent: "var(--warning)",
  critical: "var(--danger)",
};

/** 优先级 → i18n label key 映射 */
const PRIORITY_LABEL_KEYS: Record<string, string> = {
  normal: "priorityNormal",
  urgent: "priorityUrgent",
  critical: "priorityCritical",
};

export function ApprovalStatsDashboard({
  workspaceId,
}: ApprovalStatsDashboardProps) {
  const t = useTranslations("approval");
  const [data, setData] = useState<ApprovalStatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [timeRange, setTimeRange] = useState<TimeRange>("30d");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams();
        if (timeRange === "7d") {
          const start = new Date();
          start.setDate(start.getDate() - 7);
          params.set("startDate", start.toISOString());
        } else if (timeRange === "30d") {
          const start = new Date();
          start.setDate(start.getDate() - 30);
          params.set("startDate", start.toISOString());
        }
        // timeRange === "all" 不传日期参数，后端默认最近30天或全部

        const result = await api<ApprovalStatsData>(
          `/api/v1/workspaces/${workspaceId}/approvals/stats?${params.toString()}`,
        );
        if (cancelled) return;
        setData(result);
      } catch (e) {
        if (cancelled) return;
        setError(
          e instanceof ApiError || e instanceof Error
            ? e.message
            : t("statsLoadFailed"),
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, timeRange, t]);

  /** 状态分布百分比计算 */
  const statusDistribution = useMemo(() => {
    if (!data || data.total === 0) return [];
    const statuses = ["pending", "approved", "rejected", "withdrawn"];
    return statuses.map((key) => {
      const count = data.byStatus[key as keyof typeof data.byStatus];
      return {
        key,
        count,
        percent: Math.round((count / data.total) * 100),
      };
    });
  }, [data]);

  /** 模板使用排行（按 count 降序） */
  const sortedTemplates = useMemo(() => {
    if (!data) return [];
    return [...data.byTemplate].sort((a, b) => b.count - a.count);
  }, [data]);

  const timeRangeOptions: { value: TimeRange; labelKey: string }[] = [
    { value: "7d", labelKey: "last7Days" },
    { value: "30d", labelKey: "last30Days" },
    { value: "all", labelKey: "allTime" },
  ];

  return (
    <div className="max-w-[var(--container-max)] mx-auto px-[var(--space-4)] py-[var(--space-6)]">
      {/* 标题 + 时间范围筛选 */}
      <div className="flex items-center justify-between mb-[var(--space-5)] flex-wrap gap-3">
        <h2 className="text-[length:var(--text-xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)] tracking-[var(--tracking-tight)]">
          {t("statsDashboard")}
        </h2>
        <div
          role="tablist"
          aria-label={t("statsDashboard")}
          className="inline-flex items-center gap-1 p-1 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)]"
        >
          {timeRangeOptions.map((opt) => {
            const active = opt.value === timeRange;
            return (
              <button
                key={opt.value}
                role="tab"
                aria-selected={active}
                onClick={() => setTimeRange(opt.value)}
                className={`h-7 px-3 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] ${
                  active
                    ? "bg-[var(--surface)] text-[var(--fg)] shadow-[var(--elev-sm)]"
                    : "text-[var(--fg-2)] hover:text-[var(--fg)]"
                }`}
              >
                {t(opt.labelKey)}
              </button>
            );
          })}
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mb-[var(--space-4)] flex items-center gap-2 p-3 rounded-[var(--radius-md)] border border-[var(--danger)] bg-[var(--danger-soft,var(--surface-2))]">
          <AlertCircle size={16} className="shrink-0 text-[var(--danger)]" />
          <span className="text-[length:var(--text-sm)] text-[var(--danger)]">
            {error}
          </span>
        </div>
      )}

      {/* 加载态 */}
      {loading ? (
        <div className="py-[var(--space-12)] text-center text-[var(--muted)]">
          <Loader2 size={20} className="inline animate-spin mr-2" />
          {t("loading")}
        </div>
      ) : !data ? (
        <div className="py-[var(--space-12)] text-center text-[var(--muted)]">
          <AlertCircle size={36} className="mx-auto mb-3 opacity-50" />
          <p>{t("statsLoadFailed")}</p>
        </div>
      ) : (
        <>
          {/* 顶部统计卡片行 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[var(--space-3)] mb-[var(--space-6)]">
            {/* 待我审批 */}
            <StatCard
              icon={<Clock size={16} />}
              color="var(--warning)"
              label={t("pendingMine")}
              value={String(data.pendingMine)}
            />
            {/* 已通过 */}
            <StatCard
              icon={<CheckCircle2 size={16} />}
              color="var(--success)"
              label={t("statusApproved")}
              value={String(data.byStatus.approved)}
            />
            {/* 已拒绝 */}
            <StatCard
              icon={<XCircle size={16} />}
              color="var(--danger)"
              label={t("statusRejected")}
              value={String(data.byStatus.rejected)}
            />
            {/* 平均处理时长 */}
            <StatCard
              icon={<Timer size={16} />}
              color="var(--accent)"
              label={t("avgProcessingTime")}
              value={`${data.avgProcessingHours.toFixed(1)}${t("hours")}`}
            />
          </div>

          {/* 状态分布 + 优先级分布（两列布局） */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-[var(--space-4)] mb-[var(--space-4)]">
            {/* 状态分布 */}
            <section className="p-[var(--space-4)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
              <h3 className="text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)] mb-[var(--space-3)]">
                {t("statusDistribution")}
              </h3>
              {data.total === 0 ? (
                <p className="text-[length:var(--text-xs)] text-[var(--muted)] py-[var(--space-3)]">
                  {t("noApprovals")}
                </p>
              ) : (
                <div className="space-y-[var(--space-2)]">
                  {/* 条形图 */}
                  <div className="flex h-2 rounded-[var(--radius-sm)] overflow-hidden bg-[var(--surface-2)]">
                    {statusDistribution.map((item) => {
                      if (item.count === 0) return null;
                      return (
                        <div
                          key={item.key}
                          className="h-full transition-all duration-[var(--motion-normal)]"
                          style={{
                            width: `${item.percent}%`,
                            backgroundColor: STATUS_COLORS[item.key],
                          }}
                          title={`${t(STATUS_LABEL_KEYS[item.key])}: ${item.count} (${item.percent}%)`}
                        />
                      );
                    })}
                  </div>
                  {/* 图例 + 数值 */}
                  <div className="grid grid-cols-2 gap-[var(--space-2)] mt-[var(--space-3)]">
                    {statusDistribution.map((item) => (
                      <div
                        key={item.key}
                        className="flex items-center gap-2 text-[length:var(--text-xs)]"
                      >
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-[var(--radius-xs)] shrink-0"
                          style={{
                            backgroundColor: STATUS_COLORS[item.key],
                          }}
                        />
                        <span className="text-[var(--fg-2)] flex-1 truncate">
                          {t(STATUS_LABEL_KEYS[item.key])}
                        </span>
                        <span className="font-[weight:var(--weight-medium)] text-[var(--fg)]">
                          {item.count}
                        </span>
                        <span className="text-[var(--muted)]">
                          {item.percent}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>

            {/* 优先级分布 */}
            <section className="p-[var(--space-4)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
              <h3 className="text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)] mb-[var(--space-3)]">
                {t("priorityDistribution")}
              </h3>
              {data.byPriority.normal === 0 &&
              data.byPriority.urgent === 0 &&
              data.byPriority.critical === 0 ? (
                <p className="text-[length:var(--text-xs)] text-[var(--muted)] py-[var(--space-3)]">
                  {t("noApprovals")}
                </p>
              ) : (
                <div className="space-y-[var(--space-3)]">
                  {(["critical", "urgent", "normal"] as const).map((key) => {
                    const count = data.byPriority[key];
                    const maxCount = Math.max(
                      data.byPriority.normal,
                      data.byPriority.urgent,
                      data.byPriority.critical,
                      1,
                    );
                    const barWidth = Math.round((count / maxCount) * 100);
                    return (
                      <div key={key} className="flex items-center gap-2">
                        <span
                          className="text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] w-16 shrink-0"
                          style={{ color: PRIORITY_COLORS[key] }}
                        >
                          {t(PRIORITY_LABEL_KEYS[key])}
                        </span>
                        <div className="flex-1 h-5 rounded-[var(--radius-sm)] bg-[var(--surface-2)] overflow-hidden">
                          <div
                            className="h-full rounded-[var(--radius-sm)] transition-all duration-[var(--motion-normal)] flex items-center justify-end pr-2"
                            style={{
                              width: `${barWidth}%`,
                              backgroundColor: PRIORITY_COLORS[key],
                              minWidth: count > 0 ? "1.5rem" : "0",
                            }}
                          >
                            {count > 0 && (
                              <span className="text-[length:var(--text-xs)] font-[weight:var(--weight-semibold)] text-[var(--surface)]">
                                {count}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          {/* 模板使用排行 */}
          <section className="p-[var(--space-4)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
            <h3 className="text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)] mb-[var(--space-3)]">
              {t("templateUsage")}
            </h3>
            {sortedTemplates.length === 0 ? (
              <div className="py-[var(--space-4)] text-center">
                <FileText size={28} className="mx-auto mb-2 opacity-40 text-[var(--muted)]" />
                <p className="text-[length:var(--text-xs)] text-[var(--muted)]">
                  {t("noTemplateUsage")}
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-[var(--border-soft)]">
                {sortedTemplates.map((template, index) => {
                  const maxCount = sortedTemplates[0]?.count || 1;
                  const barWidth = Math.round(
                    (template.count / maxCount) * 100,
                  );
                  return (
                    <li
                      key={template.templateId}
                      className="flex items-center gap-3 py-2"
                    >
                      <span className="text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--muted)] w-5 shrink-0 text-right">
                        {index + 1}
                      </span>
                      <span className="text-[length:var(--text-sm)] text-[var(--fg)] flex-1 min-w-0 truncate">
                        {template.templateName}
                      </span>
                      <div className="w-24 h-1.5 rounded-[var(--radius-xs)] bg-[var(--surface-2)] overflow-hidden shrink-0">
                        <div
                          className="h-full rounded-[var(--radius-xs)] transition-all duration-[var(--motion-normal)]"
                          style={{
                            width: `${barWidth}%`,
                            backgroundColor: "var(--accent)",
                          }}
                        />
                      </div>
                      <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)] w-8 shrink-0 text-right">
                        {template.count}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/** 统计卡片子组件 */
function StatCard({
  icon,
  color,
  label,
  value,
}: {
  icon: React.ReactNode;
  color: string;
  label: string;
  value: string;
}) {
  return (
    <div className="p-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] transition-colors duration-[var(--motion-fast)] hover:border-[var(--border-strong)]">
      <div className="flex items-center gap-2 mb-[var(--space-1)]">
        <span style={{ color }}>{icon}</span>
        <span className="text-[length:var(--text-xs)] text-[var(--fg-2)] truncate">
          {label}
        </span>
      </div>
      <p
        className="text-[length:var(--text-2xl)] font-[weight:var(--weight-bold)] tracking-[var(--tracking-tight)]"
        style={{ color }}
      >
        {value}
      </p>
    </div>
  );
}