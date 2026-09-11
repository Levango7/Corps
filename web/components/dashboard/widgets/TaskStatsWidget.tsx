"use client";

/**
 * F3 Widget — TaskStatsWidget：任务统计卡片。
 *
 * 数据：GET /dashboard/widgets/task-stats →
 *   { todo, in_progress, review, done, total }
 *
 * 展示：4 个状态计数卡片（待办/进行中/评审/已完成）+ 总数。
 * 所有色值走 var(--token)，图标来自 lucide-react。
 */

import { Circle, CircleDot, CheckCircle2, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useWidgetData } from "./useWidgetData";
import { WidgetError, WidgetSkeleton } from "./WidgetStates";

interface TaskStatsData {
  todo: number;
  in_progress: number;
  review: number;
  done: number;
  total: number;
}

const STAT_ITEMS: {
  key: keyof Omit<TaskStatsData, "total">;
  labelKey: string;
  icon: typeof Circle;
  color: string;
}[] = [
  { key: "todo", labelKey: "todo", icon: Circle, color: "var(--status-todo)" },
  { key: "in_progress", labelKey: "in_progress", icon: CircleDot, color: "var(--status-doing)" },
  { key: "review", labelKey: "review", icon: ShieldCheck, color: "var(--status-warn-fg)" },
  { key: "done", labelKey: "done", icon: CheckCircle2, color: "var(--status-done)" },
];

export default function TaskStatsWidget({ wid }: { wid: string }) {
  const t = useTranslations("dashboard");
  const tStatus = useTranslations("status");
  const { data, loading, error, retry } = useWidgetData<TaskStatsData>(wid, "task-stats");

  if (loading) return <WidgetSkeleton lines={4} />;
  if (error || !data) return <WidgetError message={error} onRetry={retry} />;

  return (
    <div className="p-3">
      <div className="grid grid-cols-2 gap-2">
        {STAT_ITEMS.map((item) => {
          const Icon = item.icon;
          const value = data[item.key];
          return (
            <div
              key={item.key}
              className="flex items-center gap-2 px-2.5 py-2 rounded-[var(--radius-md)] bg-[var(--surface-2)]"
            >
              <Icon size={14} style={{ color: item.color }} className="shrink-0" />
              <span className="flex-1 min-w-0 text-[length:var(--text-xs)] text-[var(--fg-2)] truncate">
                {tStatus(item.labelKey)}
              </span>
              <span className="shrink-0 text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)] tabular-nums">
                {value}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between px-2.5 py-1.5 text-[length:var(--text-xs)] text-[var(--meta)]">
        <span>{t("totalTasks")}</span>
        <span className="tabular-nums font-[weight:var(--weight-medium)] text-[var(--fg-2)]">
          {data.total}
        </span>
      </div>
    </div>
  );
}