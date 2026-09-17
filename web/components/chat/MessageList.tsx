"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, ChevronDown, Search, X } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import type { ChatMessage } from "./types";
import { MessageBubble, type EditableChatMessage } from "./MessageBubble";
import type { TimeT } from "@/lib/format";

/**
 * 消息列表
 *
 * - 顶部搜索栏：输入关键词 + 搜索按钮，调用 /messages/search API
 * - 时间戳分组：相邻时间段之间显示时间分隔线（如"今天 14:30"）
 * - 滚动行为：新消息到达时，如果在底部自动滚动；否则显示新消息浮窗
 * - 未读高亮：未读消息左侧 3px 色条 + 右上蓝色圆点
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
  /** 搜索关键词（由父组件传入，用于高亮；与本地搜索栏互补） */
  searchQuery: string;
  /** 是否正在加载 */
  loading: boolean;
  /** 是否连接中 */
  connected: boolean;
  /** 消息搜索 API 端点（提供时显示顶部搜索栏） */
  searchUrl?: string;
}

/** 时间分组阈值：相邻消息间隔超过 5 分钟显示时间分隔线 */
const TIME_GROUP_THRESHOLD_MS = 5 * 60 * 1000;

/** 格式化时间戳分组标签（t 由调用方注入——模块级函数不可用 hook） */
function formatTimeGroup(iso: string, t: TimeT, locale: string): string {
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

/** 消息分组（按时间间隔） */
interface MessageGroup {
  timeLabel: string;
  messages: ChatMessage[];
}

function groupByTime(messages: ChatMessage[], t: TimeT, locale: string): MessageGroup[] {
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
      currentGroup = { timeLabel: formatTimeGroup(msg.createdAt, t, locale), messages: [msg] };
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
  searchUrl,
}: MessageListProps) {
  const t = useTranslations("chat");
  const locale = useLocale();
  // 局部保存操作结果，避免父级旧快照在已读更新时覆盖刚编辑/撤回的内容。
  const [messageUpdates, setMessageUpdates] = useState<Record<string, EditableChatMessage>>({});
  const onMessageUpdated = useCallback((message: EditableChatMessage) => {
    setMessageUpdates((previous) => ({ ...previous, [message.id]: message }));
  }, []);
  const applyUpdate = useCallback((message: EditableChatMessage): EditableChatMessage => {
    const update = messageUpdates[message.id];
    if (!update || message.isRecalled || message.revokedAt ||
      (message.editedAt && update.editedAt && new Date(message.editedAt) > new Date(update.editedAt))) return message;
    return { ...message, body: update.body, isRecalled: update.isRecalled, revokedAt: update.revokedAt, editedAt: update.editedAt,
      ...(update.isRecalled ? { attachments: [] } : {}) };
  }, [messageUpdates]);
  const listRef = useRef<HTMLDivElement>(null);
  const [showNewMessages, setShowNewMessages] = useState(false);
  const [newMessagesCount, setNewMessagesCount] = useState(0);
  // 是否在底部（用于判断新消息是否自动滚动）
  const isAtBottomRef = useRef(true);

  // 本地搜索栏状态
  const [localQuery, setLocalQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ChatMessage[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  /** 调用 /messages/search API */
  const runSearch = useCallback(
    async (q: string) => {
      if (!searchUrl || !q.trim()) {
        setSearchResults(null);
        setSearchError("");
        return;
      }
      setSearching(true);
      setSearchError("");
      try {
        const url = `${searchUrl}?q=${encodeURIComponent(q.trim())}&limit=20`;
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) {
          const json = await res.json().catch(() => ({ message: t("searchFailed") }));
          throw new Error(json.message || `${t("searchFailed")} (${res.status})`);
        }
        const json = (await res.json()) as { code: number; data: ChatMessage[] };
        // API 返回按 createdAt desc，反转为正序以兼容现有渲染
        setSearchResults((json.data ?? []).slice().reverse());
      } catch (e) {
        setSearchError(e instanceof Error ? e.message : t("searchFailed"));
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    },
    [searchUrl, t],
  );

  /** 提交搜索（按钮 / Enter） */
  const submitSearch = useCallback(() => {
    runSearch(localQuery);
  }, [runSearch, localQuery]);

  /** 清空搜索 */
  const clearSearch = useCallback(() => {
    setLocalQuery("");
    setSearchResults(null);
    setSearchError("");
    if (searchInputRef.current) searchInputRef.current.focus();
  }, []);

  // 按时间分组
  const groups = useMemo(() => groupByTime(messages.map(applyUpdate), t, locale), [messages, applyUpdate, t, locale]);

  // 父组件 searchQuery 过滤（保留原有高亮过滤行为）
  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return groups;
    const q = searchQuery.toLowerCase();
    const matched = groups
      .flatMap((g) => g.messages)
      .filter((m: EditableChatMessage) => !m.isRecalled && !m.revokedAt && m.body.toLowerCase().includes(q));
    if (matched.length === 0) return [];
    return [{ timeLabel: t("searchResults"), messages: matched }];
  }, [groups, searchQuery, t]);

  // 本地搜索结果分组（覆盖 filteredGroups 当有 searchResults）
  const effectiveGroups = useMemo(() => {
    if (searchResults !== null) {
      if (searchResults.length === 0) return [];
      // 搜索结果合并为单组，倒序展示（最新在上）——这里反转为正序以保持滚动一致
      return [{ timeLabel: t("searchResults"), messages: searchResults.map(applyUpdate) }];
    }
    return filteredGroups;
  }, [searchResults, filteredGroups, applyUpdate, t]);

  // 用于高亮的关键词：本地搜索优先，否则用父组件 searchQuery
  const effectiveQuery = searchResults !== null ? localQuery : searchQuery;

  // 滚动到底部
  const scrollToBottom = useCallback((instant?: boolean) => {
    const el = listRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: instant ? "auto" : "smooth" });
    }
  }, []);

  // 监听滚动位置
  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const threshold = 50;
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    if (isAtBottomRef.current) {
      setShowNewMessages(false);
    }
  }, []);

  // 新消息到达时的滚动行为
  const prevMessageCountRef = useRef(messages.length);
  useEffect(() => {
    // 搜索模式下不自动滚动
    if (searchResults !== null) return;
    const prevCount = prevMessageCountRef.current;
    const newCount = messages.length;
    prevMessageCountRef.current = newCount;

    if (newCount > prevCount) {
      const diff = newCount - prevCount;
      if (isAtBottomRef.current) {
        scrollToBottom();
      } else {
        setNewMessagesCount((prev) => prev + diff);
        setShowNewMessages(true);
      }
    }
  }, [messages.length, scrollToBottom, searchResults]);

  // 首次加载滚动到底部
  const initialScrollDoneRef = useRef(false);
  useEffect(() => {
    if (!loading && messages.length > 0 && !initialScrollDoneRef.current) {
      initialScrollDoneRef.current = true;
      scrollToBottom(true);
    }
  }, [loading, messages.length, scrollToBottom]);

  const hasMessages = messages.length > 0;
  const hasEffectiveMessages = effectiveGroups.some((g) => g.messages.length > 0);
  const inLocalSearch = searchResults !== null;

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      {/* 顶部搜索栏 */}
      {searchUrl && (
        <div className="mb-[var(--space-2)] flex items-center gap-[var(--space-2)]">
          <div className="flex-1 flex items-center gap-1.5 px-[var(--space-2)] py-1.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] focus-within:border-[var(--accent)] focus-within:ring-2 focus-within:ring-[var(--accent-ring)] transition-colors duration-[var(--motion-fast)]">
            <Search size={14} className="shrink-0 text-[var(--meta)]" />
            <input
              ref={searchInputRef}
              type="text"
              value={localQuery}
              onChange={(e) => setLocalQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitSearch();
                }
                if (e.key === "Escape") {
                  clearSearch();
                }
              }}
              placeholder={t("searchPlaceholder")}
              maxLength={200}
              className="flex-1 min-w-0 bg-transparent outline-none text-[length:var(--text-sm)] text-[var(--fg)] placeholder:text-[var(--meta)]"
            />
            {localQuery && (
              <button
                type="button"
                onClick={clearSearch}
                aria-label={t("clearSearch")}
                className="shrink-0 w-4 h-4 flex items-center justify-center rounded-full text-[var(--meta)] hover:bg-[var(--surface-3)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)]"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={submitSearch}
            disabled={searching || !localQuery.trim()}
            className="shrink-0 h-8 px-[var(--space-3)] rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-fast)] flex items-center gap-1.5"
          >
            {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            {t("search")}
          </button>
        </div>
      )}

      {/* 搜索错误提示 */}
      {searchError && (
        <div className="mb-1.5 px-2 py-1 rounded-[var(--radius-sm)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-xs)]">
          {searchError}
        </div>
      )}

      {/* 搜索结果计数 */}
      {inLocalSearch && searchResults !== null && localQuery.trim() && !searchError && (
        <div className="mb-1.5 text-[length:var(--text-xs)] text-[var(--meta)]">
          {searchResults.length > 0
            ? t("resultCount", { count: searchResults.length })
            : t("searchNoResults", { keyword: localQuery.trim() })}
        </div>
      )}

      <div
        ref={listRef}
        onScroll={handleScroll}
        className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] p-[var(--space-3)] flex-1 min-h-[320px] overflow-y-auto space-y-[var(--space-2)] scroll-smooth"
      >
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 size={16} className="animate-spin text-[var(--muted)]" />
          </div>
        ) : !hasMessages && !inLocalSearch ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-[length:var(--text-sm)] text-[var(--meta)]">{t("empty")}</p>
          </div>
        ) : inLocalSearch && searchResults !== null && searchResults.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-[length:var(--text-sm)] text-[var(--meta)]">
              {t("searchNoResults", { keyword: localQuery.trim() })}
            </p>
          </div>
        ) : !inLocalSearch && searchQuery.trim() && !hasEffectiveMessages ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-[length:var(--text-sm)] text-[var(--meta)]">{t("noResults")}</p>
          </div>
        ) : (
          effectiveGroups.map((group, gi) => (
            <div key={gi} className="space-y-[var(--space-2)]">
              {/* 时间戳分组分隔线 */}
              <div className="flex items-center justify-center">
                <span className="text-[length:var(--text-xs)] text-[var(--meta)] bg-[var(--surface-2)] px-2 py-0.5 rounded-full">
                  {group.timeLabel}
                </span>
              </div>
              {/* 消息气泡 */}
              {group.messages.map((msg) => {
                const isUnread = unreadIds.has(msg.id);
                return (
                  <div key={msg.id} className="relative">
                    {/* 未读蓝色圆点标记（右上角） */}
                    {isUnread && (
                      <span
                        aria-label={t("unread")}
                        className="absolute top-0 right-0 z-10 w-2 h-2 rounded-full bg-[var(--accent)] ring-2 ring-[var(--surface)]"
                      />
                    )}
                    <MessageBubble
                      message={applyUpdate(msg)}
                      onMessageUpdated={onMessageUpdated}
                      currentUserId={currentUserId}
                      unread={isUnread}
                      searchQuery={effectiveQuery}
                    />
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      {/* 新消息浮窗 */}
      {showNewMessages && newMessagesCount > 0 && (
        <button
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
