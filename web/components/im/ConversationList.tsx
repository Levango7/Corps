"use client";

/**
 * 会话列表侧栏
 *
 * - 顶部：搜索框 + 创建会话按钮
 * - 列表：按最后消息时间倒序排列，渲染 ConversationItem
 * - 空状态：无会话时显示提示
 *
 * 所有样式走 design token（var(--*)），无裸 hex。
 * lucide-react 图标尺寸用 14/16（项目约定）。
 */

import { useMemo } from "react";
import { Search, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Conversation } from "./types";
import { ConversationItem } from "./ConversationItem";

interface ConversationListProps {
  /** 会话列表 */
  conversations: Conversation[];
  /** 当前选中会话 ID */
  activeId: string | null;
  /** 当前用户 ID（传给 ConversationItem 用于单聊识别对方） */
  currentUserId: string;
  /** 选择会话 */
  onSelect: (id: string) => void;
  /** 点击搜索 */
  onSearch: () => void;
  /** 点击创建会话 */
  onCreate: () => void;
}

export function ConversationList({
  conversations,
  activeId,
  currentUserId,
  onSelect,
  onSearch,
  onCreate,
}: ConversationListProps) {
  const t = useTranslations("chat");

  // 按最后消息时间倒序排列（null 排最后）
  const sorted = useMemo(() => {
    return conversations.slice().sort((a, b) => {
      const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return bTime - aTime;
    });
  }, [conversations]);

  return (
    <div className="flex flex-col h-full bg-[var(--surface)] border-r border-[var(--border)]">
      {/* 顶部工具栏 */}
      <div className="flex items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-3)] border-b border-[var(--border)]">
        {/* 搜索框 */}
        <button
          type="button"
          onClick={onSearch}
          aria-label={t("search")}
          className="flex-1 flex items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] rounded-[var(--radius-md)] bg-[var(--surface-2)] text-[var(--muted)] text-[length:var(--text-sm)] hover:bg-[var(--surface-3)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)] focus-visible:outline-offset-2"
        >
          <Search size={14} className="shrink-0" />
          <span>{t("search")}</span>
        </button>
        {/* 创建会话按钮 */}
        <button
          type="button"
          onClick={onCreate}
          aria-label={t("newConversation")}
          className="shrink-0 w-9 h-9 flex items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)] focus-visible:outline-offset-2"
        >
          <Plus size={16} />
        </button>
      </div>

      {/* 会话列表 */}
      <div className="flex-1 overflow-y-auto p-[var(--space-2)] space-y-[var(--space-1)]">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-[var(--space-4)]">
            <p className="text-[length:var(--text-sm)] text-[var(--muted)]">
              {t("empty")}
            </p>
          </div>
        ) : (
          sorted.map((conv) => (
            <ConversationItem
              key={conv.id}
              conversation={conv}
              active={conv.id === activeId}
              currentUserId={currentUserId}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </div>
  );
}