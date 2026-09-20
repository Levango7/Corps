"use client";

/**
 * 聊天面板标题栏 · client 交互部分
 *
 * 负责：搜索按钮 onClick、搜索框 onChange/onKeyDown
 * 包含标题行和搜索框的完整布局
 */

import { MessageCircle, Search, X } from "lucide-react";

interface ChatHeaderClientProps {
  messageCount: number;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  searchOpen: boolean;
  onToggleSearch: () => void;
  titleLabel: string;
  searchLabel: string;
}

export function ChatHeaderClient({
  messageCount,
  searchQuery,
  onSearchChange,
  searchOpen,
  onToggleSearch,
  titleLabel,
  searchLabel,
}: ChatHeaderClientProps) {
  return (
    <>
      <div className="flex items-center justify-between mb-[var(--space-2)]">
        <h2 className="flex items-center gap-[var(--space-2)] text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
          <MessageCircle size={16} className="text-[var(--muted)]" />
          {titleLabel}
          {messageCount > 0 && (
            <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-regular)] text-[var(--meta)]">
              {messageCount}
            </span>
          )}
        </h2>
        <button
          onClick={onToggleSearch}
          aria-label={searchLabel}
          className="inline-flex items-center justify-center w-7 h-7 rounded-[var(--radius-md)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)]"
        >
          {searchOpen ? <X size={14} /> : <Search size={14} />}
        </button>
      </div>

      {/* 搜索框 */}
      {searchOpen && (
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onSearchChange("");
              onToggleSearch();
            }
          }}
          placeholder={searchLabel}
          autoFocus
          className="w-full h-9 px-[var(--space-3)] mb-[var(--space-2)] border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface-2)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:border-[var(--accent)] placeholder:text-[var(--meta)] transition-colors duration-[var(--motion-fast)]"
        />
      )}
    </>
  );
}
