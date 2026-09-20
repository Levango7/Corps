"use client";

/**
 * 聊天面板标题栏 + 搜索按钮 + 在线状态栏
 *
 * - 标题区：💬 聊天 + 消息计数
 * - 搜索按钮：点击展开搜索框
 * - 在线状态栏：在线成员头像列表（绿点指示）
 *
 * 拆分说明：ChatHeader 保持 client component（被 ChatPanel client 引用），
 * 搜索交互逻辑委托给 ChatHeaderClient 子组件。
 */

import { MessageCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Person } from "./types";
import { ChatHeaderClient } from "./ChatHeaderClient";

interface ChatHeaderProps {
  /** 消息总数 */
  messageCount: number;
  /** 在线用户 ID 集合 */
  onlineUsers: Set<string>;
  /** 工作区成员列表（用于显示在线头像） */
  members: Person[];
  /** 搜索关键词 */
  searchQuery: string;
  /** 搜索关键词变更 */
  onSearchChange: (query: string) => void;
  /** 搜索框是否展开 */
  searchOpen: boolean;
  /** 切换搜索框展开状态 */
  onToggleSearch: () => void;
}

export function ChatHeader({
  messageCount,
  onlineUsers,
  members,
  searchQuery,
  onSearchChange,
  searchOpen,
  onToggleSearch,
}: ChatHeaderProps) {
  const t = useTranslations("chat");

  // 在线成员列表（按 onlineUsers 过滤）
  const onlineMembers = members.filter((m) => onlineUsers.has(m.id));

  return (
    <div className="mb-[var(--space-3)]">
      {/* 标题行 + 搜索按钮 + 搜索框（client 子组件渲染交互部分） */}
      <ChatHeaderClient
        messageCount={messageCount}
        searchQuery={searchQuery}
        onSearchChange={onSearchChange}
        searchOpen={searchOpen}
        onToggleSearch={onToggleSearch}
        titleLabel={t("title")}
        searchLabel={t("search")}
      />

      {/* 在线状态栏 */}
      {onlineMembers.length > 0 && (
        <div className="flex items-center gap-[var(--space-2)] flex-wrap">
          <span className="text-[length:var(--text-xs)] text-[var(--meta)]">{t("online")}</span>
          {onlineMembers.slice(0, 5).map((m) => (
            <div key={m.id} className="relative shrink-0" title={m.name || m.email}>
              <div className="w-6 h-6 rounded-full bg-[var(--surface-3)] text-[var(--fg-2)] flex items-center justify-center text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] overflow-hidden">
                {m.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={m.image}
                    alt={m.name || m.email}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  (m.name || m.email)[0]?.toUpperCase()
                )}
              </div>
              {/* 在线绿点 */}
              <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-[var(--accent-success)] ring-2 ring-[var(--surface)]" />
            </div>
          ))}
          {onlineMembers.length > 5 && (
            <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
              +{onlineMembers.length - 5}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
