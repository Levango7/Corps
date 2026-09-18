"use client";

/**
 * 会话列表侧栏
 *
 * - 顶部：全文搜索按钮 + 本地过滤输入框 + 创建会话按钮
 * - 列表：按最后消息时间倒序排列，支持按名称本地过滤，渲染 ConversationItem
 * - 在线状态：每 30 秒轮询 /im/online API，单聊显示对方在线绿点
 * - 空状态：无会话或过滤无结果时显示提示
 *
 * 所有样式走 design token（var(--*)），无裸 hex。
 * lucide-react 图标尺寸用 14/16（项目约定）。
 */

import { useMemo, useState, useEffect } from "react";
import { Search, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import type { Conversation } from "./types";
import { ConversationItem } from "./ConversationItem";

/** 在线状态轮询间隔（毫秒） */
const ONLINE_POLL_INTERVAL_MS = 30_000;

/** 在线用户 API 响应（/api/v1/workspaces/{wid}/im/online） */
interface OnlineResponse {
  items: { userId: string; lastSeen: string }[];
  total: number;
}

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
  const params = useParams<{ locale: string; wid: string }>();
  const wid = params.wid;

  // 本地过滤关键词（按会话名称即时过滤）
  const [filterQuery, setFilterQuery] = useState("");
  // 在线用户 ID 集合（由 /im/online 轮询维护）
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());

  // 轮询在线状态：30 秒间隔，组件卸载时清除定时器
  useEffect(() => {
    if (!wid) return;
    let cancelled = false;
    const fetchOnline = async () => {
      try {
        const data = await api<OnlineResponse>(
          `/api/v1/workspaces/${wid}/im/online`,
        );
        if (!cancelled && data?.items) {
          setOnlineUserIds(new Set(data.items.map((item) => item.userId)));
        }
      } catch {
        // 静默失败：在线状态不可用时不影响会话列表展示
      }
    };
    fetchOnline();
    const timer = setInterval(fetchOnline, ONLINE_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [wid]);

  // 按最后消息时间倒序排列（null 排最后）
  const sorted = useMemo(() => {
    return conversations.slice().sort((a, b) => {
      const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return bTime - aTime;
    });
  }, [conversations]);

  // 本地过滤：按会话名称不区分大小写匹配
  // 单聊用对方用户名（name → email fallback），群聊用 title
  const filtered = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((conv) => {
      if (conv.type === "group") {
        return (conv.title ?? "").toLowerCase().includes(q);
      }
      const otherMember = conv.members.find((m) => m.userId !== currentUserId);
      const name = otherMember?.user.name ?? otherMember?.user.email ?? "";
      return name.toLowerCase().includes(q);
    });
  }, [sorted, filterQuery, currentUserId]);

  // 是否正在过滤（用于区分空状态文案）
  const isFiltering = filterQuery.trim().length > 0;

  return (
    <div className="flex flex-col h-full bg-[var(--surface)] border-r border-[var(--border)]">
      {/* 顶部工具栏 */}
      <div className="flex items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-3)] border-b border-[var(--border)]">
        {/* 全文搜索按钮（跳转搜索页） */}
        <button
          type="button"
          onClick={onSearch}
          aria-label={t("search")}
          className="shrink-0 w-9 h-9 flex items-center justify-center rounded-[var(--radius-md)] bg-[var(--surface-2)] text-[var(--muted)] hover:bg-[var(--surface-3)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)] focus-visible:outline-offset-2"
        >
          <Search size={16} />
        </button>
        {/* 本地过滤输入框（按会话名称即时过滤） */}
        <input
          type="text"
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
          placeholder={t("filterConversations")}
          aria-label={t("filterConversations")}
          className="flex-1 min-w-0 px-[var(--space-3)] py-[var(--space-2)] rounded-[var(--radius-md)] bg-[var(--surface-2)] border border-[var(--border)] text-[length:var(--text-sm)] text-[var(--fg)] placeholder:text-[var(--meta)] focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)] focus-visible:outline-offset-2"
        />
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
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-[var(--space-4)]">
            <p className="text-[length:var(--text-sm)] text-[var(--muted)]">
              {isFiltering ? t("noResults") : t("empty")}
            </p>
          </div>
        ) : (
          filtered.map((conv) => {
            const isGroup = conv.type === "group";
            const otherMember = !isGroup
              ? conv.members.find((m) => m.userId !== currentUserId)
              : null;
            return (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                active={conv.id === activeId}
                currentUserId={currentUserId}
                onSelect={onSelect}
                isOnline={
                  !isGroup && otherMember
                    ? onlineUserIds.has(otherMember.userId)
                    : false
                }
              />
            );
          })
        )}
      </div>
    </div>
  );
}
