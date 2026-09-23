"use client";

// 保持 "use client"：接收 4 个函数 props（onPrev/onNext/onToday/onEventClick），
// 这些回调来自 client 父组件 (CalendarView.tsx)，无法跨越 server/client 边界传递。
// CalendarView 管理所有日历状态（currentDate/events/dialogOpen），本组件仅做展示 + 回调转发。

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, CheckCircle2 } from "lucide-react";
import type { CalendarEvent } from "./CalendarEventDialog";
import { getEventsOnDate, getEventColor, isSameDay, getWeekDays, formatTime, isTaskDeadline } from "./calendar-utils";

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
  // 手机端：当前显示的天索引（0-6），默认定位到今天或第一天
  const [mobileDayIndex, setMobileDayIndex] = useState(() => {
    const todayIdx = weekDays.findIndex((d) => isSameDay(d, today));
    return todayIdx >= 0 ? todayIdx : 0;
  });

  const weekHeaders = [
    t("sunday"), t("monday"), t("tuesday"), t("wednesday"),
    t("thursday"), t("friday"), t("saturday"),
  ];

  // 手机端切换日期时重置索引
  const handleMobilePrev = () => {
    setMobileDayIndex((i) => Math.max(0, i - 1));
  };
  const handleMobileNext = () => {
    setMobileDayIndex((i) => Math.min(6, i + 1));
  };

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

      {/* 手机端：单日滚动视图 */}
      <div className="sm:hidden flex-1 flex flex-col overflow-hidden">
        {/* 手机端日期切换条 */}
        <div className="flex items-center justify-between mb-[var(--space-2)] px-[var(--space-2)]">
          <button
            onClick={handleMobilePrev}
            disabled={mobileDayIndex === 0}
            className="p-1 rounded-[var(--radius-sm)] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ color: "var(--muted)", border: "1px solid var(--border)" }}
            aria-label="previous day in week"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
            {weekHeaders[mobileDayIndex]} · {weekDays[mobileDayIndex].getMonth() + 1}/{weekDays[mobileDayIndex].getDate()}
          </span>
          <button
            onClick={handleMobileNext}
            disabled={mobileDayIndex === 6}
            className="p-1 rounded-[var(--radius-sm)] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ color: "var(--muted)", border: "1px solid var(--border)" }}
            aria-label="next day in week"
          >
            <ChevronRight size={14} />
          </button>
        </div>
        {/* 手机端当天事件列表 */}
        <div className="flex-1 overflow-y-auto p-[var(--space-2)] flex flex-col gap-[var(--space-2)]">
          {(() => {
            const date = weekDays[mobileDayIndex];
            const dayEvents = getEventsOnDate(events, date);
            const isToday = isSameDay(date, today);
            if (dayEvents.length === 0) {
              return (
                <div className="flex items-center justify-center h-32 text-[length:var(--text-sm)] text-[var(--muted)]">
                  {t("noEvents")}
                </div>
              );
            }
            return dayEvents.map((event) => (
              <div
                key={event.id}
                className="px-[var(--space-3)] py-[var(--space-2)] rounded-[var(--radius-md)] cursor-pointer"
                style={{
                  background: `color-mix(in srgb, ${getEventColor(event)} 15%, var(--surface))`,
                  color: "var(--fg)",
                  borderLeft: `3px solid ${getEventColor(event)}`,
                }}
                onClick={() => onEventClick(event)}
              >
                <div className="font-[weight:var(--weight-medium)] text-[length:var(--text-sm)] flex items-center gap-1">
                  {isTaskDeadline(event) && <CheckCircle2 size={14} className="shrink-0" style={{ color: getEventColor(event) }} />}
                  <span className="truncate">{event.title}</span>
                </div>
                {!event.allDay && (
                  <div className="text-[length:var(--text-xs)] text-[var(--muted)] mt-1">
                    {formatTime(new Date(event.startAt))} - {formatTime(new Date(event.endAt))}
                  </div>
                )}
              </div>
            ));
          })()}
        </div>
      </div>

      {/* sm 以上：7列网格 */}
      <div className="hidden sm:grid grid-cols-7 gap-px flex-1" style={{ background: "var(--border)" }}>
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
                      <div className="font-[weight:var(--weight-medium)] truncate flex items-center gap-1">
                        {isTaskDeadline(event) && <CheckCircle2 size={12} className="shrink-0" style={{ color: getEventColor(event) }} />}
                        <span className="truncate">{event.title}</span>
                      </div>
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