"use client";

/**
 * F3 Widget — GanttWidget：任务甘特图。
 *
 * 数据：GET /dashboard/widgets/gantt-chart →
 *   { items: [{ id, title, startDate, dueDate, status, assignee }] }
 *
 * 展示：任务名称 + 横向时间条（startDate → dueDate），纯 SVG 绘制。
 *   - 时间轴按所有任务的最早 startDate 与最晚 dueDate 归一化
 *   - 任务多时横向滚动（每行固定高度，SVG 宽度按任务数自适应）
 *   - 状态色走 var(--status-*) token
 *
 * 经验来源：2026-09-10-react-icon-size-prop-hardcoded-audit
 *   — 图标尺寸走档位值，色值走 design token，不硬编码。
 */

import { useTranslations } from "next-intl";
import { useWidgetData } from "./useWidgetData";
import { WidgetError, WidgetEmpty, WidgetSkeleton } from "./WidgetStates";

interface GanttItem {
  id: string;
  title: string;
  startDate: string;
  dueDate: string;
  status: string;
  assignee: string | null;
}

interface GanttData {
  items: GanttItem[];
}

/** 状态 → 时间条填充色 token 映射（与 TaskStatsWidget 对齐） */
const STATUS_COLOR: Record<string, string> = {
  todo: "var(--status-todo)",
  in_progress: "var(--status-doing)",
  review: "var(--status-warn-fg)",
  done: "var(--status-done)",
  cancelled: "var(--meta)",
};

/** 日期格式化：MM-DD */
function fmtShort(iso: string): string {
  return iso.slice(5, 10);
}

export default function GanttWidget({ wid }: { wid: string }) {
  const t = useTranslations("dashboard");
  const { data, loading, error, retry } = useWidgetData<GanttData>(wid, "gantt-chart");

  if (loading) return <WidgetSkeleton lines={5} />;
  if (error || !data) return <WidgetError message={error} onRetry={retry} />;
  if (data.items.length === 0) return <WidgetEmpty text={t("ganttEmpty")} />;

  return <GanttChart items={data.items} ariaLabel={t("ganttChart")} />;
}

/** 甘特图 SVG：左侧任务名 + 右侧时间条 */
function GanttChart({ items, ariaLabel }: { items: GanttItem[]; ariaLabel: string }) {
  // 时间范围归一化：取所有任务的最早 start 与最晚 due
  const timestamps = items.flatMap((it) => [
    new Date(it.startDate).getTime(),
    new Date(it.dueDate).getTime(),
  ]);
  const minT = Math.min(...timestamps);
  const maxT = Math.max(...timestamps);
  const span = Math.max(1, maxT - minT); // 防除零

  // 布局常量
  const LABEL_W = 90; // 左侧任务名列宽
  const ROW_H = 20; // 每行高度
  const BAR_H = 12; // 时间条高度
  const PAD = 8;
  const TICK_H = 16; // 顶部时间轴标签区高
  const chartW = 220; // 时间轴区域宽
  const W = LABEL_W + chartW + PAD * 2;
  const H = TICK_H + items.length * ROW_H + PAD;

  // 时间轴刻度：5 等分
  const ticks = Array.from({ length: 5 }, (_, i) => {
    const t = minT + (span * i) / 4;
    return { x: LABEL_W + PAD + (chartW * i) / 4, label: fmtShort(new Date(t).toISOString()) };
  });

  return (
    <div className="p-3">
      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto"
          role="img"
          aria-label={ariaLabel}
          style={{ minWidth: "320px" }}
        >
          {/* 顶部时间轴刻度 */}
          {ticks.map((tk, i) => (
            <g key={i}>
              <line
                x1={tk.x}
                x2={tk.x}
                y1={TICK_H - 4}
                y2={H - PAD}
                stroke="var(--border)"
                strokeWidth={0.5}
                strokeDasharray="2 3"
              />
              <text
                x={tk.x}
                y={10}
                textAnchor="middle"
                className="fill-[var(--meta)]"
                style={{ fontSize: "9px" }}
              >
                {tk.label}
              </text>
            </g>
          ))}

          {/* 任务行 */}
          {items.map((it, i) => {
            const y = TICK_H + i * ROW_H + (ROW_H - BAR_H) / 2;
            const startMs = new Date(it.startDate).getTime();
            const dueMs = new Date(it.dueDate).getTime();
            const barX = LABEL_W + PAD + ((startMs - minT) / span) * chartW;
            const barW = Math.max(2, ((dueMs - startMs) / span) * chartW);
            const color = STATUS_COLOR[it.status] ?? "var(--accent)";
            return (
              <g key={it.id}>
                {/* 任务名（截断显示） */}
                <text
                  x={PAD}
                  y={y + BAR_H - 2}
                  className="fill-[var(--fg-2)]"
                  style={{ fontSize: "9px" }}
                >
                  {it.title.length > 12 ? `${it.title.slice(0, 11)}…` : it.title}
                </text>
                {/* 时间条 */}
                <rect
                  x={barX}
                  y={y}
                  width={barW}
                  height={BAR_H}
                  rx={2}
                  fill={color}
                  opacity={it.status === "done" ? 0.6 : 0.85}
                >
                  <title>{`${it.title}: ${fmtShort(it.startDate)} → ${fmtShort(it.dueDate)}`}</title>
                </rect>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}