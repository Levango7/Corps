"use client";

/**
 * 聊天窗口主体
 *
 * - 顶部：会话标题 + 成员数 + 设置按钮
 * - 中间：MessageList（消息列表）
 * - 底部：消息输入区（MessageInput 在 Task 215 创建，此处用内联简单输入）
 * - 回复引用：点击回复时在输入区上方显示被回复消息摘要
 *
 * 所有样式走 design token（var(--*)），无裸 hex。
 * lucide-react 图标尺寸用 14/16（项目约定）。
 */

import { useCallback, useState, type KeyboardEvent } from "react";
import { Settings, Send, X, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Conversation, Message, SendMessageOptions } from "./types";
import { MessageList } from "./MessageList";

/** 消息体最大长度（与 API zod schema 对齐） */
const MAX_BODY_LENGTH = 10000;

interface ChatWindowProps {
  /** 当前会话 */
  conversation: Conversation;
  /** 消息列表 */
  messages: Message[];
  /** 当前用户 ID */
  currentUserId: string;
  /** 发送消息 */
  onSend: (body: string, opts?: SendMessageOptions) => void;
  /** 编辑消息 */
  onEdit: (mid: string, body: string) => void;
  /** 撤回消息 */
  onRevoke: (mid: string) => void;
  /** 点击设置按钮（可选） */
  onSettings?: () => void;
}

export function ChatWindow({
  conversation,
  messages,
  currentUserId,
  onSend,
  onEdit,
  onRevoke,
  onSettings,
}: ChatWindowProps) {
  const t = useTranslations("chat");
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [sending, setSending] = useState(false);

  const isGroup = conversation.type === "group";

  // 单聊：找对方成员作为标题
  const otherMember = !isGroup
    ? conversation.members.find((m) => m.userId !== currentUserId)
    : null;
  const title = isGroup
    ? conversation.title ?? t("groupConversation")
    : otherMember?.user.name ?? otherMember?.user.email ?? t("unknownUser");

  /** 点击回复 */
  const handleReply = useCallback((mid: string) => {
    const msg = messages.find((m) => m.id === mid);
    if (msg) setReplyTo(msg);
  }, [messages]);

  /** 取消回复 */
  const handleCancelReply = useCallback(() => {
    setReplyTo(null);
  }, []);

  /** 发送消息 */
  const handleSend = useCallback(async () => {
    const trimmed = draft.trim();
    if (!trimmed || sending) return;

    setSending(true);
    try {
      const opts: SendMessageOptions = {};
      if (replyTo) opts.replyToId = replyTo.id;
      onSend(trimmed, opts);
      setDraft("");
      setReplyTo(null);
    } finally {
      setSending(false);
    }
  }, [draft, sending, replyTo, onSend]);

  /** 键盘事件：⌘/Ctrl + Enter 发送 */
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const canSend = draft.trim().length > 0 && !sending;

  return (
    <div className="flex flex-col h-full bg-[var(--surface)]">
      {/* 顶部 Header */}
      <div className="flex items-center justify-between gap-[var(--space-3)] px-[var(--space-4)] py-[var(--space-3)] border-b border-[var(--border)]">
        <div className="flex items-center gap-[var(--space-2)] min-w-0">
          {/* 会话标题 */}
          <h2
            className="truncate text-[length:var(--text-base)] font-[weight:var(--weight-semibold)] text-[var(--fg)]"
            title={title}
          >
            {title}
          </h2>
          {/* 成员数（群聊显示） */}
          {isGroup && (
            <span className="shrink-0 flex items-center gap-1 text-[length:var(--text-xs)] text-[var(--muted)]">
              <Users size={14} />
              {conversation.members.length}
            </span>
          )}
        </div>
        {/* 设置按钮 */}
        {onSettings && (
          <button
            type="button"
            onClick={onSettings}
            aria-label={t("settings")}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-[var(--radius-md)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)] focus-visible:outline-offset-2"
          >
            <Settings size={16} />
          </button>
        )}
      </div>

      {/* 消息列表 */}
      <MessageList
        messages={messages}
        currentUserId={currentUserId}
        onEdit={onEdit}
        onRevoke={onRevoke}
        onReply={handleReply}
      />

      {/* 底部输入区 */}
      <div className="border-t border-[var(--border)] px-[var(--space-4)] py-[var(--space-3)]">
        {/* 回复引用 */}
        {replyTo && (
          <div className="mb-[var(--space-2)] flex items-center justify-between gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] rounded-[var(--radius-sm)] bg-[var(--surface-2)] border-l-2 border-[var(--accent)]">
            <div className="min-w-0 flex-1">
              <span className="text-[length:var(--text-xs)] text-[var(--accent)] font-[weight:var(--weight-medium)]">
                {t("replyTo", { name: replyTo.author?.name ?? t("unknownUser") })}
              </span>
              <p className="truncate text-[length:var(--text-xs)] text-[var(--muted)]">
                {replyTo.body}
              </p>
            </div>
            <button
              type="button"
              onClick={handleCancelReply}
              aria-label={t("cancel")}
              className="shrink-0 w-6 h-6 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-3)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)]"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* 输入框 + 发送按钮 */}
        <div className="flex items-end gap-[var(--space-2)]">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, MAX_BODY_LENGTH))}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={t("placeholder")}
            className="flex-1 px-[var(--space-3)] py-[var(--space-2)] overflow-hidden resize-none border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface-2)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:border-[var(--accent)] placeholder:text-[var(--meta)] transition-colors duration-[var(--motion-fast)]"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            aria-label={t("sendAria")}
            className="h-9 px-[var(--space-3)] shrink-0 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] flex items-center gap-1.5"
          >
            <Send size={15} />
            {t("send")}
          </button>
        </div>
      </div>
    </div>
  );
}