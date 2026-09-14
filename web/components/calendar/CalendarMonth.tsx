"use client";

import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { CalendarEvent } from "./CalendarEventDialog";
import { getEventsOnDate, getEventColor, isSameDay, addMonths } from "./calendar-utils";

/** 月视图公共 props */
interface CalendarMonthProps {
  events: CalendarEvent[];
  currentDate: Date;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onEventClick: (event: CalendarEvent) => void;
  onDayClick: (date: Date) => void;
}

/**
 * CalendarMonth — 月视图组件。
 * 6行×7列网格，每个格子显示日期和事件摘要。
 * 支持点击日期切换到日视图，点击事件打开编辑弹窗。
 */
export function CalendarMonth({
  events,
  currentDate,
  onPrev,
  onNext,
  onToday,
  onEventClick,
  onDayClick,
}: CalendarMonthProps) {
  const t = useTranslations("calendar");

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const today = new Date();

  // 当月第一天是星期几（0=Sunday）
  const firstDayOfWeek = new Date(year, month, 1).getDay();
  // 当月天数
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // 星期标题
  const weekHeaders = [
    t("sunday"), t("monday"), t("tuesday"), t("wednesday"),
    t("thursday"), t("friday"), t("saturday"),
  ];

  // 生成 42 个格子（6行×7列）
  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstDayOfWeek; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length < 42) cells.push(null);

  return (
    <div className="flex flex-col h-full">
      {/* 头部：导航 */}
      <div className="flex items-center justify-between mb-[var(--space-4)] px-[var(--space-2)]">
        <div className="flex items-center gap-[var(--space-2)]">
          <button
            onClick={onPrev}
            className="p-1 rounded-[var(--radius-sm)] cursor-pointer"
            style={{ color: "var(--muted)", border: "1px solid var(--border)" }}
            aria-label="previous month"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            onClick={onNext}
            className="p-1 rounded-[var(--radius-sm)] cursor-pointer"
            style={{ color: "var(--muted)", border: "1px solid var(--border)" }}
            aria-label="next month"
          >
            <ChevronRight size={14} />
          </button>
          <button
            onClick={onToday}
            className="px-[var(--space-3)] py-1 rounded-[var(--radius-sm)] text-[length:var(--text-sm)] cursor-pointer"
            style={{ color: "var(--fg)", border: "1px solid var(--border)" }}
          >
            {t("today")}
          </button>
        </div>
        <h2 className="text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
          {year}年 {month + 1}月
        </h2>
      </div>

      {/* 星期标题 */}
      <div className="grid grid-cols-7 mb-1">
        {weekHeaders.map((h) => (
          <div
            key={h}
            className="text-center text-[length:var(--text-sm)] py-[var(--space-2)] text-[var(--muted)]"
          >
            {h}
          </div>
        ))}
      </div>

      {/* 日期网格 */}
      <div className="grid grid-cols-7 grid-rows-6 gap-px flex-1" style={{ background: "var(--border)" }}>
        {cells.map((date, i) => {
          if (!date) {
            return (
              <div
                key={i}
                className="p-1 min-h-[80px]"
                style={{ background: "var(--surface)" }}
              />
            );
          }
          const dayEvents = getEventsOnDate(events, date);
          const isToday = isSameDay(date, today);
          return (
            <div
              key={i}
              className="p-1 min-h-[80px] flex flex-col gap-1 cursor-pointer overflow-hidden"
              style={{ background: "var(--surface)" }}
              onClick={() => onDayClick(date)}
            >
              <span
                className="text-[length:var(--text-sm)] w-6 h-6 flex items-center justify-center rounded-full"
                style={
                  isToday
                    ? { background: "var(--accent)", color: "var(--accent-fg)" }
                    : { color: "var(--fg)" }
                }
              >
                {date.getDate()}
              </span>
              {dayEvents.slice(0, 3).map((event) => (
                <div
                  key={event.id}
                  className="text-[length:var(--text-xs)] px-1 py-0.5 rounded-[var(--radius-sm)] truncate cursor-pointer"
                  style={{
                    background: `color-mix(in srgb, ${getEventColor(event)} 20%, var(--surface))`,
                    color: getEventColor(event),
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEventClick(event);
                  }}
                >
                  {event.title}
                </div>
              ))}
              {dayEvents.length > 3 && (
                <span className="text-[length:var(--text-xs)] text-[var(--muted)]">
                  +{dayEvents.length - 3}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}