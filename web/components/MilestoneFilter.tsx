"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Milestone as MilestoneIcon, ChevronDown, Loader2, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";
import type { Milestone } from "@/lib/types";

/**
 * 里程碑筛选器（P4：看板标签/里程碑）
 *
 * 下拉选择里程碑，筛选时只显示该里程碑下的任务。
 * "all" 表示全部，"null" 表示未归入里程碑的任务。
 *
 * R9B-03：listbox 添加 max-h + overflow-y-auto 防止选项过多溢出视口
 * R9B-04：加载失败时显示错误提示而非静默空
 * R9B-05：Escape 关闭、箭头导航、focus 管理（打开聚焦当前项/关闭恢复按钮）
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
  // R9B-04：加载失败错误状态
  const [error, setError] = useState(false);

  // R9B-05：focus 管理 refs
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  // 记算当前选中项在选项列表中的索引
  const optionIds = ["all", "null", ...(milestones.length > 0 ? milestones.map((m) => m.id) : [])];
  const selectedIndex = optionIds.indexOf(value);
  // 箭头导航的活跃索引
  const [, setActiveIndex] = useState(-1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    api<Milestone[]>(`/api/v1/workspaces/${wid}/milestones`)
      .then((data) => {
        if (!cancelled) setMilestones(data);
      })
      .catch(() => {
        if (!cancelled) {
          setMilestones([]);
          setError(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [wid]);

  // R9B-05：打开下拉时聚焦当前选中项
  useEffect(() => {
    if (open && listboxRef.current) {
      const idx = selectedIndex >= 0 ? selectedIndex : 0;
      setActiveIndex(idx);
      // 延迟一帧让 DOM 渲染后再聚焦
      requestAnimationFrame(() => {
        const buttons = listboxRef.current?.querySelectorAll('[role="option"]');
        (buttons?.[idx] as HTMLElement | undefined)?.focus();
      });
    } else {
      setActiveIndex(-1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // R9B-05：Escape 关闭 + 箭头导航
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open) return;
      const count = optionIds.length;
      if (count === 0) return;

      switch (e.key) {
        case "Escape":
          e.preventDefault();
          setOpen(false);
          triggerRef.current?.focus();
          break;
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((prev) => {
            const next = prev < 0 ? 0 : (prev + 1) % count;
            const buttons = listboxRef.current?.querySelectorAll('[role="option"]');
            (buttons?.[next] as HTMLElement | undefined)?.focus();
            return next;
          });
          break;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((prev) => {
            const next = prev < 0 ? 0 : (prev - 1 + count) % count;
            const buttons = listboxRef.current?.querySelectorAll('[role="option"]');
            (buttons?.[next] as HTMLElement | undefined)?.focus();
            return next;
          });
          break;
        case "Home":
          e.preventDefault();
          setActiveIndex(0);
          {
            const buttons = listboxRef.current?.querySelectorAll('[role="option"]');
            (buttons?.[0] as HTMLElement | undefined)?.focus();
          }
          break;
        case "End":
          e.preventDefault();
          setActiveIndex(count - 1);
          {
            const buttons = listboxRef.current?.querySelectorAll('[role="option"]');
            (buttons?.[count - 1] as HTMLElement | undefined)?.focus();
          }
          break;
      }
    },
    [open, optionIds.length],
  );

  // 选项点击处理
  const handleSelect = useCallback(
    (v: string) => {
      onChange(v);
      setOpen(false);
      triggerRef.current?.focus();
    },
    [onChange],
  );

  // 加载中显示 spinner 占位（L2）
  if (loading) {
    return (
      <div className="flex items-center gap-2 h-9 px-3 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--muted)]">
        <Loader2 size={14} className="animate-spin" />
        <span className="hidden sm:inline">{t("filterLabel")}</span>
      </div>
    );
  }

  // R9B-04：加载失败显示错误提示
  if (error) {
    return (
      <div
        className="flex items-center gap-2 h-9 px-3 border border-[var(--danger)] rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[length:var(--text-sm)] text-[var(--danger)]"
        title={t("filterError")}
      >
        <AlertTriangle size={14} className="shrink-0" />
        <span className="hidden sm:inline truncate">{t("filterError")}</span>
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
    <div className="relative" onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        disabled={loading}
        className="flex items-center gap-2 h-9 px-3 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-fast)]"
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
            ref={listboxRef}
            role="listbox"
            tabIndex={-1}
            className="absolute top-full left-0 mt-1 min-w-[200px] max-h-[60vh] overflow-y-auto z-[calc(var(--z-dropdown)+1)] bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-md)] shadow-[var(--elev-md)] py-1"
          >
            <button
              role="option"
              aria-selected={value === "all"}
              onClick={() => handleSelect("all")}
              className={`w-full text-left px-3 py-1.5 text-[length:var(--text-sm)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] ${
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
              onClick={() => handleSelect("null")}
              className={`w-full text-left px-3 py-1.5 text-[length:var(--text-sm)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] ${
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
                onClick={() => handleSelect(m.id)}
                className={`w-full text-left px-3 py-1.5 text-[length:var(--text-sm)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] ${
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
