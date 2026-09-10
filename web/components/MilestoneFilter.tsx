"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Milestone as MilestoneIcon, ChevronDown, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import type { Milestone } from "@/lib/types";

/**
 * 里程碑筛选器（P4：看板标签/里程碑）
 *
 * 下拉选择里程碑，筛选时只显示该里程碑下的任务。
 * "all" 表示全部，"null" 表示未归入里程碑的任务。
 */
export function MilestoneFilter({
  wid,
  value,
  onChange,
}: {
  wid: string;
  value: string; // "all" | "null" | milestoneId
  onChange: (v: string) => void;
}) {
  const t = useTranslations("milestone");
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [open, setOpen] = useState(false);
  // L2 修复：加载中状态，用于显示 spinner 占位
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api<Milestone[]>(`/api/v1/workspaces/${wid}/milestones`)
      .then((data) => {
        if (!cancelled) setMilestones(data);
      })
      .catch(() => {
        if (!cancelled) setMilestones([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [wid]);

  // 加载中显示 spinner 占位（L2）
  if (loading) {
    return (
      <div className="flex items-center gap-2 h-9 px-3 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--muted)]">
        <Loader2 size={14} className="animate-spin" />
        <span className="hidden sm:inline">{t("filterLabel")}</span>
      </div>
    );
  }

  // 无里程碑时折叠为占位（不占视觉空间）
  if (milestones.length === 0) return null;

  const current =
    value === "all"
      ? t("filterAll")
      : value === "null"
        ? t("filterUnassigned")
        : (milestones.find((m) => m.id === value)?.name ?? t("filterAll"));

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={loading}
        className="flex items-center gap-2 h-9 px-3 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <MilestoneIcon size={15} className="text-[var(--muted)]" />
        <span className="hidden sm:inline">{t("filterLabel")}</span>
        <span className="font-[weight:var(--weight-medium)] text-[var(--fg)]">{current}</span>
        <ChevronDown size={14} className="text-[var(--meta)]" />
      </button>

      {open && (
        <>
          {/* 点击外部关闭 */}
          <div className="fixed inset-0 z-[var(--z-dropdown)]" onClick={() => setOpen(false)} />
          <div
            role="listbox"
            className="absolute top-full left-0 mt-1 min-w-[200px] z-[calc(var(--z-dropdown)+1)] bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-md)] shadow-[var(--elev-md)] py-1"
          >
            <button
              role="option"
              aria-selected={value === "all"}
              onClick={() => {
                onChange("all");
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-1.5 text-[length:var(--text-sm)] hover:bg-[var(--surface-2)] transition-colors ${
                value === "all"
                  ? "text-[var(--accent)] font-[weight:var(--weight-medium)]"
                  : "text-[var(--fg-2)]"
              }`}
            >
              {t("filterAll")}
            </button>
            <button
              role="option"
              aria-selected={value === "null"}
              onClick={() => {
                onChange("null");
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-1.5 text-[length:var(--text-sm)] hover:bg-[var(--surface-2)] transition-colors ${
                value === "null"
                  ? "text-[var(--accent)] font-[weight:var(--weight-medium)]"
                  : "text-[var(--fg-2)]"
              }`}
            >
              {t("filterUnassigned")}
            </button>
            <div className="my-1 border-t border-[var(--border-soft)]" />
            {milestones.map((m) => (
              <button
                key={m.id}
                role="option"
                aria-selected={value === m.id}
                onClick={() => {
                  onChange(m.id);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-1.5 text-[length:var(--text-sm)] hover:bg-[var(--surface-2)] transition-colors ${
                  value === m.id
                    ? "text-[var(--accent)] font-[weight:var(--weight-medium)]"
                    : "text-[var(--fg-2)]"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{m.name}</span>
                  {m.dueDate && (
                    <span className="text-[length:var(--text-xs)] text-[var(--meta)] shrink-0">
                      {new Date(m.dueDate).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
