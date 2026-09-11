"use client";

/**
 * F3 Widget — MilestoneTimelineWidget：里程碑时间线。
 *
 * 数据：GET /dashboard/widgets/milestone-timeline →
 *   { items: [{ id, name, dueDate, status, taskCount }] }
 *
 * 展示：垂直时间线 + 里程碑节点 + 状态色（已完成/进行中/待开始）。
 *   - 每个里程碑显示名称、日期、关联任务数
 *   - 节点图标用 SVG 绘制（圆点/同心圆/空心圆对应三种状态）
 *   - 所有色值走 var(--token)
 *
 * 经验来源：2026-09-11-generic-empty-state-component-svg-illustration-migration
 *   — SVG 内联绘制，不引第三方图标库，色值走 design token。
 */

import { useTranslations } from "next-intl";
import { useWidgetData } from "./useWidgetData";
import { WidgetError, WidgetEmpty, WidgetSkeleton } from "./WidgetStates";

interface MilestoneItem {
  id: string;
  name: string;
  dueDate: string | null;
  status: "done" | "in_progress" | "pending";
  taskCount: number;
}

interface MilestoneData {
  items: MilestoneItem[];
}

/** 状态 → 节点色 token + i18n key */
const STATUS_META: Record<
  MilestoneItem["status"],
  { color: string; labelKey: string }
> = {
  done: { color: "var(--status-done)", labelKey: "milestoneDone" },
  in_progress: { color: "var(--status-doing)", labelKey: "milestoneInProgress" },
  pending: { color: "var(--meta)", labelKey: "milestonePending" },
};

/** 日期格式化：YYYY-MM-DD */
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

export default function MilestoneTimelineWidget({ wid }: { wid: string }) {
  const t = useTranslations("dashboard");
  const { data, loading, error, retry } = useWidgetData<MilestoneData>(
    wid,
    "milestone-timeline",
  );

  if (loading) return <WidgetSkeleton lines={4} />;
  if (error || !data) return <WidgetError message={error} onRetry={retry} />;
  if (data.items.length === 0) return <WidgetEmpty text={t("milestoneEmpty")} />;

  return (
    <div className="p-3 max-h-[280px] overflow-y-auto">
      <ol className="relative space-y-3">
        {/* 垂直时间线主干 */}
        <span
          className="absolute left-[7px] top-1 bottom-1 w-px bg-[var(--border)]"
          aria-hidden="true"
        />
        {data.items.map((it) => {
          const meta = STATUS_META[it.status];
          return (
            <li key={it.id} className="relative flex items-start gap-3 pl-0">
              {/* 节点 */}
              <span
                className="relative z-10 shrink-0 mt-0.5 flex items-center justify-center w-[15px] h-[15px] rounded-full bg-[var(--surface)] border-2"
                style={{ borderColor: meta.color }}
                aria-label={t(meta.labelKey)}
              >
                {it.status === "in_progress" && (
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: meta.color }}
                  />
                )}
                {it.status === "done" && (
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: meta.color }}
                  />
                )}
              </span>
              {/* 内容 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--fg)] truncate">
                    {it.name}
                  </span>
                  <span
                    className="shrink-0 text-[length:var(--text-xs)] text-[var(--meta)] tabular-nums"
                  >
                    {fmtDate(it.dueDate)}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[length:var(--text-xs)] text-[var(--meta)]">
                  <span style={{ color: meta.color }}>{t(meta.labelKey)}</span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">{t("milestoneTaskCount", { count: it.taskCount })}</span>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}