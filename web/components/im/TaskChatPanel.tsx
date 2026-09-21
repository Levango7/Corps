"use client";

/**
 * 任务详情页内嵌 IM 聊天面板
 *
 * 职责：
 *  - 调用 POST /tasks/{id}/conversation 获取/创建关联会话
 *  - 用 useIM hook 加载消息（selectTaskConversation）
 *  - 复用 ChatWindow 组件显示消息列表和输入框
 *  - 不显示会话列表（单会话模式）
 *  - 加载中显示 loading 状态，错误显示 error 提示
 *
 * 所有样式走 design token（var(--*)），无裸 hex。
 * lucide-react 图标尺寸用 14/16（项目约定）。
 */

import { useEffect, useState } from "react";
import { MessageSquare, AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useIM } from "./useIM";
import { ChatWindow } from "./ChatWindow";
import { api } from "@/lib/api";
import type { Conversation } from "./types";

interface TaskChatPanelProps {
  workspaceId: string;
  taskId: string;
  currentUserId: string;
}

export function TaskChatPanel({ workspaceId, taskId, currentUserId }: TaskChatPanelProps) {
  const t = useTranslations("chat");
  const {
    activeConversation,
    messages,
    loading,
    error,
    selectTaskConversation,
    loadMoreMessages,
    loadingMore,
    sendMessage,
    editMessage,
    revokeMessage,
    typingUsers,
  } = useIM(workspaceId);

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 获取/创建任务关联会话
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);

    api<Conversation>(
      `/api/v1/workspaces/${workspaceId}/tasks/${taskId}/conversation`,
      { method: "POST" },
    )
      .then((conv) => {
        if (cancelled) return;
        setConversation(conv);
        void selectTaskConversation(taskId);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "Failed to load task conversation");
      });

    return () => {
      cancelled = true;
    };
  }, [workspaceId, taskId, selectTaskConversation]);

  // 加载中
  if (loading && !activeConversation) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center px-[var(--space-3)] py-[var(--space-2)] border-b border-[var(--border)]">
          <MessageSquare size={16} className="text-[var(--accent)] mr-[var(--space-2)]" />
          <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
            {t("loading")}
          </span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <span className="text-[length:var(--text-sm)] text-[var(--muted)] animate-pulse">
            {t("createLoadingMembers")}
          </span>
        </div>
      </div>
    );
  }

  // 加载错误
  if (loadError && !activeConversation) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center px-[var(--space-3)] py-[var(--space-2)] border-b border-[var(--border)]">
          <MessageSquare size={16} className="text-[var(--accent)] mr-[var(--space-2)]" />
          <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
            {t("title")}
          </span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-[var(--space-4)]">
          <AlertCircle size={24} className="text-[var(--danger)] mb-[var(--space-2)]" />
          <p className="text-[length:var(--text-sm)] text-[var(--muted)] text-center">
            {loadError}
          </p>
        </div>
      </div>
    );
  }

  // 运行时错误（useIM 内部错误）
  if (error && !activeConversation) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center px-[var(--space-3)] py-[var(--space-2)] border-b border-[var(--border)]">
          <MessageSquare size={16} className="text-[var(--accent)] mr-[var(--space-2)]" />
          <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
            {t("title")}
          </span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-[var(--space-4)]">
          <AlertCircle size={24} className="text-[var(--danger)] mb-[var(--space-2)]" />
          <p className="text-[length:var(--text-sm)] text-[var(--muted)] text-center">
            {error}
          </p>
        </div>
      </div>
    );
  }

  // 正常显示聊天窗口
  if (!activeConversation) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center px-[var(--space-3)] py-[var(--space-2)] border-b border-[var(--border)]">
          <MessageSquare size={16} className="text-[var(--accent)] mr-[var(--space-2)]" />
          <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
            {t("title")}
          </span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <span className="text-[length:var(--text-sm)] text-[var(--muted)]">
            {t("empty")}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* 标题栏 */}
      <div className="flex items-center px-[var(--space-3)] py-[var(--space-2)] border-b border-[var(--border)]">
        <MessageSquare size={16} className="text-[var(--accent)] mr-[var(--space-2)]" />
        <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
          {conversation?.title ?? activeConversation.title ?? t("title")}
        </span>
      </div>
      {/* 聊天窗口 */}
      <div className="flex-1 min-h-0">
        <ChatWindow
          conversation={activeConversation}
          messages={messages}
          currentUserId={currentUserId}
          onSend={(body, opts) => void sendMessage(activeConversation.id, body, opts)}
          onEdit={(mid, body) => void editMessage(activeConversation.id, mid, body)}
          onRevoke={(mid) => void revokeMessage(activeConversation.id, mid)}
          onLoadMore={() => void loadMoreMessages(activeConversation.id)}
          loadingMore={loadingMore}
          typingUserIds={typingUsers[activeConversation.id] ?? []}
        />
      </div>
    </div>
  );
}