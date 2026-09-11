"use client";

/**
 * F3 Widget — DecisionActionsWidget：决策待执行行动项。
 *
 * 数据：GET /dashboard/widgets/decision-actions →
 *   { items: [{ id, title, checked, assigneeId, dueDate, priority, decisionId, taskId }] }
 *
 * 展示：待执行（checked=false）行动项列表，可点击跳转对应决策/任务。
 */

import { Link } from "@/lib/i18n-navigation";
import { Square, Flag } from "lucide-react";
import { useTranslations } from "next-intl";
import { useWidgetData } from "./useWidgetData";
import { WidgetError, WidgetEmpty, WidgetSkeleton } from "./WidgetStates";
import { dueMeta as sharedDueMeta } from "@/lib/format";
import type { Priority } from "@/lib/types";

interface DecisionActionItem {
  id: string;
  title: string;
  checked: boolean;
  assigneeId?: string | null;
  dueDate?: string | null;
  priority?: Priority;
  decisionId: string;
  taskId?: string | null;
}

interface DecisionActionsData {
  items: DecisionActionItem[];
}

const PRIO_COLOR: Record<Priority, string> = {
  low: "var(--meta)",
  medium: "var(--muted)",
  high: "var(--warn)",
  urgent: "var(--danger)",
};

export default function DecisionActionsWidget({ wid }: { wid: string }) {
  const t = useTranslations("dashboard");
  const tTime = useTranslations("time");
  const { data, loading, error, retry } = useWidgetData<DecisionActionsData>(
    wid,
    "decision-actions",
  );

  if (loading) return <WidgetSkeleton lines={4} />;
  if (error || !data) return <WidgetError message={error} onRetry={retry} />;
  if (data.items.length === 0) return <WidgetEmpty text={t("decisionActionsEmpty")} />;

  return (
    <ul className="divide-y divide-[var(--border-soft)]">
      {data.items.slice(0, 8).map((item) => {
        const due = sharedDueMeta(item.dueDate, tTime);
        const href = item.taskId
          ? `/w/${wid}/task/${item.taskId}`
          : `/w/${wid}/decisions`;
        return (
          <li key={item.id}>
            <Link
              href={href}
              className="flex items-center gap-2 px-3 py-2 hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
            >
              <Square size={13} className="shrink-0 text-[var(--muted)]" />
              <span className="flex-1 min-w-0 text-[length:var(--text-xs)] text-[var(--fg)] truncate">
                {item.title}
              </span>
              {item.priority && (item.priority === "high" || item.priority === "urgent") && (
                <Flag
                  size={11}
                  className="shrink-0"
                  style={{ color: PRIO_COLOR[item.priority] }}
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