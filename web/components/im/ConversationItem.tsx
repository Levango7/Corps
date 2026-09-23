"use client";

/**
 * 单个会话项（会话列表中的一行）
 *
 * 显示：
 *  - 头像：群聊用 title 首字 fallback，单聊用对方用户头像
 *  - 名称：群聊用 title，单聊用对方用户名
 *  - 最后消息预览（截断 30 字）
 *  - 时间（相对时间：刚刚 / N 分钟前 / 昨天 / 日期）
 *  - 未读数 badge（红色圆点或数字）
 *  - 高亮选中状态
 *
 * 所有样式走 design token（var(--*)），无裸 hex。
 * lucide-react 图标尺寸用 14/16（项目约定）。
 *
 * 拆分说明：ConversationItem 保持 client component（被 ConversationList client 引用），
 * onClick 交互逻辑委托给 ConversationItemClient 子组件。
 */

import { useTranslations, useLocale } from "next-intl";
import { BellOff } from "lucide-react";
import type { Conversation } from "./types";
import { ConversationItemClient } from "./ConversationItemClient";

/** 消息预览最大长度 */
const PREVIEW_MAX_LENGTH = 30;

interface ConversationItemProps {
  /** 会话数据 */
  conversation: Conversation;
  /** 是否选中（高亮） */
  active: boolean;
  /** 当前用户 ID（用于单聊中识别对方） */
  currentUserId: string;
  /** 点击选中会话 */
  onSelect: (id: string) => void;
  /** 对方用户是否在线（仅单聊有效，在头像右下角显示绿点） */
  isOnline?: boolean;
}

/**
 * 相对时间格式化（i18n）。
 * 刚刚 / N 分钟前 / N 小时前 / 昨天 / 月-日
 */
function formatRelativeTime(
  iso: string | null,
  t: (key: string, values?: { count?: number }) => string,
  locale: string,
): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const diff = Math.max(0, Date.now() - then);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return t("justNow");
  const min = Math.floor(sec / 60);
  if (min < 60) return t("minutesAgo", { count: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("hoursAgo", { count: hr });
  const day = Math.floor(hr / 24);
  if (day === 1) return t("daysAgo", { count: 1 });
  if (day < 30) return t("daysAgo", { count: day });
  return new Date(iso).toLocaleDateString(locale, { month: "numeric", day: "numeric" });
}

/** 截断文本到指定长度 */
function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** 从用户名提取首字母（大写），用于头像 fallback */
function getInitial(name: string | null): string {
  if (!name) return "?";
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return trimmed[0].toUpperCase();
}

export function ConversationItem({
  conversation,
  active,
  currentUserId,
  onSelect,
  isOnline = false,
}: ConversationItemProps) {
  const t = useTranslations("time");
  const tChat = useTranslations("chat");
  const locale = useLocale();

  // 单聊：找对方成员；群聊：用 title
  const isGroup = conversation.type === "group";
  const otherMember = !isGroup
    ? conversation.members.find((m) => m.userId !== currentUserId)
    : null;

  // 名称
  const displayName = isGroup
    ? conversation.title ?? tChat("groupConversation")
    : otherMember?.user.name ?? otherMember?.user.email ?? tChat("unknownUser");

  // 头像
  const avatarUrl = isGroup
    ? conversation.avatar
    : otherMember?.user.image ?? null;
  const initial = isGroup
    ? getInitial(conversation.title)
    : getInitial(otherMember?.user.name ?? otherMember?.user.email ?? null);

  // 最后消息预览
  const lastMessage = conversation.messages?.[conversation.messages.length - 1];
  const preview = lastMessage
    ? truncate(lastMessage.body, PREVIEW_MAX_LENGTH)
    : conversation.description ?? "";

  // 时间
  const timeStr = formatRelativeTime(conversation.lastMessageAt, t, locale);

  // 未读数
  const unread = conversation.unreadCount ?? 0;

  // 当前用户在该会话中是否静音
  const isMuted = conversation.members.find((m) => m.userId === currentUserId)?.muted ?? false;

  return (
    <ConversationItemClient
      conversationId={conversation.id}
      active={active}
      displayName={displayName}
      avatarUrl={avatarUrl}
      initial={initial}
      preview={preview}
      timeStr={timeStr}
      unread={unread}
      isOnline={isOnline}
      isMuted={isMuted}
      onlineLabel={tChat("online")}
      noMessagesLabel={tChat("noMessages")}
      onSelect={onSelect}
    />
  );
}
