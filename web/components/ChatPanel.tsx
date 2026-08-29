"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useTranslations } from "next-intl";
import type { ChatMessage, Person, AttachmentMeta } from "./chat/types";
import { useChatStream } from "./chat/useChatStream";
import { ChatHeader } from "./chat/ChatHeader";
import { MessageList } from "./chat/MessageList";
import { MessageInput } from "./chat/MessageInput";

/**
 * 任务级即时聊天面板（IM 升级版）
 *
 * 升级内容：
 *  - SSE 实时推送替代 5s 轮询（降级时自动回退轮询）
 *  - 消息已读状态 + 双勾✓✓回执
 *  - 在线状态指示
 *  - 文件附件分享（图片预览 + 文档下载）
 *  - UI 打磨：消息气泡、时间戳分组、滚动动画、未读高亮、消息搜索
 *
 * Props 接口保持与旧版兼容：{ wid, taskId }
 *
 * 架构：
 *  - useChatStream(taskId)：SSE 连接管理 + 断线重连 + 降级轮询
 *  - ChatHeader：标题 + 搜索 + 在线状态栏
 *  - MessageList：消息列表 + 时间分组 + 滚动 + 未读高亮
 *  - MessageInput：文件按钮 + 文本框 + 发送按钮
 */

/** 已读标记防抖延迟 */
const MARK_READ_DEBOUNCE_MS = 1000;

export default function ChatPanel({ wid, taskId }: { wid: string; taskId: string }) {
  const t = useTranslations("chat");
  const base = `/api/v1/workspaces/${wid}/tasks/${taskId}/messages`;
  const streamUrl = `${base}/stream`;
  const sendUrl = `${base}/send`;
  const readUrl = `${base}/read`;
  const uploadUrl = `${base}/attachments`;
  const membersUrl = `/api/v1/workspaces/${wid}/members`;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [members, setMembers] = useState<Person[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // 未读消息 ID 集合（他人发的、尚未标记已读的）
  const [unreadIds, setUnreadIds] = useState<Set<string>>(new Set());
  // 已读标记防抖定时器
  const markReadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 增量游标（用于 SSE 断线重连补偿）
  const sinceRef = useRef<string | null>(null);

  /** 更新增量游标 */
  const updateCursor = useCallback((createdAt: string) => {
    const prev = sinceRef.current;
    if (!prev || new Date(createdAt) > new Date(prev)) {
      sinceRef.current = createdAt;
    }
  }, []);

  /** 首次加载：消息列表 */
  const loadInitial = useCallback(async () => {
    try {
      const msgs = await api<ChatMessage[]>(base);
      setMessages(msgs);
      if (msgs.length > 0) {
        updateCursor(msgs[msgs.length - 1].createdAt);
      }
    } catch {
      // 静默失败，不阻塞页面
    } finally {
      setLoading(false);
    }
  }, [base, updateCursor]);

  /** 加载工作区成员（用于在线状态头像 + 当前用户 ID） */
  const loadMembers = useCallback(async () => {
    try {
      const data = await api<(Person & { isSelf?: boolean })[]>(membersUrl);
      setMembers(data);
      // 从 isSelf 字段获取当前用户 ID
      const self = data.find((m) => m.isSelf);
      if (self) {
        setCurrentUserId(self.id);
        // 计算未读消息（他人发的、没有自己已读记录的）
        setMessages((prev) => {
          const unread = new Set<string>();
          for (const m of prev) {
            if (m.authorId !== self.id && !m.reads?.some((r) => r.userId === self.id)) {
              unread.add(m.id);
            }
          }
          setUnreadIds(unread);
          return prev;
        });
      }
    } catch {
      // 静默失败
    }
  }, [membersUrl]);

  useEffect(() => {
    loadInitial();
    loadMembers();
  }, [loadInitial, loadMembers]);

  /** SSE onMessage 回调：追加新消息 */
  const handleNewMessage = useCallback(
    (message: ChatMessage) => {
      setMessages((prev) => {
        // 去重（断线重连补偿可能重复）
        if (prev.some((m) => m.id === message.id)) return prev;
        return [...prev, message];
      });
      updateCursor(message.createdAt);

      // 如果是他人消息，加入未读集合
      if (message.authorId !== currentUserId) {
        setUnreadIds((prev) => new Set(prev).add(message.id));
      }
    },
    [currentUserId, updateCursor],
  );

  /** SSE onRead 回调：更新已读回执 */
  const handleRead = useCallback(
    (messageId: string, userId: string, readAt: string) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m;
          const reads = m.reads ?? [];
          // 去重
          if (reads.some((r) => r.userId === userId)) return m;
          return { ...m, reads: [...reads, { userId, readAt }] };
        }),
      );
      // 如果是自己已读，从未读集合移除
      if (userId === currentUserId) {
        setUnreadIds((prev) => {
          const next = new Set(prev);
          next.delete(messageId);
          return next;
        });
      }
    },
    [currentUserId],
  );

  /** SSE 连接 */
  const { connected, onlineUsers } = useChatStream({
    streamUrl,
    pollUrl: base,
    enabled: !loading,
    onMessage: handleNewMessage,
    onRead: handleRead,
    currentUserId,
  });

  /** 批量标记未读消息为已读（防抖） */
  const markUnreadAsRead = useCallback(async () => {
    if (!currentUserId || unreadIds.size === 0) return;
    const ids = Array.from(unreadIds);
    setUnreadIds(new Set()); // 乐观更新
    try {
      await api(readUrl, {
        method: "PATCH",
        body: JSON.stringify({ messageIds: ids }),
      });
    } catch {
      // 失败回滚
      setUnreadIds((prev) => new Set([...prev, ...ids]));
    }
  }, [currentUserId, unreadIds, readUrl]);

  // 防抖标记已读（消息变化或面板可见时触发）
  useEffect(() => {
    if (loading || !currentUserId || unreadIds.size === 0) return;
    if (markReadTimerRef.current) clearTimeout(markReadTimerRef.current);
    markReadTimerRef.current = setTimeout(markUnreadAsRead, MARK_READ_DEBOUNCE_MS);
    return () => {
      if (markReadTimerRef.current) clearTimeout(markReadTimerRef.current);
    };
  }, [loading, currentUserId, unreadIds, markUnreadAsRead]);

  /** 发送消息 */
  const handleSend = useCallback(
    async (body: string, attachments: AttachmentMeta[]) => {
      if (sending) return;
      setSending(true);
      try {
        const created = await api<ChatMessage>(sendUrl, {
          method: "POST",
          body: JSON.stringify({
            body,
            attachments: attachments.length > 0 ? attachments : undefined,
          }),
        });
        // 乐观更新（SSE 也会推送，但自己发的消息不等 SSE）
        setMessages((prev) => {
          if (prev.some((m) => m.id === created.id)) return prev;
          return [...prev, created];
        });
        updateCursor(created.createdAt);
      } finally {
        setSending(false);
      }
    },
    [sending, sendUrl, updateCursor],
  );

  /** 上传文件 */
  const handleUploadFile = useCallback(
    async (file: File): Promise<AttachmentMeta> => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(uploadUrl, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({ message: "上传失败" }));
        throw new Error(json.message || `上传失败 (${res.status})`);
      }
      const json = await res.json();
      return json.data as AttachmentMeta;
    },
    [uploadUrl],
  );

  // 搜索结果计数
  const searchResultCount = useMemo(() => {
    if (!searchQuery.trim()) return 0;
    const q = searchQuery.toLowerCase();
    return messages.filter((m) => m.body.toLowerCase().includes(q)).length;
  }, [messages, searchQuery]);

  return (
    <section className="mt-[var(--space-6)]">
      <ChatHeader
        messageCount={messages.length}
        onlineUsers={onlineUsers}
        members={members}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchOpen={searchOpen}
        onToggleSearch={() => {
          setSearchOpen((prev) => !prev);
          if (searchOpen) setSearchQuery("");
        }}
      />

      {searchOpen && searchQuery.trim() && (
        <div className="mb-2 text-[length:var(--text-xs)] text-[var(--meta)]">
          {searchResultCount > 0 ? `${searchResultCount} 条结果` : t("noResults")}
        </div>
      )}

      <MessageList
        messages={messages}
        currentUserId={currentUserId}
        unreadIds={unreadIds}
        searchQuery={searchQuery}
        loading={loading}
        connected={connected}
      />

      <MessageInput
        onSend={handleSend}
        onUploadFile={handleUploadFile}
        sending={sending}
        uploadUrl={uploadUrl}
      />
    </section>
  );
}
