"use client";

import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { CalendarEvent } from "./CalendarEventDialog";
import { getEventsOnDate, getEventColor, isSameDay, getWeekDays, formatTime } from "./calendar-utils";

/** 周视图公共 props */
interface CalendarWeekProps {
  events: CalendarEvent[];
  currentDate: Date;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onEventClick: (event: CalendarEvent) => void;
}

/**
 * CalendarWeek — 周视图组件。
 * 显示当前周的 7 天，每天一列，事件按时间排列。
 * 支持点击事件打开编辑弹窗，上下周导航。
 */
export function CalendarWeek({
  events,
  currentDate,
  onPrev,
  onNext,
  onToday,
  onEventClick,
}: CalendarWeekProps) {
  const t = useTranslations("calendar");
  const today = new Date();
  const weekDays = getWeekDays(currentDate);

  const weekHeaders = [
    t("sunday"), t("monday"), t("tuesday"), t("wednesday"),
    t("thursday"), t("friday"), t("saturday"),
  ];

  return (
    <div className="flex flex-col h-full">
      {/* 头部：导航 */}
      <div className="flex items-center justify-between mb-[var(--space-4)] px-[var(--space-2)]">
        <div className="flex items-center gap-[var(--space-2)]">
          <button
            onClick={onPrev}
            className="p-1 rounded-[var(--radius-sm)] cursor-pointer"
            style={{ color: "var(--muted)", border: "1px solid var(--border)" }}
            aria-label="previous week"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            onClick={onNext}
            className="p-1 rounded-[var(--radius-sm)] cursor-pointer"
            style={{ color: "var(--muted)", border: "1px solid var(--border)" }}
            aria-label="next week"
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
          {weekDays[0].getFullYear()}年 {weekDays[0].getMonth() + 1}月{weekDays[0].getDate()}日 - {weekDays[6].getMonth() + 1}月{weekDays[6].getDate()}日
        </h2>
      </div>

      {/* 7 列日期 */}
      <div className="grid grid-cols-7 gap-px flex-1" style={{ background: "var(--border)" }}>
        {weekDays.map((date, i) => {
          const dayEvents = getEventsOnDate(events, date);
          const isToday = isSameDay(date, today);
          return (
            <div
              key={i}
              className="flex flex-col overflow-hidden"
              style={{ background: "var(--surface)" }}
            >
              {/* 日期标题 */}
              <div
                className="text-center py-[var(--space-2)] border-b"
                style={{ borderColor: "var(--border)" }}
              >
                <div className="text-[length:var(--text-sm)] text-[var(--muted)]">
                  {weekHeaders[i]}
                </div>
                <div
                  className="text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)] w-8 h-8 mx-auto flex items-center justify-center rounded-full mt-1"
                  style={
                    isToday
                      ? { background: "var(--accent)", color: "var(--accent-fg)" }
                      : { color: "var(--fg)" }
                  }
                >
                  {date.getDate()}
                </div>
              </div>
              {/* 事件列表 */}
              <div className="flex-1 overflow-y-auto p-1 flex flex-col gap-1">
                {dayEvents.length === 0 ? (
                  <span className="text-[length:var(--text-xs)] text-[var(--muted)] opacity-50 text-center mt-2">
                    {t("noEvents")}
                  </span>
                ) : (
                  dayEvents.map((event) => (
                    <div
                      key={event.id}
                      className="text-[length:var(--text-xs)] px-[var(--space-2)] py-1 rounded-[var(--radius-sm)] cursor-pointer"
                      style={{
                        background: `color-mix(in srgb, ${getEventColor(event)} 15%, var(--surface))`,
                        color: "var(--fg)",
                        borderLeft: `3px solid ${getEventColor(event)}`,
                      }}
                      onClick={() => onEventClick(event)}
                    >
                      <div className="font-[weight:var(--weight-medium)] truncate">{event.title}</div>
                      {!event.allDay && (
                        <div className="text-[var(--muted)]">
                          {formatTime(new Date(event.startAt))} - {formatTime(new Date(event.endAt))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}