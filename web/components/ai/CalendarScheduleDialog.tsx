"use client";

/**
 * AI 日历智能排程弹窗 —— 用户输入自然语言排程需求，调用
 * /api/v1/ai/calendar-schedule 生成 1-3 个排程建议，用户可"采纳"某方案。
 *
 * 交互流程：
 *  1. 打开弹窗，输入描述（必填）+ 期望时长（可选）
 *  2. 点击"生成排程" → 调用 AI 接口，显示 loading
 *  3. 返回后排程建议列表（title/时间/时长/reason/conflicts）
 *  4. 每个建议有"采纳"按钮 → onSchedule(suggestion) + onClose
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { CalendarClock, X, Loader2, Check, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/Toast";

/** 单个排程建议（与 API 返回结构对齐） */
interface ScheduleSuggestion {
  title: string;
  startTime: string;
  endTime: string;
  duration: number;
  reason: string;
  conflicts: string | null;
}

/** AI 排程结果 */
interface CalendarScheduleResult {
  suggestions: ScheduleSuggestion[];
}

interface CalendarScheduleDialogProps {
  wid: string;
  open: boolean;
  onClose: () => void;
  onSchedule?: (suggestion: {
    title: string;
    startTime: string;
    endTime: string;
    duration: number;
  }) => void;
}

/** ISO 8601 → "MM-DD HH:MM" 可读格式；解析失败回退原字符串 */
function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

const fieldControl =
  "w-full h-9 px-2.5 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]";

export default function CalendarScheduleDialog({
  wid,
  open,
  onClose,
  onSchedule,
}: CalendarScheduleDialogProps) {
  const t = useTranslations("ai.calendarSchedule");
  const tButton = useTranslations("button");
  const { toast } = useToast();

  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState<ScheduleSuggestion[]>([]);

  // AbortController：组件卸载时中止进行中的请求
  // 来源：经验 2026-09-12-abortcontroller-timeout-cleartimeout-finally-block
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // ── Escape 关闭 ──
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, loading]);

  // ── 关闭时重置状态 ──
  useEffect(() => {
    if (!open) {
      setDescription("");
      setDuration("");
      setLoading(false);
      setError("");
      setSuggestions([]);
      abortRef.current?.abort();
    }
  }, [open]);

  if (!open) return null;

  async function generate() {
    const desc = description.trim();
    if (!desc) {
      // 用专用错误 key 而非 placeholder 文案
      toast("error", t("descriptionRequired"));
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError("");
    setSuggestions([]);
    try {
      const payload: { wid: string; description: string; duration?: number } = {
        wid,
        description: desc,
      };
      const dur = Number(duration);
      if (duration && Number.isFinite(dur) && dur >= 5 && dur <= 480) {
        payload.duration = Math.round(dur);
      }
      const result = await api<CalendarScheduleResult>(
        "/api/v1/ai/calendar-schedule",
        {
          method: "POST",
          body: JSON.stringify(payload),
          signal: ac.signal,
        },
      );
      if (ac.signal.aborted) return;
      setSuggestions(result.suggestions ?? []);
    } catch (e) {
      if (ac.signal.aborted || (e instanceof Error && e.name === "AbortError")) return;
      // 不直接显示后端 error.message，用 i18n 错误提示
      setError(t("generateFailed"));
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }

  function adopt(s: ScheduleSuggestion) {
    onSchedule?.({
      title: s.title,
      startTime: s.startTime,
      endTime: s.endTime,
      duration: s.duration,
    });
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-calendar-schedule-title"
      className="fixed inset-0 z-[var(--z-modal)] flex items-start justify-center p-4 sm:p-8 overflow-y-auto bg-[var(--overlay)]"
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        if (!loading) onClose();
      }}
    >
      <div className="w-full max-w-2xl my-auto bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-lg)]">
        {/* ── 头部 ── */}
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-soft)]">
          <h2
            id="ai-calendar-schedule-title"
            className="flex items-center gap-2 text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]"
          >
            <CalendarClock size={16} className="text-[var(--accent)]" />
            {t("title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] disabled:opacity-50"
            aria-label={tButton("close")}
          >
            <X size={16} />
          </button>
        </header>

        {/* ── 正文 ── */}
        <div className="px-5 py-4 space-y-[var(--space-3)]">
          {/* 描述输入 */}
          <div>
            <label
              className="block text-[length:var(--text-xs)] text-[var(--muted)] mb-1"
              htmlFor="calendar-schedule-desc"
            >
              {t("descriptionLabel")}
            </label>
            <textarea
              id="calendar-schedule-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder={t("descriptionPlaceholder")}
              className="w-full px-2.5 py-2 resize-y border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)]"
            />
          </div>

          {/* 期望时长输入 */}
          <div>
            <label
              className="block text-[length:var(--text-xs)] text-[var(--muted)] mb-1"
              htmlFor="calendar-schedule-duration"
            >
              {t("durationLabel")}
            </label>
            <div className="flex items-center gap-2">
              <input
                id="calendar-schedule-duration"
                type="number"
                min={5}
                max={480}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder={t("durationPlaceholder")}
                className={`${fieldControl} w-32`}
              />
              <span className="text-[length:var(--text-sm)] text-[var(--muted)]">
                {t("durationUnit")}
              </span>
            </div>
          </div>

          {/* 生成按钮 */}
          <button
            type="button"
            onClick={generate}
            disabled={loading || !description.trim()}
            className="inline-flex items-center gap-1.5 h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            {loading ? t("generating") : t("generate")}
          </button>

          {/* 错误态 */}
          {error && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-sm)]">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span className="flex-1">{error}</span>
              <button
                type="button"
                onClick={() => setError("")}
                className="shrink-0 opacity-60 hover:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] rounded-[var(--radius-sm)]"
                aria-label={t("close")}
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* 排程建议列表 */}
          {!loading && !error && suggestions.length > 0 && (
            <div className="space-y-2">
              <p className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
                {t("suggestions")}
              </p>
              <ul className="space-y-[var(--space-3)]">
                {suggestions.map((s, idx) => (
                  <li
                    key={`${s.startTime}_${s.title}_${idx}`}
                    className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-3)]"
                  >
                    <div className="flex items-start justify-between gap-[var(--space-3)]">
                      <div className="flex-1 min-w-0 space-y-1.5">
                        {/* 标题 */}
                        <p className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
                          {s.title}
                        </p>
                        {/* 时间段 */}
                        <p className="text-[length:var(--text-xs)] text-[var(--muted)] tabular-nums">
                          {formatTime(s.startTime)} — {formatTime(s.endTime)}
                          <span className="mx-1.5 opacity-50">·</span>
                          {s.duration} {t("durationUnit")}
                        </p>
                        {/* 推荐理由 */}
                        {s.reason && (
                          <p className="text-[length:var(--text-xs)] text-[var(--fg-2)]">
                            {s.reason}
                          </p>
                        )}
                        {/* 冲突信息 */}
                        {s.conflicts ? (
                          <p className="flex items-center gap-1 text-[length:var(--text-xs)] text-[var(--warn)]">
                            <AlertTriangle size={14} className="shrink-0" />
                            <span>
                              {t("conflict")}：{s.conflicts}
                            </span>
                          </p>
                        ) : (
                          <p className="text-[length:var(--text-xs)] text-[var(--success)]">
                            {t("noConflict")}
                          </p>
                        )}
                      </div>
                      {/* 采纳按钮 */}
                      <button
                        type="button"
                        onClick={() => adopt(s)}
                        disabled={loading}
                        className="shrink-0 inline-flex items-center gap-1 h-8 px-3 rounded-[var(--radius-sm)] bg-[var(--surface-2)] text-[var(--fg)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent)] hover:text-[var(--accent-fg)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] disabled:opacity-50"
                      >
                        <Check size={14} />
                        {t("adopt")}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 空建议态 */}
          {!loading && !error && suggestions.length === 0 && (
            <p className="text-[length:var(--text-sm)] text-[var(--muted)] py-6 text-center">
              {t("noSuggestions")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}