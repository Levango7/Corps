"use client";

/**
 * F3 Widget — CustomChartWidget：自定义图表。
 *
 * 数据：GET /dashboard/widgets/custom-chart →
 *   { chartType, dataSource, labels: string[], values: number[], total }
 *
 * 展示：根据 chartType 渲染柱状图/折线图/饼图（纯 SVG）。
 *   - 默认返回任务状态分布（dataSource=taskStatus）
 *   - 支持通过 WidgetConfigPanel 配置 chartType（bar/line/pie）与 dataSource
 *   - 复用 PriorityDistWidget 的饼图绘制思路（SVG 扇形）
 *
 * 经验来源：2026-09-10-react-icon-size-prop-hardcoded-audit
 *   — 色值走 design token，不硬编码；图表用内联 SVG，不引第三方库。
 */

import { useId } from "react";
import { useTranslations } from "next-intl";
import { useWidgetData } from "./useWidgetData";
import { WidgetError, WidgetEmpty, WidgetSkeleton } from "./WidgetStates";

interface CustomChartData {
  chartType: "bar" | "line" | "pie";
  dataSource: string;
  labels: string[];
  values: number[];
  total: number;
}

/** 调色板：按索引取色，循环使用（全部走 design token） */
const PALETTE = [
  "var(--accent)",
  "var(--success)",
  "var(--warn)",
  "var(--danger)",
  "var(--status-doing)",
  "var(--meta)",
];

export default function CustomChartWidget({ wid }: { wid: string }) {
  const t = useTranslations("dashboard");
  const { data, loading, error, retry } = useWidgetData<CustomChartData>(wid, "custom-chart");

  if (loading) return <WidgetSkeleton lines={4} />;
  if (error || !data) return <WidgetError message={error} onRetry={retry} />;
  if (data.total === 0 || data.values.length === 0) {
    return <WidgetEmpty text={t("customChartEmpty")} />;
  }

  return (
    <div className="p-3">
      <CustomChart data={data} ariaLabel={t("customChart")} />
    </div>
  );
}

/** 根据 chartType 分发到对应 SVG 图表 */
function CustomChart({ data, ariaLabel }: { data: CustomChartData; ariaLabel: string }) {
  const { chartType, labels, values, total } = data;
  if (chartType === "pie") return <PieChart labels={labels} values={values} total={total} ariaLabel={ariaLabel} />;
  if (chartType === "line") return <LineChart labels={labels} values={values} ariaLabel={ariaLabel} />;
  return <BarChart labels={labels} values={values} ariaLabel={ariaLabel} />;
}

/** 柱状图 */
function BarChart({
  labels,
  values,
  ariaLabel,
}: {
  labels: string[];
  values: number[];
  ariaLabel: string;
}) {
  const W = 240;
  const H = 120;
  const PAD = 16;
  const innerW = W - PAD * 2;
  const innerH = H - PAD * 2 - 12; // 底部留标签空间
  const maxV = Math.max(1, ...values);
  const barW = values.length > 0 ? innerW / values.length : 0;
  const gap = barW * 0.2;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={ariaLabel}>
      {values.map((v, i) => {
        const h = (v / maxV) * innerH;
        const x = PAD + i * barW + gap / 2;
        const y = PAD + innerH - h;
        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={barW - gap}
              height={h}
              rx={2}
              fill={PALETTE[i % PALETTE.length]}
              opacity={0.85}
            >
              <title>{`${labels[i]}: ${v}`}</title>
            </rect>
            <text
              x={x + (barW - gap) / 2}
              y={H - 2}
              textAnchor="middle"
              className="fill-[var(--meta)]"
              style={{ fontSize: "8px" }}
            >
              {labels[i].length > 6 ? `${labels[i].slice(0, 5)}…` : labels[i]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** 折线图 */
function LineChart({
  labels,
  values,
  ariaLabel,
}: {
  labels: string[];
  values: number[];
  ariaLabel: string;
}) {
  const gradId = `custom-line-${useId().replace(/[:]/g, "")}`;
  const W = 240;
  const H = 120;
  const PAD = 16;
  const innerW = W - PAD * 2;
  const innerH = H - PAD * 2 - 12;
  const maxV = Math.max(1, ...values);
  const stepX = values.length > 1 ? innerW / (values.length - 1) : 0;

  const points = values.map((v, i) => ({
    x: PAD + i * stepX,
    y: PAD + innerH - (v / maxV) * innerH,
  }));
  const pathD = points
    .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
    .join(" ");
  const areaD =
    points.length > 0
      ? `${pathD} L ${points[points.length - 1].x} ${PAD + innerH} L ${points[0].x} ${PAD + innerH} Z`
      : "";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={ariaLabel}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.4} />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
        </linearGradient>
      </defs>
      {areaD && <path d={areaD} fill={`url(#${gradId})`} />}
      <path d={pathD} fill="none" stroke="var(--accent)" strokeWidth={2} />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={2} fill="var(--accent)">
          <title>{`${labels[i]}: ${values[i]}`}</title>
        </circle>
      ))}
      {points.map((p, i) => (
        <text
          key={`l-${i}`}
          x={p.x}
          y={H - 2}
          textAnchor="middle"
          className="fill-[var(--meta)]"
          style={{ fontSize: "8px" }}
        >
          {labels[i].length > 6 ? `${labels[i].slice(0, 5)}…` : labels[i]}
        </text>
      ))}
    </svg>
  );
}

/** 饼图（复用 PriorityDistWidget 扇形绘制思路） */
function PieChart({
  labels,
  values,
  total,
  ariaLabel,
}: {
  labels: string[];
  values: number[];
  total: number;
  ariaLabel: string;
}) {
  const CX = 40;
  const CY = 40;
  const R = 32;
  const sum = Math.max(1, total);

  let acc = -Math.PI / 2;
  const arcs = values.map((v, i) => {
    const angle = (v / sum) * Math.PI * 2;
    const start = acc;
    const end = acc + angle;
    acc = end;
    return { i, v, start, end };
  });

  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 80 80" className="w-20 h-20 shrink-0" role="img" aria-label={ariaLabel}>
        {arcs.map((arc) => {
          if (arc.v === 0) return null;
          if (arc.v === sum) {
            return (
              <circle
                key={arc.i}
                cx={CX}
                cy={CY}
                r={R}
                fill={PALETTE[arc.i % PALETTE.length]}
                stroke="var(--surface)"
                strokeWidth={1.5}
              />
            );
          }
          const x1 = CX + R * Math.cos(arc.start);
          const y1 = CY + R * Math.sin(arc.start);
          const x2 = CX + R * Math.cos(arc.end);
          const y2 = CY + R * Math.sin(arc.end);
          const largeArc = arc.end - arc.start > Math.PI ? 1 : 0;
          const d = `M ${CX} ${CY} L ${x1} ${y1} A ${R} ${R} 0 ${largeArc} 1 ${x2} ${y2} Z`;
          return (
            <path
              key={arc.i}
              d={d}
              fill={PALETTE[arc.i % PALETTE.length]}
              stroke="var(--surface)"
              strokeWidth={1.5}
            />
          );
        })}
        <circle cx={CX} cy={CY} r={14} fill="var(--surface)" />
        <text
          x={CX}
          y={CY + 3}
          textAnchor="middle"
          className="fill-[var(--fg)]"
          style={{ fontSize: "10px", fontWeight: "var(--weight-semibold)" }}
        >
          {total}
        </text>
      </svg>
      <ul className="flex-1 min-w-0 space-y-1">
        {labels.map((label, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <span
              className="shrink-0 w-2 h-2 rounded-full"
              style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
            />
            <span className="flex-1 min-w-0 text-[length:var(--text-xs)] text-[var(--fg-2)] truncate">
              {label}
            </span>
            <span className="shrink-0 text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--fg)] tabular-nums">
              {values[i]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}