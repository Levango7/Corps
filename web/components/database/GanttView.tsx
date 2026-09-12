"use client";

/**
 * 多维表格 · 甘特图视图（Phase 3C）
 *
 * 横轴为时间（按天），纵轴为记录列表，每条记录为水平条。
 * 时间轴头部 sticky top，可水平滚动；记录名列 sticky left。
 * 日期计算用原生 Date API，不依赖 date-fns。
 * 所有样式走 design token（var(--*)），无裸 hex。
 */

import { useMemo } from "react";
import type { Database, DatabaseField, DatabaseRecord, DatabaseView } from "@prisma/client";
import { useTranslations } from "next-intl";

// ─── 类型与辅助函数 ──────────────────────────────────────────────

type RecordData = Record<string, unknown>;

function readData(record: DatabaseRecord): RecordData {
  const d = record.data as unknown;
  if (d !== null && typeof d === "object" && !Array.isArray(d)) {
    return d as RecordData;
  }
  return {};
}

function getFieldValue(record: DatabaseRecord, fieldId: string): unknown {
  return readData(record)[fieldId] ?? null;
}

function readConfig<T = RecordData>(view: DatabaseView): T {
  const c = view.config as unknown;
  if (c !== null && typeof c === "object" && !Array.isArray(c)) {
    return c as T;
  }
  return {} as T;
}

function parseDate(value: unknown): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysBetween(a: Date, b: Date): number {
  const ms = startOfDay(b).getTime() - startOfDay(a).getTime();
  return Math.round(ms / 86400000);
}

/** 语义色名 → design token 映射 */
const SEMANTIC_COLORS: Record<string, string> = {
  accent: "var(--accent)",
  success: "var(--success)",
  warn: "var(--warn)",
  warning: "var(--warn)",
  danger: "var(--danger)",
  error: "var(--danger)",
  muted: "var(--muted)",
};

/** 将 colorField 值映射到 design token 颜色 */
function mapColor(value: unknown): string {
  if (typeof value === "string") {
    if (value.startsWith("var(--")) return value;
    const lower = value.toLowerCase();
    if (SEMANTIC_COLORS[lower]) return SEMANTIC_COLORS[lower];
  }
  return "var(--accent)";
}

// ─── 布局常量 ──────────────────────────────────────────────────────

const DAY_WIDTH = 48;
const ROW_HEIGHT = 36;
const LABEL_WIDTH = 200;
const HEADER_HEIGHT = 40;
const DAY_MS = 86400000;

// ─── Props ──────────────────────────────────────────────────────

export interface GanttViewProps {
  database: Database;
  fields: DatabaseField[];
  records: DatabaseRecord[];
  view: DatabaseView;
  onRecordUpdate?: (id: string, data: RecordData) => void;
}

interface GanttViewConfig {
  startDateField?: string;
  endDateField?: string;
  labelField?: string;
  colorField?: string;
}

interface GanttBar {
  record: DatabaseRecord;
  start: Date;
  end: Date;
  label: string;
  color: string;
}

// ─── 主组件 ──────────────────────────────────────────────────────

export function GanttView({ fields, records, view }: GanttViewProps) {
  const t = useTranslations("database.ganttView");
  const config = readConfig<GanttViewConfig>(view);

  const startDateField = config.startDateField
    ? fields.find((f) => f.id === config.startDateField)
    : undefined;
  const endDateField = config.endDateField
    ? fields.find((f) => f.id === config.endDateField)
    : undefined;
  const labelField = config.labelField
    ? fields.find((f) => f.id === config.labelField)
    : undefined;
  const colorField = config.colorField
    ? fields.find((f) => f.id === config.colorField)
    : undefined;

  const titleField = useMemo(
    () => fields.find((f) => f.type === "text") ?? fields[0],
    [fields],
  );

  // 计算甘特条目和时间范围
  const { bars, minDate, totalDays } = useMemo(() => {
    const today = startOfDay(new Date());
    let min = today;
    let max = today;
    const items: GanttBar[] = [];

    for (const record of records) {
      const startVal = startDateField ? getFieldValue(record, startDateField.id) : null;
      const endVal = endDateField ? getFieldValue(record, endDateField.id) : null;
      const start = parseDate(startVal);
      const end = parseDate(endVal);
      if (!start && !end) continue;

      const s = start ?? end!;
      const e = end ?? start!;
      const sd = startOfDay(s);
      const ed = startOfDay(e);

      if (sd < min) min = sd;
      if (ed > max) max = ed;

      const label = labelField ? String(getFieldValue(record, labelField.id) ?? "") : "";
      const color = colorField ? mapColor(getFieldValue(record, colorField.id)) : "var(--accent)";
      items.push({ record, start: sd, end: ed, label, color });
    }

    // 留一天余量
    max = new Date(max.getTime() + DAY_MS);
    const days = Math.max(1, daysBetween(min, max) + 1);
    return { bars: items, minDate: min, totalDays: days };
  }, [records, startDateField, endDateField, labelField, colorField]);

  // 生成日期轴
  const days = useMemo(() => {
    return Array.from({ length: totalDays }, (_, i) => new Date(minDate.getTime() + i * DAY_MS));
  }, [minDate, totalDays]);

  if (!startDateField && !endDateField) {
    return (
      <div className="flex items-center justify-center min-h-[400px] text-[var(--muted)] text-[length:var(--text-sm)]">
        {t("noDateFields")}
      </div>
    );
  }

  if (bars.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[400px] text-[var(--muted)] text-[length:var(--text-sm)]">
        {t("noDatedRecords")}
      </div>
    );
  }

  const totalWidth = LABEL_WIDTH + totalDays * DAY_WIDTH;

  return (
    <div className="border border-[var(--border)] rounded-[var(--radius-lg)] overflow-hidden bg-[var(--surface)]">
      <div className="overflow-auto" style={{ maxHeight: 600 }}>
        <div style={{ width: totalWidth }}>
          {/* 时间轴头部 */}
          <div
            className="flex bg-[var(--surface)] border-b border-[var(--border)]"
            style={{ height: HEADER_HEIGHT, position: "sticky", top: 0, zIndex: 20 }}
          >
            <div
              className="flex items-center px-3 font-[weight:var(--weight-medium)] text-[var(--muted)] text-[length:var(--text-xs)] border-r border-[var(--border)] bg-[var(--surface)]"
              style={{
                width: LABEL_WIDTH,
                height: HEADER_HEIGHT,
                position: "sticky",
                left: 0,
                zIndex: 30,
              }}
            >
              {t("recordLabel")}
            </div>
            {days.map((d) => (
              <div
                key={d.toISOString()}
                className="flex items-center justify-center text-[length:var(--text-xs)] text-[var(--muted)] border-r border-[var(--border-soft)]"
                style={{ width: DAY_WIDTH, height: HEADER_HEIGHT }}
              >
                {d.getMonth() + 1}/{d.getDate()}
              </div>
            ))}
          </div>

          {/* 记录行 */}
          {bars.map((bar) => {
            const offset = Math.max(0, daysBetween(minDate, bar.start));
            const span = Math.max(1, Math.min(daysBetween(bar.start, bar.end) + 1, totalDays - offset));
            const title = titleField
              ? String(getFieldValue(bar.record, titleField.id) ?? bar.record.id.slice(0, 8))
              : bar.record.id.slice(0, 8);
            return (
              <div
                key={bar.record.id}
                className="flex border-b border-[var(--border-soft)]"
                style={{ height: ROW_HEIGHT }}
              >
                <div
                  className="flex items-center px-3 text-[length:var(--text-sm)] text-[var(--fg)] truncate border-r border-[var(--border)] bg-[var(--surface)]"
                  style={{
                    width: LABEL_WIDTH,
                    height: ROW_HEIGHT,
                    position: "sticky",
                    left: 0,
                    zIndex: 10,
                  }}
                >
                  {title}
                </div>
                <div className="relative" style={{ width: totalDays * DAY_WIDTH, height: ROW_HEIGHT }}>
                  <div
                    className="absolute top-1/2 -translate-y-1/2 rounded-[var(--radius-sm)] flex items-center px-2 text-[length:var(--text-xs)] text-[var(--on-accent)] font-[weight:var(--weight-medium)] truncate overflow-hidden"
                    style={{
                      left: offset * DAY_WIDTH,
                      width: Math.max(span * DAY_WIDTH - 4, 0),
                      height: ROW_HEIGHT - 8,
                      background: bar.color,
                    }}
                  >
                    {bar.label}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
