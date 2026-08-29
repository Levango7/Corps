"use client";

/**
 * 看板视图切换按钮组 —— 共享组件。
 *
 * board 页曾有两套几乎相同的代码（< sm 仅图标 / ≥ sm 带文案），
 * 合并为单套响应式实现：图标始终显示，文案 sm 起显示。
 */

import { Kanban, List } from "lucide-react";
import type { ViewMode } from "./types";
import { useTranslations } from "next-intl";

interface ViewToggleProps {
  view: ViewMode;
  onChange: (v: ViewMode) => void;
}

export function ViewToggle({ view, onChange }: ViewToggleProps) {
  const t = useTranslations("task");
  return (
    <div
      className="inline-flex items-center gap-1 p-1 bg-[var(--surface-2)] rounded-[var(--radius-md)]"
      role="group"
      aria-label={t("viewAria")}
    >
      <button
        onClick={() => onChange("board")}
        aria-pressed={view === "board"}
        className={`flex items-center gap-1.5 p-2 sm:px-3 rounded-[var(--radius-sm)] text-sm transition-colors ${
          view === "board"
            ? "bg-[var(--surface)] text-[var(--fg)] shadow-[var(--elev-sm)]"
            : "text-[var(--muted)] hover:text-[var(--fg)]"
        }`}
        aria-label={t("boardViewAria")}
      >
        <Kanban size={16} />
        <span className="hidden sm:inline">{t("boardView")}</span>
      </button>
      <button
        onClick={() => onChange("list")}
        aria-pressed={view === "list"}
        className={`flex items-center gap-1.5 p-2 sm:px-3 rounded-[var(--radius-sm)] text-sm transition-colors ${
          view === "list"
            ? "bg-[var(--surface)] text-[var(--fg)] shadow-[var(--elev-sm)]"
            : "text-[var(--muted)] hover:text-[var(--fg)]"
        }`}
        aria-label={t("listViewAria")}
      >
        <List size={16} />
        <span className="hidden sm:inline">{t("listView")}</span>
      </button>
    </div>
  );
}
