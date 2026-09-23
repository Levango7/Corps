"use client";

/**
 * 单个会话项 · client 交互部分
 *
 * 负责：onClick 选中会话
 */

import { memo } from "react";
import { BellOff } from "lucide-react";

interface ConversationItemClientProps {
  conversationId: string;
  active: boolean;
  displayName: string;
  avatarUrl: string | null;
  initial: string;
  preview: string;
  timeStr: string | null;
  unread: number;
  isOnline: boolean;
  isMuted: boolean;
  onlineLabel: string;
  noMessagesLabel: string;
  onSelect: (id: string) => void;
}

function ConversationItemClientImpl({
  conversationId,
  active,
  displayName,
  avatarUrl,
  initial,
  preview,
  timeStr,
  unread,
  isOnline,
  isMuted,
  onlineLabel,
  noMessagesLabel,
  onSelect,
}: ConversationItemClientProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(conversationId)}
      aria-current={active ? "true" : undefined}
      className={`w-full flex items-center gap-[var(--space-3)] px-[var(--space-3)] py-[var(--space-2)] rounded-[var(--radius-md)] text-left transition-colors duration-[var(--motion-fast)] focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)] focus-visible:outline-offset-2 ${
        active
          ? "bg-[var(--accent-soft)] text-[var(--fg)]"
          : "hover:bg-[var(--surface-2)] text-[var(--fg)]"
      }`}
    >
      {/* 头像 */}
      <div className="relative shrink-0 w-9 h-9 rounded-full bg-[var(--surface-3)] text-[var(--muted)] flex items-center justify-center text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] overflow-hidden">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt={displayName}
            className="w-full h-full object-cover"
          />
        ) : (
          initial
        )}
        {/* 在线状态绿点（仅单聊且对方在线时显示） */}
        {isOnline && (
          <span
            aria-label={onlineLabel}
            className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-[var(--success)] border-2 border-[var(--surface)]"
          />
        )}
      </div>

      {/* 主体 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-[var(--space-2)]">
          {/* 名称 + 静音标记 */}
          <span
            className="truncate text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] flex items-center gap-[var(--space-1)]"
            title={displayName}
          >
            <span className="truncate">{displayName}</span>
            {isMuted && (
              <BellOff size={14} className="shrink-0 text-[var(--meta)]" />
            )}
          </span>
          {/* 时间 */}
          {timeStr && (
            <span className="shrink-0 text-[length:var(--text-xs)] text-[var(--meta)]">
              {timeStr}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-[var(--space-2)] mt-0.5">
          {/* 最后消息预览 */}
          <span className="truncate text-[length:var(--text-xs)] text-[var(--muted)]">
            {preview || noMessagesLabel}
          </span>
          {/* 未读 badge */}
          {unread > 0 && (
            <span className="shrink-0 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--danger)] text-[var(--on-accent)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] leading-none">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

export const ConversationItemClient = memo(ConversationItemClientImpl);