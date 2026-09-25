"use client";

/**
 * OKR 列表组件。
 * 显示目标标题/周期/状态/进度条/关键结果数，支持按周期/状态过滤。
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Loader2, Target } from "lucide-react";
import { api } from "@/lib/api";

export type ObjectiveStatus = "draft" | "active" | "completed" | "archived";

export interface ObjectiveListItem {
  id: string;
  title: string;
  description: string | null;
  ownerId: string | null;
  period: string;
  status: ObjectiveStatus;
  progress: number;
  createdAt: string;
  updatedAt: string;
  owner: { id: string; name: string | null; email: string } | null;
  _count: { keyResults: number };
}

const STATUS_COLORS: Record<ObjectiveStatus, string> = {
  draft: "var(--muted)",
  active: "var(--accent)",
  completed: "var(--success)",
  archived: "var(--meta)",
};

export function OKRList({
  wid,
  onSelect,
  selectedId,
  onCreate,
}: {
  wid: string;
  onSelect: (id: string) => void;
  selectedId?: string | null;
  onCreate: () => void;
}) {
  const t = useTranslations("okr");
  const [items, setItems] = useState<ObjectiveListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (period) params.set("period", period);
        if (status) params.set("status", status);
        const data = await api<{ items: ObjectiveListItem[] }>(
          `/api/v1/workspaces/${wid}/objectives?${params.toString()}`,
        );
        if (!cancelled) setItems(data.items);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t("noObjectives"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wid, period, status, t]);

  return (
    <div className="flex flex-col">
      {/* 过滤栏 */}
      <div className="flex items-center gap-2 mb-[var(--space-3)]">
        <input
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          placeholder={t("period")}
          className="h-8 px-2.5 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] w-28 placeholder:text-[var(--meta)]"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="h-8 px-2.5 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
        >
          <option value="">{t("status")}</option>
          <option value="draft">{t("draft")}</option>
          <option value="active">{t("active")}</option>
          <option value="completed">{t("completed")}</option>
          <option value="archived">{t("archived")}</option>
        </select>
        <div className="flex-1" />
        <button
          onClick={onCreate}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] transition-colors duration-[var(--motion-fast)]"
        >
          <Plus size={14} />
          {t("create")}
        </button>
      </div>

      {error && <p className="mb-3 text-[length:var(--text-sm)] text-[var(--danger)]">{error}</p>}

      {loading ? (
        <div className="py-[var(--space-12)] text-center text-[var(--muted)]">
          <Loader2 size={20} className="inline animate-spin mr-2" />
        </div>
      ) : items.length === 0 ? (
        <div className="py-[var(--space-12)] text-center text-[var(--muted)]">
          <Target size={36} className="mx-auto mb-3 opacity-50" />
          <p>{t("noObjectives")}</p>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--border-soft)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
          {items.map((obj) => (
            <li
              key={obj.id}
              onClick={() => onSelect(obj.id)}
              className={`px-[var(--space-4)] py-3 cursor-pointer transition-colors duration-[var(--motion-fast)] ${
                selectedId === obj.id ? "bg-[var(--surface-2)]" : "hover:bg-[var(--surface-2)]"
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className="shrink-0 inline-block w-2 h-2 rounded-full"
                  style={{ background: STATUS_COLORS[obj.status] }}
                />
                <span className="flex-1 min-w-0 text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)] truncate">
                  {obj.title}
                </span>
                <span className="shrink-0 text-[length:var(--text-xs)] text-[var(--muted)] tabular-nums">
                  {obj.period}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-3">
                <div className="flex-1 h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[var(--accent)]"
                    style={{ width: `${Math.round(obj.progress)}%` }}
                  />
                </div>
                <span className="shrink-0 text-[length:var(--text-xs)] text-[var(--meta)] tabular-nums">
                  {Math.round(obj.progress)}%
                </span>
                <span className="shrink-0 text-[length:var(--text-xs)] text-[var(--muted)]">
                  {t("keyResults")} · {obj._count.keyResults}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
