"use client";

/**
 * F3 Widget — BurndownWidget：任务燃尽图。
 *
 * 数据：GET /dashboard/widgets/burndown →
 *   { days: [{ date, total, done, remaining }], totalTasks }
 *
 * 展示：SVG 折线图 + 渐变面积填充，最近 14 天每日剩余任务数。
 * 所有色值走 var(--token)，不引第三方图表库。
 */

import { useId } from "react";
import { useTranslations } from "next-intl";
import { useWidgetData } from "./useWidgetData";
import { WidgetError, WidgetEmpty, WidgetSkeleton } from "./WidgetStates";

interface BurndownDay {
  date: string;
  total: number;
  done: number;
  remaining: number;
}

interface BurndownData {
  days: BurndownDay[];
  totalTasks: number;
}

export default function BurndownWidget({ wid }: { wid: string }) {
  const t = useTranslations("dashboard");
  const { data, loading, error, retry } = useWidgetData<BurndownData>(wid, "burndown");

  if (loading) return <WidgetSkeleton lines={6} />;
  if (error || !data) return <WidgetError message={error} onRetry={retry} />;
  if (data.days.length === 0) return <WidgetEmpty text={t("burndownEmpty")} />;

  return <BurndownChart days={data.days} ariaLabel={t("burndown")} />;
}

/** 燃尽图 SVG：理想线（虚线）+ 实际折线（实线）+ 渐变面积填充 + 网格线 + X 轴标签 */
function BurndownChart({ days, ariaLabel }: { days: BurndownDay[]; ariaLabel: string }) {
  // 唯一渐变 id，避免多实例冲突
  const gradId = `burndown-area-${useId().replace(/[:]/g, "")}`;
  const W = 320;
  const H = 140;
  const PAD = 20;
  const innerW = W - PAD * 2;
  const innerH = H - PAD * 2;

  const maxRemaining = Math.max(1, ...days.map((d) => d.remaining));
  const stepX = days.length > 1 ? innerW / (days.length - 1) : 0;

  const points = days.map((d, i) => ({
    x: PAD + i * stepX,
    y: PAD + innerH - (d.remaining / maxRemaining) * innerH,
  }));

  const pathD = points
    .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
    .join(" ");
  const areaD = `${pathD} L ${points[points.length - 1].x} ${PAD + innerH} L ${points[0].x} ${PAD + innerH} Z`;

  // 理想线：从首个数据点的剩余量线性递减到 0（项目按理想进度燃尽至完成）
  const idealStart = points[0];
  const idealEnd = { x: W - PAD, y: PAD + innerH };

  // X 轴标签：首/中/末
  const labelIdx = [0, Math.floor(days.length / 2), days.length - 1].filter(
    (i, j, arr) => arr.indexOf(i) === j && i < days.length,
  );

  return (
    <div className="p-3">
      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto"
          role="img"
          aria-label={ariaLabel}
        >
          <defs>
            {/* 面积渐变：accent 半透明 → 完全透明 */}
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.5} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          {/* 网格线 */}
          {[0, 0.5, 1].map((ratio) => (
            <line
              key={ratio}
              x1={PAD}
              x2={W - PAD}
              y1={PAD + innerH * ratio}
              y2={PAD + innerH * ratio}
              stroke="var(--border)"
              strokeWidth={0.5}
            />
          ))}
          {/* 面积填充（渐变） */}
          <path d={areaD} fill={`url(#${gradId})`} />
          {/* 理想线（虚线） */}
          <line
            x1={idealStart.x}
            y1={idealStart.y}
            x2={idealEnd.x}
            y2={idealEnd.y}
            stroke="var(--meta)"
            strokeWidth={1}
            strokeDasharray="4 4"
          />
          {/* 实际折线（实线） */}
          <path d={pathD} fill="none" stroke="var(--accent)" strokeWidth={2} />
          {/* 数据点 */}
          {points.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={2} fill="var(--accent)" />
          ))}
          {/* X 轴标签 */}
          {labelIdx.map((i) => (
            <text
              key={i}
              x={PAD + i * stepX}
              y={H - 4}
              textAnchor="middle"
              className="fill-[var(--meta)]"
              style={{ fontSize: "10px" }}
            >
              {days[i].date.slice(5)}
            </text>
          ))}
          {/* Y 轴最大值标签 */}
          <text
            x={2}
            y={PAD + 4}
            textAnchor="start"
            className="fill-[var(--meta)]"
            style={{ fontSize: "10px" }}
          >
            {maxRemaining}
          </text>
        </svg>
      </div>
    </div>
  );
}