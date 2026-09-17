"use client";

/**
 * 聊天窗口主体
 *
 * - 顶部：会话标题 + 成员数 + 设置按钮
 * - 中间：MessageList（消息列表）
 * - 底部：MessageInput（消息输入区，支持 @提及/文件上传/字数计数）
 * - 回复引用：点击回复时由 MessageInput 上方显示被回复消息摘要
 *
 * 所有样式走 design token（var(--*)），无裸 hex。
 * lucide-react 图标尺寸用 14/16（项目约定）。
 */

import { useCallback, useMemo, useState } from "react";
import { Settings, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Conversation, Message, SendMessageOptions } from "./types";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";

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
  /** 加载更多历史消息（向上滚动触发） */
  onLoadMore?: () => void;
  /** 是否正在加载更多历史消息 */
  loadingMore?: boolean;
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
  onLoadMore,
  loadingMore = false,
  onSettings,
}: ChatWindowProps) {
  const t = useTranslations("chat");
  const [replyTo, setReplyTo] = useState<Message | null>(null);

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

  /** 回复引用目标（转换为 MessageInput 期望的格式） */
  const replyTarget = useMemo(
    () =>
      replyTo
        ? {
            id: replyTo.id,
            authorName: replyTo.author?.name ?? t("unknownUser"),
            body: replyTo.body,
          }
        : null,
    [replyTo, t],
  );

  /** 可提及的成员列表（群聊才需要，单聊只有两人也一并传入） */
  const mentionMembers = useMemo(
    () =>
      conversation.members.map((m) => ({
        userId: m.userId,
        user: {
          id: m.user.id,
          name: m.user.name,
          image: m.user.image,
        },
      })),
    [conversation.members],
  );

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
        onLoadMore={onLoadMore}
        hasMore={conversation.hasMoreMessages}
        loading={loadingMore}
      />

      {/* 底部输入区：MessageInput 集成 @提及/文件上传/字数计数 */}
      <div className="border-t border-[var(--border)] px-[var(--space-4)] py-[var(--space-3)]">
        <MessageInput
          onSend={onSend}
          replyTo={replyTarget}
          onCancelReply={handleCancelReply}
          members={mentionMembers}
        />
      </div>
    </div>
  );
}