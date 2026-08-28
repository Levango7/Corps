"use client";

import { MessageCircle, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Person } from "./types";

/**
 * 聊天面板标题栏 + 搜索按钮 + 在线状态栏
 *
 * - 标题区：💬 聊天 + 消息计数
 * - 搜索按钮：点击展开搜索框
 * - 在线状态栏：在线成员头像列表（绿点指示）
 */

interface ChatHeaderProps {
  /** 消息总数 */
  messageCount: number;
  /** 在线用户 ID 集合 */
  onlineUsers: Set<string>;
  /** 工作区成员列表（用于显示在线头像） */
  members: Person[];
  /** 搜索关键词 */
  searchQuery: string;
  /** 搜索关键词变更 */
  onSearchChange: (query: string) => void;
  /** 搜索框是否展开 */
  searchOpen: boolean;
  /** 切换搜索框展开状态 */
  onToggleSearch: () => void;
}

export function ChatHeader({
  messageCount,
  onlineUsers,
  members,
  searchQuery,
  onSearchChange,
  searchOpen,
  onToggleSearch,
}: ChatHeaderProps) {
  const t = useTranslations("chat");

  // 在线成员列表（按 onlineUsers 过滤）
  const onlineMembers = members.filter((m) => onlineUsers.has(m.id));

  return (
    <div className="mb-[var(--space-3)]">
      <div className="flex items-center justify-between mb-[var(--space-2)]">
        <h2 className="flex items-center gap-[var(--space-2)] text-[length:var(--text-md)] font-[var(--weight-semibold)] text-[var(--fg)]">
          <MessageCircle size={16} className="text-[var(--muted)]" />
          {t("title")}
          {messageCount > 0 && (
            <span className="text-[length:var(--text-sm)] font-[var(--weight-regular)] text-[var(--meta)]">
              {messageCount}
            </span>
          )}
        </h2>
        <button
          onClick={onToggleSearch}
          aria-label={t("search")}
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
          placeholder={t("search")}
          autoFocus
          className="w-full h-9 px-[var(--space-3)] mb-[var(--space-2)] border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface-2)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:border-[var(--accent)] placeholder:text-[var(--meta)] transition-colors duration-[var(--motion-fast)]"
        />
      )}

      {/* 在线状态栏 */}
      {onlineMembers.length > 0 && (
        <div className="flex items-center gap-[var(--space-2)] flex-wrap">
          <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
            {t("online")}
          </span>
          {onlineMembers.slice(0, 5).map((m) => (
            <div
              key={m.id}
              className="relative shrink-0"
              title={m.name || m.email}
            >
              <div className="w-6 h-6 rounded-full bg-[var(--surface-3)] text-[var(--fg-2)] flex items-center justify-center text-[length:var(--text-xs)] font-[var(--weight-medium)] overflow-hidden">
                {m.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={m.image}
                    alt={m.name || m.email}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  (m.name || m.email)[0]?.toUpperCase()
                )}
              </div>
              {/* 在线绿点 */}
              <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-[var(--accent-success)] ring-2 ring-[var(--surface)]" />
            </div>
          ))}
          {onlineMembers.length > 5 && (
            <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
              +{onlineMembers.length - 5}
            </span>
          )}
        </div>
      )}
    </div>
  );
}