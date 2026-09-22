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
import { Settings, Users, Video } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter, useParams } from "next/navigation";
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
  /** 正在输入的用户 ID 列表（当前会话） */
  typingUserIds?: string[];
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
  typingUserIds = [],
}: ChatWindowProps) {
  const t = useTranslations("chat");
  const tIm = useTranslations("im");
  const router = useRouter();
  const params = useParams<{ locale: string; wid: string }>();
  const [replyTo, setReplyTo] = useState<Message | null>(null);

  const isGroup = conversation.type === "group";

  // 单聊：找对方成员作为标题
  const otherMember = !isGroup
    ? conversation.members.find((m) => m.userId !== currentUserId)
    : null;
  const title = isGroup
    ? conversation.title ?? t("groupConversation")
    : otherMember?.user.name ?? otherMember?.user.email ?? t("unknownUser");

  /**
   * 发起视频通话：
   * 1. 创建 instant meeting（POST /api/v1/workspaces/{wid}/meetings）
   * 2. 发送 call_invite 系统消息（body 含会议链接，通知对方加入）
   * 3. 跳转到会议页面
   */
  const handleVideoCall = useCallback(async () => {
    const wid = conversation.workspaceId;
    const locale = params?.locale ?? "zh";
    try {
      // 创建即时会议
      const res = await fetch(`/api/v1/workspaces/${wid}/meetings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title: tIm("videoCall"),
          type: "instant",
        }),
      });
      if (!res.ok) return;
      const json = (await res.json()) as { code: number; data: { id: string } | null };
      const meeting = json.data;
      if (!meeting?.id) return;

      // 发送 call_invite 消息（body 包含会议链接，对方可点击加入）
      const meetingUrl = `/${locale}/w/${wid}/meetings/${meeting.id}`;
      onSend(`${tIm("callInvite")}: ${meetingUrl}`, { type: "call_invite" });

      // 跳转到会议页面，通过 URL query 传递 conversationId（供 MeetingRoom 发送 call_ended）
      router.push(`${meetingUrl}?conversationId=${conversation.id}`);
    } catch {
      // 静默失败：网络错误时用户可重试
    }
  }, [conversation.workspaceId, conversation.id, onSend, router, params, tIm]);

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

  /**
   * 正在输入提示文本。
   * - 1 人：xxx 正在输入…
   * - 2 人：xxx、yyy 正在输入…
   * - 3+ 人：多人正在输入…
   * 排除当前用户自己（自己输入不提示）。
   * 复用现有 i18n key: chat.typing ({names} 正在输入…) / chat.typingMany
   */
  const typingText = useMemo(() => {
    if (typingUserIds.length === 0) return "";
    // 过滤掉当前用户，并将 userId 映射到显示名
    const others = typingUserIds
      .filter((id) => id !== currentUserId)
      .map((id) => {
        const member = conversation.members.find((m) => m.userId === id);
        return member?.user.name ?? t("unknownUser");
      });
    if (others.length === 0) return "";
    if (others.length <= 2) return t("typing", { names: others.join("、") });
    return t("typingMany");
  }, [typingUserIds, currentUserId, conversation.members, t]);

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
        {/* 视频通话 + 设置按钮 */}
        <div className="flex items-center gap-[var(--space-1)]">
          {/* 视频通话按钮：创建即时会议 → 发送 call_invite → 跳转会议页 */}
          <button
            type="button"
            onClick={handleVideoCall}
            aria-label={tIm("videoCall")}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-[var(--radius-md)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)] focus-visible:outline-offset-2"
          >
            <Video size={16} />
          </button>
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

      {/* 正在输入指示器：紧贴输入框上方，仅当有 typing 文本时显示 */}
      {typingText && (
        <div
          className="px-[var(--space-4)] pt-[var(--space-2)] animate-pulse"
          aria-live="polite"
        >
          <span className="text-[length:var(--text-xs)] text-[var(--muted)]">
            {typingText}
          </span>
        </div>
      )}

      {/* 底部输入区：MessageInput 集成 @提及/文件上传/字数计数/AI 回复建议 */}
      <div className="border-t border-[var(--border)] px-[var(--space-4)] py-[var(--space-3)]">
        <MessageInput
          onSend={onSend}
          replyTo={replyTarget}
          onCancelReply={handleCancelReply}
          members={mentionMembers}
          conversationId={conversation.id}
        />
      </div>
    </div>
  );
}