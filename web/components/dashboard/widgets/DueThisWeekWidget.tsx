"use client";

/**
 * F3 Widget — DueThisWeekWidget：本周截止任务列表。
 *
 * 数据：GET /dashboard/widgets/due-this-week →
 *   { items: [{ id, title, status, priority, assigneeId, dueDate }], weekStart, weekEnd }
 *
 * 展示：本周内截止且未完成的任务，按截止日期升序。
 */

import { Link } from "@/lib/i18n-navigation";
import { CalendarClock, Flag } from "lucide-react";
import { useTranslations } from "next-intl";
import { useWidgetData } from "./useWidgetData";
import { WidgetError, WidgetEmpty, WidgetSkeleton } from "./WidgetStates";
import { STATUS_META, PRIORITY_COLORS } from "@/lib/task-meta";
import { dueMeta as sharedDueMeta } from "@/lib/format";
import type { Status, Priority } from "@/lib/types";

interface DueTaskItem {
  id: string;
  title: string;
  status: Status;
  priority: Priority;
  assigneeId?: string | null;
  dueDate: string | null;
}

interface DueThisWeekData {
  items: DueTaskItem[];
  weekStart: string;
  weekEnd: string;
}

export default function DueThisWeekWidget({ wid }: { wid: string }) {
  const t = useTranslations("dashboard");
  const tTime = useTranslations("time");
  const { data, loading, error, retry } = useWidgetData<DueThisWeekData>(wid, "due-this-week");

  if (loading) return <WidgetSkeleton lines={4} />;
  if (error || !data) return <WidgetError message={error} onRetry={retry} />;
  if (data.items.length === 0) return <WidgetEmpty text={t("dueThisWeekEmpty")} />;

  return (
    <ul className="divide-y divide-[var(--border-soft)]">
      {data.items.slice(0, 8).map((task) => {
        const StatusIcon = STATUS_META[task.status].icon;
        const due = sharedDueMeta(task.dueDate, tTime);
        return (
          <li key={task.id}>
            <Link
              href={`/w/${wid}/task/${task.id}`}
              className="flex items-center gap-2 px-3 py-2 hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
            >
              <StatusIcon
                size={13}
                className="shrink-0"
                style={{ color: STATUS_META[task.status].color }}
              />
              <span className="flex-1 min-w-0 text-[length:var(--text-xs)] text-[var(--fg)] truncate">
                {task.title}
              </span>
              {(task.priority === "high" || task.priority === "urgent") && (
                <Flag
                  size={11}
                  className="shrink-0"
                  style={{ color: PRIORITY_COLORS[task.priority] }}
                />
              )}
              {due && (
                <span
                  className="shrink-0 inline-flex items-center gap-0.5 text-[length:var(--text-xs)] tabular-nums"
                  style={{ color: due.color }}
                >
                  <CalendarClock size={11} className="shrink-0" />
                  {due.text}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}