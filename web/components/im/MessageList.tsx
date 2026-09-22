"use client";

/**
 * 消息列表
 *
 * - 自动滚动到底部（新消息到达时，如果在底部则自动滚动）
 * - 向上滚动加载历史（触发 onLoadMore）
 * - 按日期分组（显示日期分隔线）
 * - 每条消息用 MessageItem
 * - 相邻同一作者的消息只第一条显示作者名
 * - 空状态提示
 *
 * 所有样式走 design token（var(--*)），无裸 hex。
 * lucide-react 图标尺寸用 14/16（项目约定）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, ChevronDown } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import type { Message } from "./types";
import { MessageItem } from "./MessageItem";

interface MessageListProps {
  /** 消息列表（正序，最旧在前） */
  messages: Message[];
  /** 当前用户 ID */
  currentUserId: string;
  /** 编辑消息 */
  onEdit: (mid: string, body: string) => void;
  /** 撤回消息 */
  onRevoke: (mid: string) => void;
  /** 回复消息（可选） */
  onReply?: (mid: string) => void;
  /** 加载更多历史消息（向上滚动触发） */
  onLoadMore?: () => void;
  /** 是否还有更多历史消息 */
  hasMore?: boolean;
  /** 是否正在加载 */
  loading?: boolean;
}

/** 日期分组：同一天的消息归为一组 */
interface DateGroup {
  /** 日期标签 */
  label: string;
  /** 该日期下的消息 */
  messages: Message[];
}

/** 格式化日期标签 */
function formatDateLabel(iso: string, locale: string, t: (key: string, values?: { time?: string }) => string): string {
  const date = new Date(iso);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const time = date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  if (isToday) return t("today", { time });
  if (isYesterday) return t("yesterday", { time });
  return `${date.toLocaleDateString(locale, { month: "short", day: "numeric" })} ${time}`;
}

/** 按日期分组 */
function groupByDate(messages: Message[], locale: string, t: (key: string, values?: { time?: string }) => string): DateGroup[] {
  const groups: DateGroup[] = [];
  let currentGroup: DateGroup | null = null;
  let prevDateStr: string | null = null;

  for (const msg of messages) {
    const dateStr = new Date(msg.createdAt).toDateString();
    if (dateStr !== prevDateStr) {
      currentGroup = { label: formatDateLabel(msg.createdAt, locale, t), messages: [msg] };
      groups.push(currentGroup);
    } else {
      currentGroup!.messages.push(msg);
    }
    prevDateStr = dateStr;
  }
  return groups;
}

export function MessageList({
  messages,
  currentUserId,
  onEdit,
  onRevoke,
  onReply,
  onLoadMore,
  hasMore = false,
  loading = false,
}: MessageListProps) {
  const t = useTranslations("chat");
  const locale = useLocale();
  const listRef = useRef<HTMLDivElement>(null);
  const [showNewMessages, setShowNewMessages] = useState(false);
  const [newMessagesCount, setNewMessagesCount] = useState(0);
  // 是否在底部（用于判断新消息是否自动滚动）
  const isAtBottomRef = useRef(true);
  // 是否在顶部（用于触发加载更多）
  const isAtTopRef = useRef(false);
  // 上一次的 scrollHeight（用于加载更多后保持滚动位置）
  const prevScrollHeightRef = useRef<number>(0);

  // 按日期分组
  const groups = useMemo(() => groupByDate(messages, locale, t), [messages, locale, t]);

  /** 滚动到底部 */
  const scrollToBottom = useCallback((instant?: boolean) => {
    const el = listRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: instant ? "auto" : "smooth" });
    }
  }, []);

  /** 监听滚动位置 */
  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const thresholdBottom = 50; // 50px 内视为在底部
    const thresholdTop = 50; // 50px 内视为在顶部

    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < thresholdBottom;
    isAtTopRef.current = el.scrollTop < thresholdTop;

    if (isAtBottomRef.current) {
      setShowNewMessages(false);
    }

    // 向上滚动到顶部：触发加载更多
    if (isAtTopRef.current && hasMore && onLoadMore && !loading) {
      prevScrollHeightRef.current = el.scrollHeight;
      onLoadMore();
    }
  }, [hasMore, onLoadMore, loading]);

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
        // 不在底部，显示新消息浮窗
        setNewMessagesCount((prev) => prev + diff);
        setShowNewMessages(true);
      }
    } else if (newCount < prevCount) {
      // 消息减少（加载更多替换），保持滚动位置
      const el = listRef.current;
      if (el && prevScrollHeightRef.current > 0) {
        const heightDiff = el.scrollHeight - prevScrollHeightRef.current;
        el.scrollTop = el.scrollTop + heightDiff;
      }
    }
  }, [messages.length, scrollToBottom]);

  // 首次加载滚动到底部
  const initialScrollDoneRef = useRef(false);
  useEffect(() => {
    if (!loading && messages.length > 0 && !initialScrollDoneRef.current) {
      initialScrollDoneRef.current = true;
      scrollToBottom(true);
    }
  }, [loading, messages.length, scrollToBottom]);

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto p-[var(--space-3)] space-y-[var(--space-3)] scroll-smooth"
      >
        {/* 加载更多指示器 */}
        {hasMore && (
          <div className="flex items-center justify-center py-[var(--space-2)]">
            {loading ? (
              <Loader2 size={16} className="animate-spin text-[var(--muted)]" />
            ) : (
              <button
                type="button"
                onClick={onLoadMore}
                className="text-[length:var(--text-xs)] text-[var(--muted)] hover:text-[var(--accent)] transition-colors duration-[var(--motion-fast)]"
              >
                {t("loadMore")}
              </button>
            )}
          </div>
        )}

        {loading && messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 size={16} className="animate-spin text-[var(--muted)]" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-[length:var(--text-sm)] text-[var(--muted)]">
              {t("empty")}
            </p>
          </div>
        ) : (
          groups.map((group, gi) => (
            <div key={gi} className="space-y-[var(--space-2)]">
              {/* 日期分隔线 */}
              <div className="flex items-center justify-center">
                <span className="text-[length:var(--text-xs)] text-[var(--meta)] bg-[var(--surface-2)] px-2 py-0.5 rounded-full">
                  {group.label}
                </span>
              </div>
              {/* 消息列表 */}
              {group.messages.map((msg, mi) => {
                const isOwn = msg.authorId === currentUserId;
                // 相邻同一作者只第一条显示作者名
                const prevMsg = mi > 0 ? group.messages[mi - 1] : null;
                const showAuthor = !prevMsg || prevMsg.authorId !== msg.authorId;
                return (
                  <MessageItem
                    key={msg.id}
                    message={msg}
                    isOwn={isOwn}
                    showAuthor={showAuthor}
                    onEdit={onEdit}
                    onRevoke={onRevoke}
                    onReply={onReply}
                  />
                );
              })}
            </div>
          ))
        )}
      </div>

      {/* 新消息浮窗 */}
      {showNewMessages && newMessagesCount > 0 && (
        <button
          type="button"
          onClick={() => {
            scrollToBottom();
            setShowNewMessages(false);
            setNewMessagesCount(0);
          }}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] shadow-[var(--elev-md)] hover:bg-[var(--accent-hover)] transition-colors duration-[var(--motion-fast)]"
        >
          <ChevronDown size={14} />
          {t("newMessages", { n: newMessagesCount })}
        </button>
      )}
    </div>
  );
}