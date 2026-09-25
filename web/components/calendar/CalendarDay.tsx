"use client";

// 保持 "use client"：接收 4 个函数 props（onPrev/onNext/onToday/onEventClick），
// 这些回调来自 client 父组件 (CalendarView.tsx)，无法跨越 server/client 边界传递。
// CalendarView 管理所有日历状态（currentDate/events/dialogOpen），本组件仅做展示 + 回调转发。

import { useTranslations, useLocale } from "next-intl";
import { ChevronLeft, ChevronRight, CheckCircle2 } from "lucide-react";
import type { CalendarEvent } from "./CalendarEventDialog";
import {
  getEventsOnDate,
  getEventColor,
  isSameDay,
  formatTime,
  isTaskDeadline,
} from "./calendar-utils";

/** 日视图公共 props */
interface CalendarDayProps {
  events: CalendarEvent[];
  currentDate: Date;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onEventClick: (event: CalendarEvent) => void;
}

/**
 * CalendarDay — 日视图组件。
 * 显示单日的时间轴（0:00-23:00），事件按时间排列。
 * 支持点击事件打开编辑弹窗，上下日导航。
 */
export function CalendarDay({
  events,
  currentDate,
  onPrev,
  onNext,
  onToday,
  onEventClick,
}: CalendarDayProps) {
  const t = useTranslations("calendar");
  const locale = useLocale();
  const today = new Date();
  const isToday = isSameDay(currentDate, today);
  const dayEvents = getEventsOnDate(events, currentDate);

  // i18n 日期格式化：根据 locale 选择 BCP 47 语言标签
  const dateLocale = locale === "zh" ? "zh-CN" : "en-US";
  const formattedDate = new Intl.DateTimeFormat(dateLocale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(currentDate);

  // 24 小时时间轴
  const hours = Array.from({ length: 24 }, (_, i) => i);

  return (
    <div className="flex flex-col h-full">
      {/* 头部：导航 */}
      <div className="flex items-center justify-between mb-[var(--space-4)] px-[var(--space-2)]">
        <div className="flex items-center gap-[var(--space-2)]">
          <button
            onClick={onPrev}
            className="p-1 rounded-[var(--radius-sm)] cursor-pointer"
            style={{ color: "var(--muted)", border: "1px solid var(--border)" }}
            aria-label="previous day"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            onClick={onNext}
            className="p-1 rounded-[var(--radius-sm)] cursor-pointer"
            style={{ color: "var(--muted)", border: "1px solid var(--border)" }}
            aria-label="next day"
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
        <h2
          className="text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)]"
          style={isToday ? { color: "var(--accent)" } : { color: "var(--fg)" }}
        >
          {formattedDate}
        </h2>
      </div>

      {/* 时间轴 */}
      <div className="flex-1 overflow-y-auto">
        {dayEvents.length === 0 && (
          <div className="flex items-center justify-center h-32 text-[var(--muted)]">
            {t("noEvents")}
          </div>
        )}
        <div className="flex flex-col">
          {hours.map((hour) => {
            const hourEvents = dayEvents.filter((e) => {
              const start = new Date(e.startAt);
              return start.getHours() === hour;
            });
            return (
              <div
                key={hour}
                className="flex border-b min-h-[48px]"
                style={{ borderColor: "var(--border)" }}
              >
                {/* 时间标签 */}
                <div className="w-16 shrink-0 py-1 px-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--muted)] text-right">
                  {String(hour).padStart(2, "0")}:00
                </div>
                {/* 事件 */}
                <div className="flex-1 p-1 flex flex-col gap-1">
                  {hourEvents.map((event) => (
                    <div
                      key={event.id}
                      className="px-[var(--space-3)] py-1 rounded-[var(--radius-md)] cursor-pointer"
                      style={{
                        background: `color-mix(in srgb, ${getEventColor(event)} 15%, var(--surface))`,
                        color: "var(--fg)",
                        borderLeft: `3px solid ${getEventColor(event)}`,
                      }}
                      onClick={() => onEventClick(event)}
                    >
                      <div className="font-[weight:var(--weight-medium)] text-[length:var(--text-sm)] flex items-center gap-1">
                        {isTaskDeadline(event) && (
                          <CheckCircle2
                            size={14}
                            className="shrink-0"
                            style={{ color: getEventColor(event) }}
                          />
                        )}
                        <span className="truncate">{event.title}</span>
                      </div>
                      {!event.allDay && (
                        <div className="text-[length:var(--text-xs)] text-[var(--muted)]">
                          {formatTime(new Date(event.startAt))} -{" "}
                          {formatTime(new Date(event.endAt))}
                          {event.location && ` · ${event.location}`}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
