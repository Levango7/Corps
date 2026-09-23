"use client";

/**
 * IM 客户端容器组件
 *
 * 供 /w/[wid]/im 和 /w/[wid]/im/[cid] 两个服务端页面共享。
 *
 * 职责：
 *  - 用 useIM hook 管理会话/消息状态
 *  - 左侧：ConversationList（会话列表）
 *  - 右侧：空状态提示 或 ChatWindow
 *  - 顶部创建会话弹窗、设置面板、消息搜索面板按需渲染
 *  - 响应式：移动端只显示列表或聊天窗口（通过 selectedCid 控制）
 *
 * 所有样式走 design token（var(--*)），无裸 hex。
 * lucide-react 图标尺寸用 14/16（项目约定）。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { MessageSquare, ArrowLeft, X, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/lib/i18n-navigation";
import { useIM } from "./useIM";
import { ConversationList } from "./ConversationList";
import { ChatWindow } from "./ChatWindow";
import { MessageSearch } from "./MessageSearch";
import { ConversationCreate } from "./ConversationCreate";
import { ConversationSettings } from "./ConversationSettings";
import { api } from "@/lib/api";

interface IMClientProps {
  /** 当前工作区 ID */
  workspaceId: string;
  /** 初始会话 ID（从路由 /im/[cid] 进入时指定） */
  initialConversationId?: string;
  /** 单会话模式：仅显示指定会话，无列表/搜索/创建 */
  singleConversationId?: string;
}

export function IMClient({ workspaceId, initialConversationId, singleConversationId }: IMClientProps) {
  const t = useTranslations("chat");
  const router = useRouter();
  const {
    conversations,
    activeConversation,
    messages,
    loading,
    error,
    selectConversation,
    loadMoreMessages,
    loadingMore,
    sendMessage,
    editMessage,
    revokeMessage,
    loadConversations,
    typingUsers,
  } = useIM(workspaceId, t);

  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 移动端视图：list | chat
  const [mobileView, setMobileView] = useState<"list" | "chat">("list");

  // 加载当前用户 ID
  useEffect(() => {
    api<{ id: string }>("/api/v1/users/me")
      .then((u) => setCurrentUserId(u.id))
      .catch(() => {});
  }, []);

  // 若从 /im/[cid] 进入，自动选中该会话
  useEffect(() => {
    if (initialConversationId && currentUserId) {
      selectConversation(initialConversationId).catch(() => {});
      setMobileView("chat");
    }
  }, [initialConversationId, currentUserId, selectConversation]);

  // 单会话模式：自动选中指定会话，不做 URL 跳转
  useEffect(() => {
    if (singleConversationId && currentUserId) {
      selectConversation(singleConversationId).catch(() => {});
      setMobileView("chat");
    }
  }, [singleConversationId, currentUserId, selectConversation]);

  /** 是否为单会话模式 */
  const isSingleMode = !!singleConversationId;

  /** 选择会话 */
  const handleSelect = useCallback(
    (id: string) => {
      selectConversation(id).catch(() => {});
      setMobileView("chat");
      // 单会话模式下不做 URL 跳转
      if (!isSingleMode) {
        router.push(`/w/${workspaceId}/im/${id}`);
      }
    },
    [selectConversation, router, workspaceId, isSingleMode],
  );

  /** 创建会话成功 */
  const handleCreated = useCallback(
    (conversationId: string) => {
      setCreateOpen(false);
      loadConversations().catch(() => {});
      selectConversation(conversationId).catch(() => {});
      setMobileView("chat");
      router.push(`/w/${workspaceId}/im/${conversationId}`);
    },
    [loadConversations, selectConversation, router, workspaceId],
  );

  /** 设置面板更新后刷新 */
  const handleSettingsUpdate = useCallback(() => {
    loadConversations().catch(() => {});
  }, [loadConversations]);

  /** 退出/删除会话后 */
  const handleSettingsLeave = useCallback(() => {
    setSettingsOpen(false);
    loadConversations().catch(() => {});
    setMobileView("list");
    router.push(`/w/${workspaceId}/im`);
  }, [loadConversations, router, workspaceId]);

  /** 移动端返回列表 */
  const handleBackToList = useCallback(() => {
    setMobileView("list");
    router.push(`/w/${workspaceId}/im`);
  }, [router, workspaceId]);

  /** 搜索跳转 */
  const handleJumpToMessage = useCallback(
    (conversationId: string, _messageId: string) => {
      setSearchOpen(false);
      selectConversation(conversationId).catch(() => {});
      setMobileView("chat");
      router.push(`/w/${workspaceId}/im/${conversationId}`);
    },
    [selectConversation, router, workspaceId],
  );

  const hasActive = !!activeConversation;
  const showChat = useMemo(
    () => hasActive && (mobileView === "chat" || typeof window !== "undefined"),
    [hasActive, mobileView],
  );

  return (
    <div className="flex h-[calc(100dvh-var(--topbar-h)-var(--space-8))] lg:h-[calc(100dvh-var(--topbar-h)-var(--space-12))] rounded-[var(--radius-lg)] overflow-hidden border border-[var(--border)] bg-[var(--surface)] shadow-[var(--elev-sm)]">
      {/* 左侧会话列表（桌面常驻 / 移动端 list 视图 / 单会话模式下隐藏） */}
      <div
        className={`${
          isSingleMode ? "hidden" : mobileView === "list" ? "flex" : "hidden"
        } md:${isSingleMode ? "hidden" : "flex"} w-full md:w-72 lg:w-80 shrink-0`}
      >
        <ConversationList
          conversations={conversations}
          activeId={activeConversation?.id ?? null}
          currentUserId={currentUserId}
          onSelect={handleSelect}
          onSearch={() => setSearchOpen(true)}
          onCreate={() => setCreateOpen(true)}
        />
      </div>

      {/* 右侧聊天窗口（桌面常驻 / 移动端 chat 视图 / 单会话模式始终显示） */}
      <div
        className={`${
          isSingleMode ? "flex" : mobileView === "chat" ? "flex" : "hidden"
        } md:flex flex-1 min-w-0`}
      >
        {showChat && activeConversation ? (
          <div className="flex flex-col w-full h-full">
            {/* 移动端返回栏（单会话模式下隐藏） */}
            {!isSingleMode && (
              <button
                type="button"
                onClick={handleBackToList}
                className="md:hidden flex items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] border-b border-[var(--border)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
              >
                <ArrowLeft size={16} />
                {t("backToList")}
              </button>
            )}
            <div className="flex-1 min-h-0">
              <ChatWindow
                conversation={activeConversation}
                messages={messages}
                currentUserId={currentUserId}
                onSend={(body, opts) => sendMessage(activeConversation.id, body, opts).catch(() => {})}
                onEdit={(mid, body) => editMessage(activeConversation.id, mid, body).catch(() => {})}
                onRevoke={(mid) => revokeMessage(activeConversation.id, mid).catch(() => {})}
                onLoadMore={() => loadMoreMessages(activeConversation.id).catch(() => {})}
                loadingMore={loadingMore}
                onSettings={
                  activeConversation.type === "group" || activeConversation.type === "direct"
                    ? () => setSettingsOpen(true)
                    : undefined
                }
                typingUserIds={typingUsers[activeConversation.id] ?? []}
              />
            </div>
          </div>
        ) : (
          /* 空状态 */
          <div className="flex flex-col items-center justify-center w-full h-full text-center px-[var(--space-6)]">
            <span className="w-14 h-14 flex items-center justify-center rounded-[var(--radius-lg)] bg-[var(--accent-soft)] text-[var(--accent)] mb-[var(--space-4)]">
              <MessageSquare size={24} />
            </span>
            <p className="text-[length:var(--text-base)] font-[weight:var(--weight-medium)] text-[var(--fg)] mb-[var(--space-1)]">
              {t("selectConversationPrompt")}
            </p>
            <p className="text-[length:var(--text-sm)] text-[var(--muted)] max-w-xs mb-[var(--space-4)]">
              {t("startChatting")}
            </p>
            {/* 会话列表为空时显示创建会话按钮 */}
            {conversations.length === 0 && (
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="inline-flex items-center gap-[var(--space-2)] h-9 px-[var(--space-4)] rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)] transition-colors duration-[var(--motion-fast)]"
              >
                <Plus size={16} />
                {t("createConversationButton")}
              </button>
            )}
          </div>
        )}
      </div>

      {/* 加载/错误浮层（仅在加载且无活跃会话时） */}
      {loading && !hasActive && (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--surface)]/60 pointer-events-none">
          <span className="text-[length:var(--text-sm)] text-[var(--muted)] animate-pulse">
            {t("createLoadingMembers")}
          </span>
        </div>
      )}
      {error && !hasActive && (
        <div className="absolute bottom-[var(--space-4)] left-1/2 -translate-x-1/2 px-[var(--space-3)] py-[var(--space-2)] rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[length:var(--text-xs)] text-[var(--danger)]">
          {error}
        </div>
      )}

      {/* 创建会话弹窗 */}
      {createOpen && currentUserId && (
        <ConversationCreate
          workspaceId={workspaceId}
          currentUserId={currentUserId}
          conversations={conversations}
          onCreated={handleCreated}
          onClose={() => setCreateOpen(false)}
        />
      )}

      {/* 消息搜索面板（模态包裹） */}
      {searchOpen && (
        <div
          className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-[var(--space-4)]"
          role="dialog"
          aria-modal="true"
          aria-label={t("search")}
        >
          <div
            className="absolute inset-0 bg-[var(--overlay)]"
            onClick={() => setSearchOpen(false)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-lg h-[70vh] flex flex-col bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-lg)] overflow-hidden">
            <div className="flex items-center justify-between px-[var(--space-4)] py-[var(--space-3)] border-b border-[var(--border)]">
              <h2 className="text-[length:var(--text-base)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
                {t("search")}
              </h2>
              <button
                type="button"
                onClick={() => setSearchOpen(false)}
                aria-label={t("cancel")}
                className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-md)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)]"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 min-h-0">
              <MessageSearch workspaceId={workspaceId} onJumpToMessage={handleJumpToMessage} />
            </div>
          </div>
        </div>
      )}

      {/* 会话设置面板 */}
      {settingsOpen && activeConversation && currentUserId && (
        <ConversationSettings
          conversation={activeConversation}
          currentUserId={currentUserId}
          onClose={() => setSettingsOpen(false)}
          onUpdate={handleSettingsUpdate}
          onLeave={handleSettingsLeave}
        />
      )}
    </div>
  );
}