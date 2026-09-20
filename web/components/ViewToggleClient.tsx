"use client";

/**
 * 看板视图切换按钮组 · client 交互部分
 *
 * 负责：按钮 onClick 事件处理、视图切换
 */

import { Kanban, List } from "lucide-react";
import type { ViewMode } from "./types";

interface ViewToggleClientProps {
  view: ViewMode;
  onChange: (v: ViewMode) => void;
  viewAria: string;
  boardViewAria: string;
  boardView: string;
  listViewAria: string;
  listView: string;
}

export function ViewToggleClient({
  view,
  onChange,
  viewAria,
  boardViewAria,
  boardView,
  listViewAria,
  listView,
}: ViewToggleClientProps) {
  return (
    <div
      className="inline-flex items-center gap-1 p-1 bg-[var(--surface-2)] rounded-[var(--radius-md)]"
      role="group"
      aria-label={viewAria}
    >
      <button
        type="button"
        onClick={() => onChange("board")}
        aria-pressed={view === "board"}
        className={`flex items-center gap-1.5 p-2 sm:px-3 rounded-[var(--radius-sm)] text-[length:var(--text-sm)] transition-colors duration-[var(--motion-fast)] ${
          view === "board"
            ? "bg-[var(--surface)] text-[var(--fg)] shadow-[var(--elev-sm)]"
            : "text-[var(--muted)] hover:text-[var(--fg)]"
        }`}
        aria-label={boardViewAria}
      >
        <Kanban size={16} />
        <span className="hidden sm:inline">{boardView}</span>
      </button>
      <button
        type="button"
        onClick={() => onChange("list")}
        aria-pressed={view === "list"}
        className={`flex items-center gap-1.5 p-2 sm:px-3 rounded-[var(--radius-sm)] text-[length:var(--text-sm)] transition-colors duration-[var(--motion-fast)] ${
          view === "list"
            ? "bg-[var(--surface)] text-[var(--fg)] shadow-[var(--elev-sm)]"
            : "text-[var(--muted)] hover:text-[var(--fg)]"
        }`}
        aria-label={listViewAria}
      >
        <List size={16} />
        <span className="hidden sm:inline">{listView}</span>
      </button>
    </div>
  );
}