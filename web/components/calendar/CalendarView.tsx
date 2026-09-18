"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { CalendarMonth } from "./CalendarMonth";
import { CalendarWeek } from "./CalendarWeek";
import { CalendarDay } from "./CalendarDay";
import { CalendarEventDialog, type CalendarEvent } from "./CalendarEventDialog";
import { addMonths, addWeeks, addDays, taskToCalendarEvent, type TaskSummary } from "./calendar-utils";

type ViewMode = "month" | "week" | "day";

/** GET /tasks 返回的分页响应 data 形状 */
interface TasksListResponse {
  items: TaskSummary[];
  total: number;
  hasMore: boolean;
}

/**
 * CalendarView — 日历主客户端组件。
 * 包含视图切换（月/周/日）+ 当前日期 + 新建事件按钮 + 对应视图组件 + 事件弹窗。
 */
export function CalendarView({ wid }: { wid: string }) {
  const t = useTranslations("calendar");
  const router = useRouter();
  const [view, setView] = useState<ViewMode>("month");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogEvent, setDialogEvent] = useState<CalendarEvent | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  /** 根据当前视图和日期计算查询时间范围 */
  const getRange = useCallback((mode: ViewMode, date: Date): { start: Date; end: Date } => {
    if (mode === "month") {
      const start = new Date(date.getFullYear(), date.getMonth(), 1);
      const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);
      return { start, end };
    }
    if (mode === "week") {
      const dayOfWeek = date.getDay();
      const start = new Date(date);
      start.setDate(date.getDate() - dayOfWeek);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 0);
      return { start, end };
    }
    // day
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59);
    return { start, end };
  }, []);

  /** 加载事件 + 任务截止日期（联动显示在日历上） */
  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { start, end } = getRange(view, currentDate);
      // 并行加载日历事件和任务列表（任务用于截止日期联动）
      const [eventData, tasksResp] = await Promise.all([
        api<CalendarEvent[]>(
          `/api/v1/workspaces/${wid}/calendar/events?start=${start.toISOString()}&end=${end.toISOString()}`,
        ).catch((): CalendarEvent[] => []),
        api<TasksListResponse>(
          `/api/v1/workspaces/${wid}/tasks?limit=100`,
        ).catch((): TasksListResponse => ({ items: [], total: 0, hasMore: false })),
      ]);
      // 任务 deadline 转换为虚拟事件，与真实事件合并
      const taskEvents = (tasksResp.items ?? [])
        .map((task) => taskToCalendarEvent(task))
        .filter((e): e is CalendarEvent => e !== null);
      setEvents([...(eventData ?? []), ...taskEvents]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("loadError"));
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [view, currentDate, wid, getRange, t]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  /** 导航回调 */
  const handlePrev = useCallback(() => {
    setCurrentDate((d) => {
      if (view === "month") return addMonths(d, -1);
      if (view === "week") return addWeeks(d, -1);
      return addDays(d, -1);
    });
  }, [view]);

  const handleNext = useCallback(() => {
    setCurrentDate((d) => {
      if (view === "month") return addMonths(d, 1);
      if (view === "week") return addWeeks(d, 1);
      return addDays(d, 1);
    });
  }, [view]);

  const handleToday = useCallback(() => {
    setCurrentDate(new Date());
  }, []);

  /** 事件点击：任务 deadline 跳转任务详情页，普通事件打开编辑弹窗 */
  const handleEventClick = useCallback(
    (event: CalendarEvent) => {
      if (event.source === "task" && event.taskId) {
        router.push(`/w/${wid}/task/${event.taskId}`);
        return;
      }
      setDialogEvent(event);
      setDialogOpen(true);
    },
    [router, wid],
  );

  /** 日期点击（月视图切换到日视图） */
  const handleDayClick = useCallback((date: Date) => {
    setCurrentDate(date);
    setView("day");
  }, []);

  /** 新建事件 */
  const handleNewEvent = useCallback(() => {
    setDialogEvent(null);
    setDialogOpen(true);
  }, []);

  /** 弹窗关闭 */
  const handleDialogClose = useCallback(() => {
    setDialogOpen(false);
    setDialogEvent(null);
  }, []);

  /** 保存成功后刷新 */
  const handleDialogSaved = useCallback(() => {
    loadEvents();
  }, [loadEvents]);

  const viewModes: { key: ViewMode; label: string }[] = [
    { key: "month", label: t("month") },
    { key: "week", label: t("week") },
    { key: "day", label: t("day") },
  ];

  return (
    <div className="flex flex-col h-full p-[var(--space-4)]">
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between mb-[var(--space-4)]">
        <div className="flex items-center gap-[var(--space-2)]">
          <h1 className="text-[length:var(--text-xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)] mr-[var(--space-4)]">
            {t("title")}
          </h1>
          {/* 视图切换 */}
          <div
            className="flex items-center rounded-[var(--radius-md)] overflow-hidden"
            style={{ border: "1px solid var(--border)" }}
          >
            {viewModes.map((vm) => (
              <button
                key={vm.key}
                onClick={() => setView(vm.key)}
                className="px-[var(--space-3)] py-1 text-[length:var(--text-sm)] cursor-pointer"
                style={
                  view === vm.key
                    ? { background: "var(--accent)", color: "var(--accent-fg)" }
                    : { color: "var(--muted)", background: "var(--surface)" }
                }
              >
                {vm.label}
              </button>
            ))}
          </div>
        </div>

        {/* 新建事件按钮 */}
        <button
          onClick={handleNewEvent}
          className="flex items-center gap-1 px-[var(--space-3)] py-2 rounded-[var(--radius-md)] text-[length:var(--text-sm)] cursor-pointer"
          style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
        >
          <Plus size={14} />
          {t("newEvent")}
        </button>
      </div>

      {/* 错误提示 */}
      {error && (
        <div
          className="px-[var(--space-3)] py-2 rounded-[var(--radius-md)] mb-[var(--space-4)] text-[length:var(--text-sm)]"
          style={{ background: "var(--danger-bg)", color: "var(--danger)" }}
        >
          {error}
        </div>
      )}

      {/* 视图内容 */}
      <div className="flex-1 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center h-full text-[var(--muted)]">
            {t("loading")}
          </div>
        ) : view === "month" ? (
          <CalendarMonth
            events={events}
            currentDate={currentDate}
            onPrev={handlePrev}
            onNext={handleNext}
            onToday={handleToday}
            onEventClick={handleEventClick}
            onDayClick={handleDayClick}
          />
        ) : view === "week" ? (
          <CalendarWeek
            events={events}
            currentDate={currentDate}
            onPrev={handlePrev}
            onNext={handleNext}
            onToday={handleToday}
            onEventClick={handleEventClick}
          />
        ) : (
          <CalendarDay
            events={events}
            currentDate={currentDate}
            onPrev={handlePrev}
            onNext={handleNext}
            onToday={handleToday}
            onEventClick={handleEventClick}
          />
        )}
      </div>

      {/* 事件编辑弹窗 */}
      {dialogOpen && (
        <CalendarEventDialog
          wid={wid}
          event={dialogEvent}
          onClose={handleDialogClose}
          onSaved={handleDialogSaved}
        />
      )}
    </div>
  );
}