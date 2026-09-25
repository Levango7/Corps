"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { X, Save, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";

/** 日历事件类型（与 API 返回一致） */
export interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string;
  allDay: boolean;
  location: string | null;
  color: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /**
   * 事件来源标记：
   *  - "event"（默认）：真实日历事件，可编辑/删除
   *  - "task"：任务截止日期联动生成的虚拟事件，点击跳转任务详情页
   * 用于子视图区分渲染样式与点击行为。
   */
  source?: "event" | "task";
  /** 当 source === "task" 时关联的任务 ID（用于跳转任务详情页） */
  taskId?: string;
}

/** 将 ISO 字符串转为 datetime-local input 所需格式 yyyy-MM-ddTHH:mm */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 将 datetime-local 值转为 ISO 字符串 */
function fromLocalInput(local: string): string {
  return new Date(local).toISOString();
}

/**
 * CalendarEventDialog — 日历事件编辑弹窗。
 * 支持新建（event=null）和编辑（event=已存在事件）模式。
 * 保存调用 POST/PATCH，删除调用 DELETE。
 */
export function CalendarEventDialog({
  wid,
  event,
  onClose,
  onSaved,
}: {
  wid: string;
  event: CalendarEvent | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("calendar");
  const isEdit = event !== null;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [location, setLocation] = useState("");
  const [color, setColor] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 初始化表单字段
  useEffect(() => {
    if (event) {
      setTitle(event.title);
      setDescription(event.description ?? "");
      setStartAt(toLocalInput(event.startAt));
      setEndAt(toLocalInput(event.endAt));
      setAllDay(event.allDay);
      setLocation(event.location ?? "");
      setColor(event.color ?? "");
    } else {
      // 新建：默认开始时间为当前整点，结束时间为下一小时
      const now = new Date();
      now.setMinutes(0, 0, 0);
      const later = new Date(now.getTime() + 60 * 60 * 1000);
      setTitle("");
      setDescription("");
      setStartAt(toLocalInput(now.toISOString()));
      setEndAt(toLocalInput(later.toISOString()));
      setAllDay(false);
      setLocation("");
      setColor("");
    }
    setError(null);
  }, [event]);

  // ESC 键关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSave = useCallback(async () => {
    if (!title.trim()) {
      setError(t("eventTitle"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || undefined,
        startAt: fromLocalInput(startAt),
        endAt: fromLocalInput(endAt),
        allDay,
        location: location.trim() || undefined,
        color: color.trim() || undefined,
      };
      if (isEdit && event) {
        await api(`/api/v1/workspaces/${wid}/calendar/events/${event.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await api(`/api/v1/workspaces/${wid}/calendar/events`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("saveError"));
    } finally {
      setSaving(false);
    }
  }, [
    title,
    description,
    startAt,
    endAt,
    allDay,
    location,
    color,
    isEdit,
    event,
    wid,
    t,
    onSaved,
    onClose,
  ]);

  const handleDelete = useCallback(async () => {
    if (!event) return;
    if (!window.confirm(t("deleteConfirm"))) return;
    setDeleting(true);
    setError(null);
    try {
      await api(`/api/v1/workspaces/${wid}/calendar/events/${event.id}`, {
        method: "DELETE",
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("saveError"));
    } finally {
      setDeleting(false);
    }
  }, [event, wid, t, onSaved, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "color-mix(in srgb, var(--fg) 40%, transparent)" }}
      onClick={onClose}
    >
      <div
        className="w-[480px] max-w-[90vw] max-h-[90vh] overflow-y-auto rounded-[var(--radius-lg)] p-[var(--space-6)]"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between mb-[var(--space-4)]">
          <h2 className="text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
            {isEdit ? t("editEvent") : t("newEvent")}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-[var(--radius-sm)] cursor-pointer"
            style={{ color: "var(--muted)" }}
            aria-label="close"
          >
            <X size={16} />
          </button>
        </div>

        {/* 表单 */}
        <div className="flex flex-col gap-[var(--space-4)]">
          {/* 标题 */}
          <div className="flex flex-col gap-1">
            <label className="text-[length:var(--text-sm)] text-[var(--muted)]">
              {t("eventTitle")}
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              className="px-[var(--space-3)] py-2 rounded-[var(--radius-md)] text-[var(--fg)] outline-none"
              style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
            />
          </div>

          {/* 描述 */}
          <div className="flex flex-col gap-1">
            <label className="text-[length:var(--text-sm)] text-[var(--muted)]">
              {t("eventDescription")}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="px-[var(--space-3)] py-2 rounded-[var(--radius-md)] text-[var(--fg)] outline-none resize-none"
              style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
            />
          </div>

          {/* 全天 */}
          <label className="flex items-center gap-2 cursor-pointer text-[length:var(--text-sm)] text-[var(--fg)]">
            <input
              type="checkbox"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
              className="cursor-pointer"
            />
            {t("allDay")}
          </label>

          {/* 开始/结束时间 */}
          <div className="grid grid-cols-2 gap-[var(--space-3)]">
            <div className="flex flex-col gap-1">
              <label className="text-[length:var(--text-sm)] text-[var(--muted)]">
                {t("startDate")}
              </label>
              <input
                type="datetime-local"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
                className="px-[var(--space-3)] py-2 rounded-[var(--radius-md)] text-[var(--fg)] outline-none"
                style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[length:var(--text-sm)] text-[var(--muted)]">
                {t("endDate")}
              </label>
              <input
                type="datetime-local"
                value={endAt}
                onChange={(e) => setEndAt(e.target.value)}
                className="px-[var(--space-3)] py-2 rounded-[var(--radius-md)] text-[var(--fg)] outline-none"
                style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
              />
            </div>
          </div>

          {/* 地点 */}
          <div className="flex flex-col gap-1">
            <label className="text-[length:var(--text-sm)] text-[var(--muted)]">
              {t("location")}
            </label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              maxLength={500}
              className="px-[var(--space-3)] py-2 rounded-[var(--radius-md)] text-[var(--fg)] outline-none"
              style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
            />
          </div>

          {/* 颜色 */}
          <div className="flex flex-col gap-1">
            <label className="text-[length:var(--text-sm)] text-[var(--muted)]">{t("color")}</label>
            <input
              type="text"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              maxLength={20}
              placeholder="#3b82f6"
              className="px-[var(--space-3)] py-2 rounded-[var(--radius-md)] text-[var(--fg)] outline-none"
              style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
            />
          </div>

          {/* 错误提示 */}
          {error && (
            <p className="text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>
              {error}
            </p>
          )}

          {/* 操作按钮 */}
          <div className="flex items-center justify-between mt-[var(--space-2)]">
            <div>
              {isEdit && (
                <button
                  onClick={handleDelete}
                  disabled={deleting || saving}
                  className="flex items-center gap-1 px-[var(--space-3)] py-2 rounded-[var(--radius-md)] text-[length:var(--text-sm)] cursor-pointer disabled:opacity-50"
                  style={{ color: "var(--danger)", border: "1px solid var(--border)" }}
                >
                  <Trash2 size={14} />
                  {t("deleteEvent")}
                </button>
              )}
            </div>
            <div className="flex items-center gap-[var(--space-3)]">
              <button
                onClick={onClose}
                className="px-[var(--space-3)] py-2 rounded-[var(--radius-md)] text-[length:var(--text-sm)] cursor-pointer text-[var(--muted)]"
                style={{ border: "1px solid var(--border)" }}
              >
                {t("cancel")}
              </button>
              <button
                onClick={handleSave}
                disabled={saving || deleting}
                className="flex items-center gap-1 px-[var(--space-3)] py-2 rounded-[var(--radius-md)] text-[length:var(--text-sm)] cursor-pointer disabled:opacity-50"
                style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
              >
                <Save size={14} />
                {saving ? "…" : t("save")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
