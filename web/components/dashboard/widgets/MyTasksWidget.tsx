"use client";

/**
 * F3 Widget — MyTasksWidget：我的任务列表。
 *
 * 数据：GET /dashboard/widgets/my-tasks →
 *   { items: [{ id, title, status, priority, dueDate, blocked }] }
 *
 * 展示：最近 10 条分配给当前用户的任务，可点击跳转详情。
 */

import { Link } from "@/lib/i18n-navigation";
import { Flag } from "lucide-react";
import { useTranslations } from "next-intl";
import { useWidgetData } from "./useWidgetData";
import { WidgetError, WidgetEmpty, WidgetSkeleton } from "./WidgetStates";
import { STATUS_META, PRIORITY_COLORS } from "@/lib/task-meta";
import { dueMeta as sharedDueMeta } from "@/lib/format";
import type { Status, Priority } from "@/lib/types";

interface MyTaskItem {
  id: string;
  title: string;
  status: Status;
  priority: Priority;
  dueDate?: string | null;
  blocked?: boolean;
}

interface MyTasksData {
  items: MyTaskItem[];
}

export default function MyTasksWidget({ wid }: { wid: string }) {
  const t = useTranslations("dashboard");
  const tTime = useTranslations("time");
  const { data, loading, error, retry } = useWidgetData<MyTasksData>(wid, "my-tasks");

  if (loading) return <WidgetSkeleton lines={5} />;
  if (error || !data) return <WidgetError message={error} onRetry={retry} />;
  if (data.items.length === 0) return <WidgetEmpty text={t("myTasksEmpty")} />;

  return (
    <ul className="divide-y divide-[var(--border-soft)]">
      {data.items.map((task) => {
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
              <span
                className={`flex-1 min-w-0 text-[length:var(--text-xs)] truncate ${
                  task.status === "done"
                    ? "text-[var(--muted)] line-through decoration-[var(--border)]"
                    : "text-[var(--fg)]"
                }`}
              >
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
                  className="shrink-0 text-[length:var(--text-xs)] tabular-nums"
                  style={{ color: due.color }}
                >
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