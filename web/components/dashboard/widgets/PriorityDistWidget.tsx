"use client";

/**
 * F3 Widget — PriorityDistWidget：优先级分布饼图。
 *
 * 数据：GET /dashboard/widgets/priority-dist →
 *   { low, medium, high, urgent, total }
 *
 * 展示：SVG 饼图（4 色扇形）+ 图例。
 * 所有色值走 var(--token)。
 */

import { useTranslations } from "next-intl";
import { useWidgetData } from "./useWidgetData";
import { WidgetError, WidgetEmpty, WidgetSkeleton } from "./WidgetStates";
import type { Priority } from "@/lib/types";

interface PriorityDistData {
  low: number;
  medium: number;
  high: number;
  urgent: number;
  total: number;
}

const PRIO_META: { key: Priority; labelKey: string; color: string }[] = [
  { key: "urgent", labelKey: "urgent", color: "var(--danger)" },
  { key: "high", labelKey: "high", color: "var(--warn)" },
  { key: "medium", labelKey: "medium", color: "var(--accent)" },
  { key: "low", labelKey: "low", color: "var(--success)" },
];

export default function PriorityDistWidget({ wid }: { wid: string }) {
  const t = useTranslations("dashboard");
  const tPriority = useTranslations("priority");
  const { data, loading, error, retry } = useWidgetData<PriorityDistData>(wid, "priority-dist");

  if (loading) return <WidgetSkeleton lines={4} />;
  if (error || !data) return <WidgetError message={error} onRetry={retry} />;
  if (data.total === 0) return <WidgetEmpty text={t("priorityDistEmpty")} />;

  return (
    <div className="p-3 flex items-center gap-3">
      <PriorityPie data={data} />
      <ul className="flex-1 min-w-0 space-y-1">
        {PRIO_META.map((meta) => {
          const count = data[meta.key];
          const pct = data.total > 0 ? Math.round((count / data.total) * 100) : 0;
          return (
            <li key={meta.key} className="flex items-center gap-1.5">
              <span
                className="shrink-0 w-2 h-2 rounded-full"
                style={{ backgroundColor: meta.color }}
              />
              <span className="flex-1 min-w-0 text-[length:var(--text-xs)] text-[var(--fg-2)] truncate">
                {tPriority(meta.labelKey)}
              </span>
              <span className="shrink-0 text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--fg)] tabular-nums">
                {count}
              </span>
              <span className="shrink-0 w-8 text-right text-[length:var(--text-xs)] text-[var(--meta)] tabular-nums">
                {pct}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** 优先级饼图 SVG：4 色扇形 */
function PriorityPie({ data }: { data: PriorityDistData }) {
  const R = 36;
  const CX = 40;
  const CY = 40;
  const total = Math.max(1, data.total);

  // 计算各扇形角度（从 12 点方向顺时针）
  let accAngle = -Math.PI / 2;
  const arcs = PRIO_META.map((meta) => {
    const count = data[meta.key];
    const angle = (count / total) * Math.PI * 2;
    const startAngle = accAngle;
    const endAngle = accAngle + angle;
    accAngle = endAngle;
    return { meta, count, startAngle, endAngle };
  });

  return (
    <svg viewBox="0 0 80 80" className="w-20 h-20 shrink-0" role="img" aria-label="priority distribution">
      {arcs.map((arc) => {
        if (arc.count === 0) return null;
        // 整圆特殊处理（避免 path 闭合问题）
        if (arc.count === total) {
          return (
            <circle
              key={arc.meta.key}
              cx={CX}
              cy={CY}
              r={R}
              fill={arc.meta.color}
              stroke="var(--surface)"
              strokeWidth={2}
            />
          );
        }
        const x1 = CX + R * Math.cos(arc.startAngle);
        const y1 = CY + R * Math.sin(arc.startAngle);
        const x2 = CX + R * Math.cos(arc.endAngle);
        const y2 = CY + R * Math.sin(arc.endAngle);
        const largeArc = arc.endAngle - arc.startAngle > Math.PI ? 1 : 0;
        const d = `M ${CX} ${CY} L ${x1} ${y1} A ${R} ${R} 0 ${largeArc} 1 ${x2} ${y2} Z`;
        return (
          <path
            key={arc.meta.key}
            d={d}
            fill={arc.meta.color}
            stroke="var(--surface)"
            strokeWidth={2}
          />
        );
      })}
      {/* 中心圆（环形效果） */}
      <circle cx={CX} cy={CY} r={20} fill="var(--surface)" />
      <text
        x={CX}
        y={CY - 2}
        textAnchor="middle"
        className="fill-[var(--fg)]"
        style={{ fontSize: "11px", fontWeight: 600 }}
      >
        {data.total}
      </text>
      <text
        x={CX}
        y={CY + 10}
        textAnchor="middle"
        className="fill-[var(--meta)]"
        style={{ fontSize: "7px" }}
      >
        total
      </text>
    </svg>
  );
}