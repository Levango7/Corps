"use client";

/**
 * TimeReport — 工时报告
 *
 * 功能：
 *  - 日期范围选择（startDate / endDate）
 *  - 按用户/任务/日期分组（groupBy: user | task | day）
 *  - 总时长 / 计费时长 / 金额汇总表格
 *
 * 数据流：
 *  - GET /time-entries/report?startDate=&endDate=&groupBy=
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { BarChart3, Loader2, DollarSign, Clock, TrendingUp } from "lucide-react";
import { api } from "@/lib/api";
import { formatDuration } from "./TimeTracker";

interface ReportGroup {
  key: string;
  totalDuration: number;
  billableDuration: number;
  totalAmount: number;
}

interface ReportData {
  groups: ReportGroup[];
  summary: { totalDuration: number; billableDuration: number; totalAmount: number };
}

/** 本地日期 → ISO datetime（当天起始/结束） */
function dateToStartISO(date: string): string | undefined {
  if (!date) return undefined;
  return new Date(date + "T00:00:00").toISOString();
}
function dateToEndISO(date: string): string | undefined {
  if (!date) return undefined;
  return new Date(date + "T23:59:59").toISOString();
}

export function TimeReport({ wid, refreshKey }: { wid: string; refreshKey?: number }) {
  const t = useTranslations("timetrack");
  // 默认本月范围
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const [startDate, setStartDate] = useState(firstDay.toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(now.toISOString().slice(0, 10));
  const [groupBy, setGroupBy] = useState<"user" | "task" | "day">("user");
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams();
        const s = dateToStartISO(startDate);
        const e = dateToEndISO(endDate);
        if (s) params.set("startDate", s);
        if (e) params.set("endDate", e);
        params.set("groupBy", groupBy);
        const result = await api<ReportData>(
          `/api/v1/workspaces/${wid}/time-entries/report?${params.toString()}`,
        );
        if (!cancelled) setData(result);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t("loadFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wid, startDate, endDate, groupBy, refreshKey, t]);

  const fieldControl =
    "h-9 px-2.5 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]";

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
      <div className="px-4 py-3 border-b border-[var(--border-soft)]">
        <h2 className="flex items-center gap-2 text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
          <BarChart3 size={16} className="text-[var(--muted)]" />
          {t("report")}
        </h2>
      </div>

      {/* 筛选区 */}
      <div className="px-4 py-3 border-b border-[var(--border-soft)] flex flex-wrap items-end gap-3">
        <div>
          <label className="flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--meta)] mb-1.5">
            {t("startDate")}
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className={fieldControl}
          />
        </div>
        <div>
          <label className="flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--meta)] mb-1.5">
            {t("endDate")}
          </label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className={fieldControl}
          />
        </div>
        <div>
          <label className="flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--meta)] mb-1.5">
            {t("groupBy")}
          </label>
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as "user" | "task" | "day")}
            className={fieldControl}
          >
            <option value="user">{t("user")}</option>
            <option value="task">{t("task")}</option>
            <option value="day">{t("day")}</option>
          </select>
        </div>
      </div>

      {error && (
        <p className="px-4 py-2 text-[length:var(--text-sm)] text-[var(--danger)]">{error}</p>
      )}

      {loading ? (
        <div className="py-8 text-center text-[var(--muted)]">
          <Loader2 size={16} className="inline animate-spin mr-2" />
          <span className="text-[length:var(--text-sm)]">{t("loading")}</span>
        </div>
      ) : !data ? (
        <div className="py-8 text-center text-[var(--muted)]">
          <p className="text-[length:var(--text-sm)]">{t("noEntries")}</p>
        </div>
      ) : (
        <>
          {/* 汇总卡 */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-[var(--space-3)] px-4 py-4 border-b border-[var(--border-soft)]">
            <SummaryCard
              icon={Clock}
              label={t("totalDuration")}
              value={formatDuration(data.summary.totalDuration)}
            />
            <SummaryCard
              icon={TrendingUp}
              label={t("billableDuration")}
              value={formatDuration(data.summary.billableDuration)}
            />
            <SummaryCard
              icon={DollarSign}
              label={t("totalAmount")}
              value={data.summary.totalAmount.toFixed(2)}
            />
          </div>

          {/* 分组表格 */}
          {data.groups.length === 0 ? (
            <div className="py-8 text-center text-[var(--muted)]">
              <p className="text-[length:var(--text-sm)]">{t("noEntries")}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[length:var(--text-sm)]">
                <thead>
                  <tr className="border-b border-[var(--border-soft)] text-[var(--meta)]">
                    <th className="text-left font-[weight:var(--weight-medium)] px-4 py-2">
                      {t("groupBy")}
                    </th>
                    <th className="text-right font-[weight:var(--weight-medium)] px-4 py-2">
                      {t("totalDuration")}
                    </th>
                    <th className="text-right font-[weight:var(--weight-medium)] px-4 py-2">
                      {t("billableDuration")}
                    </th>
                    <th className="text-right font-[weight:var(--weight-medium)] px-4 py-2">
                      {t("totalAmount")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.groups.map((g) => (
                    <tr
                      key={g.key}
                      className="border-b border-[var(--border-soft)] last:border-0 hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
                    >
                      <td className="px-4 py-2.5 text-[var(--fg)]">{g.key}</td>
                      <td className="px-4 py-2.5 text-right text-[var(--fg-2)] tabular-nums">
                        {formatDuration(g.totalDuration)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-[var(--fg-2)] tabular-nums">
                        {formatDuration(g.billableDuration)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-[var(--fg-2)] tabular-nums">
                        {g.totalAmount.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-[var(--surface-2)] rounded-[var(--radius-sm)] p-3">
      <div className="flex items-center gap-2 mb-1">
        <Icon size={14} className="text-[var(--muted)]" />
        <span className="text-[length:var(--text-xs)] text-[var(--meta)]">{label}</span>
      </div>
      <div className="text-[length:var(--text-xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)] tabular-nums">
        {value}
      </div>
    </div>
  );
}
