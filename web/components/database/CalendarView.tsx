"use client";

/**
 * 多维表格 · 日历视图（Phase 3C）
 *
 * 支持月 / 周 / 日三种粒度，记录按日期字段放入对应格子。
 * 顶部有视图切换 + 上一页 / 下一页导航。
 * 日期计算用原生 Date API，不依赖 date-fns。
 * 所有样式走 design token（var(--*)），无裸 hex。
 * 图标：lucide-react，尺寸 16。
 */

import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Database, DatabaseField, DatabaseRecord, DatabaseView } from "@prisma/client";

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

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** 周一开始的 startOfWeek */
function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  return startOfDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() - diff));
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

const DAY_MS = 86400000;
const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
const MAX_EVENTS = 3;

// ─── Props ──────────────────────────────────────────────────────

export interface CalendarViewProps {
  database: Database;
  fields: DatabaseField[];
  records: DatabaseRecord[];
  view: DatabaseView;
  onRecordUpdate?: (id: string, data: RecordData) => void;
  granularity?: "month" | "week" | "day";
}

interface CalendarViewConfig {
  dateField?: string;
}

// ─── 主组件 ──────────────────────────────────────────────────────

export function CalendarView({
  fields,
  records,
  view,
  granularity: initialGranularity = "month",
}: CalendarViewProps) {
  const [granularity, setGranularity] = useState<"month" | "week" | "day">(initialGranularity);
  const [currentDate, setCurrentDate] = useState(() => new Date());

  const config = readConfig<CalendarViewConfig>(view);
  const dateField = config.dateField ? fields.find((f) => f.id === config.dateField) : undefined;

  const titleField = useMemo(
    () => fields.find((f) => f.type === "text") ?? fields[0],
    [fields],
  );

  // 按日期分组记录
  const recordsByDate = useMemo(() => {
    const dateMap = new Map<string, DatabaseRecord[]>();
    if (!dateField) return dateMap;
    for (const record of records) {
      const d = parseDate(getFieldValue(record, dateField.id));
      if (!d) continue;
      const key = dateKey(startOfDay(d));
      if (!dateMap.has(key)) dateMap.set(key, []);
      dateMap.get(key)!.push(record);
    }
    return dateMap;
  }, [records, dateField]);

  const navigate = (dir: 1 | -1) => {
    setCurrentDate((prev) => {
      const d = new Date(prev);
      if (granularity === "month") d.setMonth(d.getMonth() + dir);
      else if (granularity === "week") d.setDate(d.getDate() + dir * 7);
      else d.setDate(d.getDate() + dir);
      return d;
    });
  };

  const displayDays = useMemo(() => {
    if (granularity === "day") return [startOfDay(currentDate)];
    if (granularity === "week") {
      const start = startOfWeek(currentDate);
      return Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * DAY_MS));
    }
    const start = startOfWeek(startOfMonth(currentDate));
    return Array.from({ length: 42 }, (_, i) => new Date(start.getTime() + i * DAY_MS));
  }, [currentDate, granularity]);

  const headerTitle = useMemo(() => {
    if (granularity === "day") {
      return `${currentDate.getFullYear()}年${currentDate.getMonth() + 1}月${currentDate.getDate()}日`;
    }
    if (granularity === "week") {
      const start = startOfWeek(currentDate);
      const end = new Date(start.getTime() + 6 * DAY_MS);
      return `${start.getFullYear()}年 ${start.getMonth() + 1}/${start.getDate()} - ${end.getMonth() + 1}/${end.getDate()}`;
    }
    return `${currentDate.getFullYear()}年 ${currentDate.getMonth() + 1}月`;
  }, [currentDate, granularity]);

  const todayKey = dateKey(new Date());

  if (!dateField) {
    return (
      <div className="flex items-center justify-center min-h-[400px] text-[var(--muted)] text-[length:var(--text-sm)]">
        请在视图配置中设置日期字段
      </div>
    );
  }

  const getRecordTitle = (record: DatabaseRecord): string => {
    if (!titleField) return record.id.slice(0, 8);
    const v = getFieldValue(record, titleField.id);
    if (v == null || v === "") return "无标题";
    return String(v);
  };

  return (
    <div className="flex flex-col h-full">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button
          onClick={() => navigate(-1)}
          className="p-1.5 rounded-[var(--radius-sm)] hover:bg-[var(--surface-2)] text-[var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
          aria-label="上一页"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-[length:var(--text-base)] font-[weight:var(--weight-medium)] text-[var(--fg)] min-w-[140px] text-center">
          {headerTitle}
        </span>
        <button
          onClick={() => navigate(1)}
          className="p-1.5 rounded-[var(--radius-sm)] hover:bg-[var(--surface-2)] text-[var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
          aria-label="下一页"
        >
          <ChevronRight size={16} />
        </button>
        <button
          onClick={() => setCurrentDate(new Date())}
          className="px-3 py-1 rounded-[var(--radius-sm)] border border-[var(--border)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
        >
          今天
        </button>
        <div className="ml-auto flex gap-1 rounded-[var(--radius-sm)] bg-[var(--surface-2)] p-0.5">
          {(["month", "week", "day"] as const).map((g) => (
            <button
              key={g}
              onClick={() => setGranularity(g)}
              className={[
                "px-3 py-1 rounded-[var(--radius-sm)] text-[length:var(--text-sm)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]",
                granularity === g
                  ? "bg-[var(--surface)] text-[var(--fg)] shadow-[var(--elev-sm)] font-[weight:var(--weight-medium)]"
                  : "text-[var(--muted)] hover:text-[var(--fg)]",
              ].join(" ")}
            >
              {g === "month" ? "月" : g === "week" ? "周" : "日"}
            </button>
          ))}
        </div>
      </div>

      {/* 日历内容 */}
      {granularity === "day" ? (
        <DayView
          records={recordsByDate.get(dateKey(startOfDay(currentDate))) ?? []}
          getRecordTitle={getRecordTitle}
        />
      ) : (
        <div className="grid grid-cols-7 border border-[var(--border)] rounded-[var(--radius-lg)] overflow-hidden bg-[var(--surface)]">
          {WEEKDAYS.map((w) => (
            <div
              key={w}
              className="text-center py-2 text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--muted)] border-b border-[var(--border)] bg-[var(--surface-2)]"
            >
              周{w}
            </div>
          ))}
          {displayDays.map((d) => {
            const key = dateKey(d);
            const dayRecords = recordsByDate.get(key) ?? [];
            const isToday = key === todayKey;
            const isCurrentMonth = granularity === "week" || d.getMonth() === currentDate.getMonth();
            const visible = dayRecords.slice(0, MAX_EVENTS);
            const remaining = dayRecords.length - visible.length;
            return (
              <div
                key={key}
                className={[
                  "min-h-[100px] p-1.5 border-b border-r border-[var(--border-soft)]",
                  isCurrentMonth ? "bg-[var(--surface)]" : "bg-[var(--surface-2)]",
                ].join(" ")}
              >
                <div
                  className={[
                    "inline-flex items-center justify-center w-6 h-6 rounded-full text-[length:var(--text-xs)] tabular-nums",
                    isToday
                      ? "bg-[var(--accent)] text-[var(--accent-fg)] font-[weight:var(--weight-medium)]"
                      : isCurrentMonth
                        ? "text-[var(--fg)]"
                        : "text-[var(--meta)]",
                  ].join(" ")}
                >
                  {d.getDate()}
                </div>
                <div className="mt-1 space-y-1">
                  {visible.map((record) => (
                    <div
                      key={record.id}
                      className="text-[length:var(--text-xs)] text-[var(--on-accent)] bg-[var(--accent)] rounded px-1.5 py-0.5 truncate"
                    >
                      {getRecordTitle(record)}
                    </div>
                  ))}
                  {remaining > 0 && (
                    <div className="text-[length:var(--text-xs)] text-[var(--muted)] px-1.5">
                      +{remaining} 更多
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── 日视图子组件 ──────────────────────────────────────────────────

interface DayViewProps {
  records: DatabaseRecord[];
  getRecordTitle: (record: DatabaseRecord) => string;
}

function DayView({ records, getRecordTitle }: DayViewProps) {
  if (records.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[400px] text-[var(--muted)] text-[length:var(--text-sm)] border border-[var(--border)] rounded-[var(--radius-lg)] bg-[var(--surface)]">
        当天无记录
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 border border-[var(--border)] rounded-[var(--radius-lg)] bg-[var(--surface)] p-4">
      {records.map((record) => (
        <div
          key={record.id}
          className="flex items-center gap-3 p-3 rounded-[var(--radius-md)] bg-[var(--surface-2)] border border-[var(--border-soft)]"
        >
          <div className="w-1 h-8 rounded-full bg-[var(--accent)] shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)] truncate">
              {getRecordTitle(record)}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
