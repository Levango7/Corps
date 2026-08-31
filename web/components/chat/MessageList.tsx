"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ChatMessage } from "./types";
import { MessageBubble } from "./MessageBubble";
import type { TimeT } from "@/lib/format";

/**
 * 消息列表
 *
 * - 时间戳分组：相邻时间段之间显示时间分隔线（如"今天 14:30"）
 * - 滚动行为：新消息到达时，如果在底部自动滚动；否则显示t("newMessages", { n: (count) })浮窗
 * - 未读高亮：未读消息左侧 3px 色条
 * - 搜索高亮：匹配消息高亮显示
 * - 空状态：显示"还没有消息"提示
 */

interface MessageListProps {
  /** 消息列表（正序） */
  messages: ChatMessage[];
  /** 当前用户 ID */
  currentUserId: string;
  /** 未读消息 ID 集合 */
  unreadIds: Set<string>;
  /** 搜索关键词 */
  searchQuery: string;
  /** 是否正在加载 */
  loading: boolean;
  /** 是否连接中 */
  connected: boolean;
}

/** 时间分组阈值：相邻消息间隔超过 5 分钟显示时间分隔线 */
const TIME_GROUP_THRESHOLD_MS = 5 * 60 * 1000;

/** 格式化时间戳分组标签（t 由调用方注入——模块级函数不可用 hook） */
function formatTimeGroup(iso: string, t: TimeT): string {
  const date = new Date(iso);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const time = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  if (isToday) return t("today", { time });
  if (isYesterday) return t("yesterday", { time });
  return `${date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" })} ${time}`;
}

/** 消息分组（按时间间隔） */
interface MessageGroup {
  timeLabel: string;
  messages: ChatMessage[];
}

function groupByTime(messages: ChatMessage[], t: TimeT): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let currentGroup: MessageGroup | null = null;
  let prevTime: number | null = null;

  for (const msg of messages) {
    const msgTime = new Date(msg.createdAt).getTime();
    if (
      currentGroup === null ||
      prevTime === null ||
      msgTime - prevTime > TIME_GROUP_THRESHOLD_MS
    ) {
      currentGroup = { timeLabel: formatTimeGroup(msg.createdAt, t), messages: [msg] };
      groups.push(currentGroup);
    } else {
      currentGroup.messages.push(msg);
    }
    prevTime = msgTime;
  }
  return groups;
}

export function MessageList({
  messages,
  currentUserId,
  unreadIds,
  searchQuery,
  loading,
  connected,
}: MessageListProps) {
  const t = useTranslations("chat");
  const listRef = useRef<HTMLDivElement>(null);
  const [showNewMessages, setShowNewMessages] = useState(false);
  const [newMessagesCount, setNewMessagesCount] = useState(0);
  // 是否在底部（用于判断新消息是否自动滚动）
  const isAtBottomRef = useRef(true);

  // 按时间分组
  const groups = useMemo(() => groupByTime(messages, t), [messages, t]);

  // 搜索过滤
  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return groups;
    const q = searchQuery.toLowerCase();
    return groups
      .map((g) => ({
        ...g,
        messages: g.messages.filter((m) => m.body.toLowerCase().includes(q)),
      }))
      .filter((g) => g.messages.length > 0);
  }, [groups, searchQuery]);

  // 滚动到底部
  const scrollToBottom = useCallback(() => {
    const el = listRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, []);

  // 监听滚动位置
  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const threshold = 50; // 50px 内视为在底部
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    if (isAtBottomRef.current) {
      setShowNewMessages(false);
    }
  }, []);

  // 新消息到达时的滚动行为
  const prevMessageCountRef = useRef(messages.length);
  useEffect(() => {
    const prevCount = prevMessageCountRef.current;
    const newCount = messages.length;
    prevMessageCountRef.current = newCount;

    if (newCount > prevCount) {
      const diff = newCount - prevCount;
      if (isAtBottomRef.current) {
        // 在底部，自动滚动
        scrollToBottom();
      } else {
        // 不在底部，显示t("newMessages", { n: (count) })浮窗
        setNewMessagesCount((prev) => prev + diff);
        setShowNewMessages(true);
      }
    }
  }, [messages.length, scrollToBottom]);

  // 首次加载滚动到底部
  useEffect(() => {
    if (!loading && messages.length > 0) {
      scrollToBottom();
    }
  }, [loading, messages.length, scrollToBottom]);

  // 搜索无结果
  const hasMessages = messages.length > 0;
  const hasFilteredMessages = filteredGroups.some((g) => g.messages.length > 0);

  return (
    <div className="relative">
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] p-[var(--space-3)] h-[320px] overflow-y-auto space-y-[var(--space-2)] scroll-smooth"
      >
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 size={18} className="animate-spin text-[var(--muted)]" />
          </div>
        ) : !hasMessages ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-[length:var(--text-sm)] text-[var(--meta)]">{t("empty")}</p>
          </div>
        ) : searchQuery.trim() && !hasFilteredMessages ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-[length:var(--text-sm)] text-[var(--meta)]">{t("noResults")}</p>
          </div>
        ) : (
          filteredGroups.map((group, gi) => (
            <div key={gi} className="space-y-[var(--space-2)]">
              {/* 时间戳分组分隔线 */}
              <div className="flex items-center justify-center">
                <span className="text-[length:var(--text-xs)] text-[var(--meta)] bg-[var(--surface-2)] px-2 py-0.5 rounded-full">
                  {group.timeLabel}
                </span>
              </div>
              {/* 消息气泡 */}
              {group.messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  currentUserId={currentUserId}
                  unread={unreadIds.has(msg.id)}
                  searchQuery={searchQuery}
                />
              ))}
            </div>
          ))
        )}
      </div>

      {/* t("newMessages", { n: (count) })浮窗 */}
      {showNewMessages && newMessagesCount > 0 && (
        <button
          onClick={() => {
            scrollToBottom();
            setShowNewMessages(false);
            setNewMessagesCount(0);
          }}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-xs)] font-[var(--weight-medium)] shadow-[var(--elev-md)] hover:bg-[var(--accent-hover)] transition-colors duration-[var(--motion-fast)]"
        >
          <ChevronDown size={14} />
          {t("newMessages", { count: newMessagesCount })}
        </button>
      )}

      {/* 连接状态指示 */}
      {!connected && !loading && (
        <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--surface-2)] text-[length:var(--text-xs)] text-[var(--meta)]">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--meta)] animate-pulse" />
          {t("offline")}
        </div>
      )}
    </div>
  );
}
