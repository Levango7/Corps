/**
 * 行为统计图表组件（方向 F）
 *
 * 功能：
 *  - 各 AI 能力使用次数柱状图（原生 SVG）
 *  - 每个能力的接受率/拒绝率条形图
 *  - 空数据态
 *
 * 数据来源：由父组件 PersonalizationPanel 通过 GET /api/v1/ai/personalization/behaviors
 * 聚合后传入，或独立调用 getBehaviorStats。
 *
 * 样式：design token（var(--*)），lucide-react 图标 size 14/16
 * i18n：getTranslations("ai.aiPersonalization")
 * 图表：原生 SVG，不引入外部库
 *
 * 来源：方向 F 任务 5（BehaviorStats.tsx）
 */

import { getTranslations } from "next-intl/server";
import { BarChart3, CheckCircle2, XCircle } from "lucide-react";

/** 单个能力统计（与 behavior-tracker.ts CapabilityStat 对齐） */
export interface CapabilityStat {
  capability: string;
  total: number;
  useCount: number;
  acceptCount: number;
  rejectCount: number;
  editCount: number;
  acceptRate: number;
  rejectRate: number;
}

interface BehaviorStatsProps {
  /** 按能力分组的统计（按 total 降序） */
  capabilities: CapabilityStat[];
  /** 总行为数 */
  totalBehaviors: number;
}

/** SVG 柱状图视口尺寸 */
const CHART_WIDTH = 600;
const CHART_HEIGHT = 240;
const CHART_PADDING = { top: 20, right: 20, bottom: 60, left: 50 };

/** 格式化百分比 */
function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** 截断过长的 capability 名（用于 X 轴标签） */
function truncateCapability(name: string, maxLen = 12): string {
  return name.length > maxLen ? name.slice(0, maxLen) + "…" : name;
}

export async function BehaviorStats({ capabilities, totalBehaviors }: BehaviorStatsProps) {
  const t = await getTranslations("ai.aiPersonalization");

  // 空数据态
  if (capabilities.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] py-[var(--space-8)]"
        role="img"
        aria-label={t("stats")}
      >
        <BarChart3 size={16} className="text-[var(--muted)]" />
        <span className="text-[length:var(--text-sm)] text-[var(--muted)]">
          {t("noRecommendations")}
        </span>
      </div>
    );
  }

  // 柱状图数据：最多展示 8 个能力（避免 X 轴过密）
  const chartData = capabilities.slice(0, 8);
  const maxCount = Math.max(1, ...chartData.map((c) => c.total));

  // 坐标计算
  const plotWidth = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right;
  const plotHeight = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;
  const barWidth = chartData.length > 0 ? plotWidth / chartData.length : 0;
  const barGap = barWidth * 0.3;
  const barActualWidth = barWidth - barGap;

  const yScale = (val: number) => CHART_PADDING.top + plotHeight - (val / maxCount) * plotHeight;

  // Y 轴刻度（4 等分）
  const yTicks = Array.from({ length: 5 }, (_, i) => Math.round((maxCount * i) / 4));

  return (
    <section
      className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] px-[var(--space-4)] py-[var(--space-3)]"
      aria-label={t("stats")}
    >
      {/* 标题 */}
      <div className="mb-[var(--space-3)] flex items-center gap-[var(--space-2)]">
        <BarChart3 size={16} className="text-[var(--accent)]" />
        <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]">
          {t("stats")}
        </span>
        <span className="ml-auto text-[length:var(--text-xs)] text-[var(--muted)]">
          {t("useCapability")}: {totalBehaviors}
        </span>
      </div>

      {/* 柱状图：各能力使用次数 */}
      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          className="w-full"
          style={{ minWidth: 400 }}
          role="img"
          aria-label={t("capability")}
        >
          {/* Y 轴刻度 + 网格线 */}
          {yTicks.map((tick) => {
            const y = yScale(tick);
            return (
              <g key={`y-${tick}`}>
                <line
                  x1={CHART_PADDING.left}
                  y1={y}
                  x2={CHART_WIDTH - CHART_PADDING.right}
                  y2={y}
                  stroke="var(--border-soft)"
                  strokeWidth={1}
                  strokeDasharray="2,3"
                />
                <text
                  x={CHART_PADDING.left - 8}
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

          {/* 柱子 + X 轴标签 */}
          {chartData.map((cap, idx) => {
            const x = CHART_PADDING.left + idx * barWidth + barGap / 2;
            const barH = plotHeight - (yScale(cap.total) - CHART_PADDING.top);
            const y = yScale(cap.total);
            return (
              <g key={`bar-${cap.capability}`}>
                {/* 柱子 */}
                <rect
                  x={x}
                  y={y}
                  width={barActualWidth}
                  height={Math.max(0, barH)}
                  fill="var(--accent)"
                  rx={2}
                >
                  <title>{`${cap.capability}: ${cap.total}`}</title>
                </rect>
                {/* 数值标签（柱顶） */}
                <text
                  x={x + barActualWidth / 2}
                  y={y - 4}
                  textAnchor="middle"
                  fontSize={10}
                  fill="var(--fg-2)"
                >
                  {cap.total}
                </text>
                {/* X 轴标签 */}
                <text
                  x={x + barActualWidth / 2}
                  y={CHART_HEIGHT - CHART_PADDING.bottom + 16}
                  textAnchor="middle"
                  fontSize={10}
                  fill="var(--muted)"
                >
                  {truncateCapability(cap.capability)}
                </text>
              </g>
            );
          })}

          {/* X 轴线 */}
          <line
            x1={CHART_PADDING.left}
            y1={CHART_PADDING.top + plotHeight}
            x2={CHART_WIDTH - CHART_PADDING.right}
            y2={CHART_PADDING.top + plotHeight}
            stroke="var(--border)"
            strokeWidth={1}
          />
        </svg>
      </div>

      {/* 接受率/拒绝率列表 */}
      <div className="mt-[var(--space-4)] flex flex-col gap-[var(--space-2)]">
        <div className="flex items-center gap-[var(--space-2)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]">
          <CheckCircle2 size={14} className="text-[var(--success)]" />
          <span>{t("acceptSuggestion")}</span>
          <span className="mx-[var(--space-2)] text-[var(--muted)]">/</span>
          <XCircle size={14} className="text-[var(--danger)]" />
          <span>{t("rejectSuggestion")}</span>
        </div>

        {chartData.map((cap) => (
          <div
            key={`rate-${cap.capability}`}
            className="flex items-center gap-[var(--space-3)] text-[length:var(--text-xs)]"
          >
            {/* 能力名 */}
            <span className="w-[120px] shrink-0 truncate text-[var(--fg)]" title={cap.capability}>
              {cap.capability}
            </span>

            {/* 接受率/拒绝率双条形图 */}
            <div className="flex h-[6px] flex-1 overflow-hidden rounded-[var(--radius-pill)] bg-[var(--surface-3)]">
              <div
                className="h-full bg-[var(--success)]"
                style={{ width: `${cap.acceptRate * 100}%` }}
              />
              <div
                className="h-full bg-[var(--danger)]"
                style={{ width: `${cap.rejectRate * 100}%` }}
              />
            </div>

            {/* 数值 */}
            <span className="w-[80px] shrink-0 text-right text-[var(--muted)]">
              {formatPercent(cap.acceptRate)} / {formatPercent(cap.rejectRate)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

export default BehaviorStats;
