"use client";

/**
 * 燃尽图 SVG 组件——原生 SVG 绘制理想线 vs 实际线。
 *
 * 功能：
 *  - X 轴：日期（YYYY-MM-DD）
 *  - Y 轴：剩余任务数
 *  - 理想线：虚线（var(--border)）
 *  - 实际线：实线（var(--accent)）
 *  - 预测完成日期标注
 *  - 响应式：基于 viewBox 缩放
 *
 * Design token 颜色：无裸 hex，全部走 var(--*)。
 * 不引入外部图表库，纯 SVG 实现。
 */

import { useTranslations } from "next-intl";
import { useMemo } from "react";

export interface BurndownPoint {
  date: string;
  remaining: number;
}

interface BurndownChartProps {
  /** 理想燃尽线数据点 */
  idealLine: BurndownPoint[];
  /** 实际燃尽线数据点 */
  actualLine: BurndownPoint[];
  /** 预测完成日期（YYYY-MM-DD） */
  predictedCompletion?: string;
}

/** SVG 视口尺寸 */
const VIEW_WIDTH = 800;
const VIEW_HEIGHT = 400;
/** 内边距 */
const PADDING = { top: 30, right: 30, bottom: 50, left: 50 };

/** 将日期字符串转为简短标签（MM-DD） */
function shortDate(dateStr: string): string {
  const parts = dateStr.split("-");
  if (parts.length < 3) return dateStr;
  return `${parts[1]}-${parts[2]}`;
}

export function BurndownChart({ idealLine, actualLine, predictedCompletion }: BurndownChartProps) {
  const t = useTranslations("ai.aiAnalysis");

  /** 计算坐标系（合并所有数据点取并集） */
  const { allDates, maxY, xScale, yScale } = useMemo(() => {
    const dateSet = new Set<string>();
    idealLine.forEach((p) => dateSet.add(p.date));
    actualLine.forEach((p) => dateSet.add(p.date));
    const allDates = Array.from(dateSet).sort();
    const maxY = Math.max(
      1,
      ...idealLine.map((p) => p.remaining),
      ...actualLine.map((p) => p.remaining),
    );
    const plotWidth = VIEW_WIDTH - PADDING.left - PADDING.right;
    const plotHeight = VIEW_HEIGHT - PADDING.top - PADDING.bottom;
    const xScale = (idx: number) =>
      allDates.length <= 1
        ? PADDING.left + plotWidth / 2
        : PADDING.left + (idx / (allDates.length - 1)) * plotWidth;
    const yScale = (val: number) => PADDING.top + plotHeight - (val / maxY) * plotHeight;
    return { allDates, maxY, xScale, yScale };
  }, [idealLine, actualLine]);

  /** 生成 SVG path d 属性 */
  const toPath = (line: BurndownPoint[]): string => {
    if (line.length === 0) return "";
    return line
      .map((p, i) => {
        const idx = allDates.indexOf(p.date);
        if (idx < 0) return "";
        const x = xScale(idx);
        const y = yScale(p.remaining);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .filter(Boolean)
      .join(" ");
  };

  const idealPath = toPath(idealLine);
  const actualPath = toPath(actualLine);

  /** Y 轴刻度（5 等分） */
  const yTicks = Array.from({ length: 6 }, (_, i) => Math.round((maxY * i) / 5));

  /** 空数据态 */
  if (idealLine.length === 0 && actualLine.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] py-[var(--space-8)] text-[length:var(--text-sm)] text-[var(--muted)]"
        role="img"
        aria-label={t("burndown")}
      >
        {t("noReports")}
      </div>
    );
  }

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        className="w-full"
        style={{ minWidth: 480 }}
        role="img"
        aria-label={t("burndown")}
      >
        {/* 背景 */}
        <rect
          x={PADDING.left}
          y={PADDING.top}
          width={VIEW_WIDTH - PADDING.left - PADDING.right}
          height={VIEW_HEIGHT - PADDING.top - PADDING.bottom}
          fill="var(--surface-2)"
          stroke="var(--border)"
          strokeWidth={1}
        />

        {/* Y 轴刻度 + 网格线 */}
        {yTicks.map((tick) => {
          const y = yScale(tick);
          return (
            <g key={`y-${tick}`}>
              <line
                x1={PADDING.left}
                y1={y}
                x2={VIEW_WIDTH - PADDING.right}
                y2={y}
                stroke="var(--border-soft)"
                strokeWidth={1}
                strokeDasharray="2,3"
              />
              <text
                x={PADDING.left - 8}
                y={y + 4}
                textAnchor="end"
                fontSize={11}
                fill="var(--muted)"
              >
                {tick}
              </text>
            </g>
          );
        })}

        {/* X 轴刻度 */}
        {allDates.map((date, idx) => {
          // 数据点过多时稀疏显示标签（最多 8 个）
          const step = Math.max(1, Math.ceil(allDates.length / 8));
          if (idx % step !== 0 && idx !== allDates.length - 1) return null;
          const x = xScale(idx);
          return (
            <g key={`x-${date}`}>
              <line
                x1={x}
                y1={VIEW_HEIGHT - PADDING.bottom}
                x2={x}
                y2={VIEW_HEIGHT - PADDING.bottom + 4}
                stroke="var(--border)"
                strokeWidth={1}
              />
              <text
                x={x}
                y={VIEW_HEIGHT - PADDING.bottom + 18}
                textAnchor="middle"
                fontSize={11}
                fill="var(--muted)"
              >
                {shortDate(date)}
              </text>
            </g>
          );
        })}

        {/* 理想线（虚线） */}
        {idealPath && (
          <path
            d={idealPath}
            fill="none"
            stroke="var(--border)"
            strokeWidth={2}
            strokeDasharray="6,4"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {/* 实际线（实线） */}
        {actualPath && (
          <path
            d={actualPath}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {/* 实际线数据点 */}
        {actualLine.map((p, i) => {
          const idx = allDates.indexOf(p.date);
          if (idx < 0) return null;
          const x = xScale(idx);
          const y = yScale(p.remaining);
          return <circle key={`actual-pt-${i}`} cx={x} cy={y} r={3} fill="var(--accent)" />;
        })}

        {/* 预测完成日期标注 */}
        {predictedCompletion && (
          <g>
            {(() => {
              const idx = allDates.indexOf(predictedCompletion);
              if (idx < 0) return null;
              const x = xScale(idx);
              const y = yScale(0);
              return (
                <>
                  <line
                    x1={x}
                    y1={PADDING.top}
                    x2={x}
                    y2={VIEW_HEIGHT - PADDING.bottom}
                    stroke="var(--success)"
                    strokeWidth={1}
                    strokeDasharray="4,4"
                  />
                  <circle cx={x} cy={y} r={5} fill="var(--success)" />
                  <text
                    x={x}
                    y={PADDING.top - 8}
                    textAnchor="middle"
                    fontSize={11}
                    fill="var(--success)"
                    fontWeight={600}
                  >
                    {shortDate(predictedCompletion)}
                  </text>
                </>
              );
            })()}
          </g>
        )}

        {/* 图例 */}
        <g transform={`translate(${PADDING.left + 8}, ${PADDING.top + 8})`}>
          {/* 理想线图例 */}
          <line
            x1={0}
            y1={6}
            x2={24}
            y2={6}
            stroke="var(--border)"
            strokeWidth={2}
            strokeDasharray="6,4"
          />
          <text x={30} y={10} fontSize={11} fill="var(--muted)">
            {t("burndown")} (ideal)
          </text>
          {/* 实际线图例 */}
          <line x1={130} y1={6} x2={154} y2={6} stroke="var(--accent)" strokeWidth={2.5} />
          <text x={160} y={10} fontSize={11} fill="var(--muted)">
            {t("burndown")} (actual)
          </text>
        </g>
      </svg>
    </div>
  );
}

export default BurndownChart;
