"use client";

/**
 * TimeEntryList — 工时记录列表
 *
 * 显示：开始时间 / 结束时间 / 时长 / 描述 / 关联任务 / 计费标记
 * 支持编辑（description / billable / hourlyRate / duration）和删除
 *
 * 数据流：
 *  - GET /time-entries?limit=50 → 列表
 *  - PATCH /time-entries/{teid} → 更新
 *  - DELETE /time-entries/{teid} → 删除
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Clock, Edit3, Trash2, Loader2, Check, X, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { formatDuration } from "./TimeTracker";

interface TimeEntry {
  id: string;
  userId: string;
  taskId: string | null;
  startTime: string;
  endTime: string | null;
  duration: number | null;
  description: string | null;
  billable: boolean;
  hourlyRate: number | null;
  user?: { id: string; name: string | null; email: string } | null;
  task?: { id: string; title: string } | null;
}

export function TimeEntryList({ wid, refreshKey }: { wid: string; refreshKey?: number }) {
  const t = useTranslations("timetrack");
  const [items, setItems] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await api<{ items: TimeEntry[] }>(
          `/api/v1/workspaces/${wid}/time-entries?limit=50`,
        );
        if (!cancelled) setItems(data.items || []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t("loadFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wid, refreshKey, t]);

  async function handleDelete(id: string) {
    if (!window.confirm(t("confirmDelete"))) return;
    try {
      await api(`/api/v1/workspaces/${wid}/time-entries/${id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((e) => e.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("deleteFailed"));
    }
  }

  async function handleRefresh() {
    setLoading(true);
    setError("");
    try {
      const data = await api<{ items: TimeEntry[] }>(
        `/api/v1/workspaces/${wid}/time-entries?limit=50`,
      );
      setItems(data.items || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-soft)]">
        <h2 className="flex items-center gap-2 text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
          <Clock size={16} className="text-[var(--muted)]" />
          {t("entry")}
        </h2>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)]"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {error && <p className="px-4 py-2 text-[length:var(--text-sm)] text-[var(--danger)]">{error}</p>}

      {loading ? (
        <div className="py-8 text-center text-[var(--muted)]">
          <Loader2 size={16} className="inline animate-spin mr-2" />
          <span className="text-[length:var(--text-sm)]">{t("loading")}</span>
        </div>
      ) : items.length === 0 ? (
        <div className="py-10 text-center text-[var(--muted)]">
          <Clock size={28} className="mx-auto mb-2 opacity-50" />
          <p className="text-[length:var(--text-sm)]">{t("noEntries")}</p>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--border-soft)]">
          {items.map((e) => (
            <li key={e.id}>
              {editingId === e.id ? (
                <EditRow
                  entry={e}
                  wid={wid}
                  onCancel={() => setEditingId(null)}
                  onSaved={(updated) => {
                    setItems((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
                    setEditingId(null);
                  }}
                />
              ) : (
                <div className="flex items-start gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)] tabular-nums">
                        {formatDuration(
                          e.duration ??
                            Math.floor((Date.now() - new Date(e.startTime).getTime()) / 1000),
                        )}
                      </span>
                      {e.billable && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--success-soft)] text-[length:var(--text-xs)] text-[var(--success)]">
                          {t("billableYes")}
                        </span>
                      )}
                      {!e.endTime && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--accent-soft)] text-[length:var(--text-xs)] text-[var(--accent)]">
                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
                          {t("running")}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-[length:var(--text-xs)] text-[var(--muted)] space-y-0.5">
                      <div>
                        {t("startTime")}: {new Date(e.startTime).toLocaleString()}
                        {e.endTime && (
                          <> · {t("endTime")}: {new Date(e.endTime).toLocaleString()}</>
                        )}
                      </div>
                      {e.task && (
                        <div>
                          {t("task")}: <span className="text-[var(--fg-2)]">{e.task.title}</span>
                        </div>
                      )}
                      {e.description && (
                        <div className="text-[var(--fg-2)]">{e.description}</div>
                      )}
                      {e.hourlyRate != null && e.hourlyRate > 0 && (
                        <div>
                          {t("hourlyRate")}: {e.hourlyRate}/h
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setEditingId(e.id)}
                      className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)]"
                      aria-label={t("edit")}
                    >
                      <Edit3 size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(e.id)}
                      className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] transition-colors duration-[var(--motion-fast)]"
                      aria-label={t("delete")}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 内联编辑行 */
function EditRow({
  entry,
  wid,
  onCancel,
  onSaved,
}: {
  entry: TimeEntry;
  wid: string;
  onCancel: () => void;
  onSaved: (updated: TimeEntry) => void;
}) {
  const t = useTranslations("timetrack");
  const [description, setDescription] = useState(entry.description ?? "");
  const [billable, setBillable] = useState(entry.billable);
  const [hourlyRate, setHourlyRate] = useState(entry.hourlyRate ? String(entry.hourlyRate) : "");
  const [duration, setDuration] = useState(entry.duration ? String(entry.duration) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const updated = await api<TimeEntry>(`/api/v1/workspaces/${wid}/time-entries/${entry.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          description: description.trim() || null,
          billable,
          hourlyRate: hourlyRate ? Number(hourlyRate) : null,
          duration: duration ? Math.floor(Number(duration)) : null,
        }),
      });
      onSaved(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  const fieldControl =
    "w-full h-9 px-2.5 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]";

  return (
    <div className="px-4 py-3 bg-[var(--surface-2)] space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--meta)] mb-1.5">
            {t("duration")} (s)
          </label>
          <input
            type="number"
            min="0"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            className={fieldControl}
          />
        </div>
        <div>
          <label className="flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--meta)] mb-1.5">
            {t("hourlyRate")}
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={hourlyRate}
            onChange={(e) => setHourlyRate(e.target.value)}
            className={fieldControl}
          />
        </div>
      </div>
      <div>
        <label className="flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--meta)] mb-1.5">
          {t("description")}
        </label>
        <input value={description} onChange={(e) => setDescription(e.target.value)} className={fieldControl} />
      </div>
      <div>
        <button
          type="button"
          onClick={() => setBillable(!billable)}
          className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-md)] border text-[length:var(--text-sm)] transition-colors duration-[var(--motion-fast)] ${
            billable
              ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
              : "border-[var(--border)] bg-[var(--surface)] text-[var(--fg-2)]"
          }`}
          aria-pressed={billable}
        >
          <span
            className={`inline-block w-3.5 h-3.5 rounded-[var(--radius-sm)] border ${
              billable ? "border-[var(--accent)] bg-[var(--accent)]" : "border-[var(--border)]"
            }`}
          />
          {billable ? t("billableYes") : t("billableNo")}
        </button>
      </div>
      {error && <p className="text-[length:var(--text-sm)] text-[var(--danger)]">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface)] transition-colors duration-[var(--motion-fast)]"
        >
          <X size={14} />
          {t("cancel")}
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)]"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          {t("save")}
        </button>
      </div>
    </div>
  );
}