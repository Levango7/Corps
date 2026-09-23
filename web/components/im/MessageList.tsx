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

/**
 * 预计算每个 call_invite 消息的通话是否已结束。
 * 如果同一会话中，该 call_invite 之后存在 call_ended 或 call_rejected 消息，
 * 则认为通话已结束。
 * 返回 Map<messageId, boolean>，仅包含 call_invite 类型的消息。
 */
function computeCallEndedSet(messages: Message[]): Map<string, boolean> {
  const result = new Map<string, boolean>();
  // 按会话分组，记录每个会话中 call_invite 的索引和后续是否有 call_ended/call_rejected
  const conversationCallInvites = new Map<string, { msgId: string; ended: boolean }[]>();

  for (const msg of messages) {
    if (msg.type === "call_invite") {
      const list = conversationCallInvites.get(msg.conversationId ?? "") ?? [];
      list.push({ msgId: msg.id, ended: false });
      conversationCallInvites.set(msg.conversationId ?? "", list);
    } else if (msg.type === "call_ended" || msg.type === "call_rejected") {
      // 标记该会话中所有尚未结束的 call_invite 为已结束
      const list = conversationCallInvites.get(msg.conversationId ?? "");
      if (list) {
        for (const item of list) {
          if (!item.ended) item.ended = true;
        }
      }
    }
  }

  for (const list of conversationCallInvites.values()) {
    for (const item of list) {
      result.set(item.msgId, item.ended);
    }
  }
  return result;
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
  // 预计算 call_invite 消息的通话状态
  const callEndedMap = useMemo(() => computeCallEndedSet(messages), [messages]);

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
                    callEnded={callEndedMap.get(msg.id)}
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