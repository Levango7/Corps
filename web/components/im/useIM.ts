"use client";

/**
 * IM 主 Hook —— 管理独立 IM 的所有状态和操作
 *
 * 职责：
 *  - 加载会话列表 / 会话详情 / 消息列表
 *  - 发送 / 编辑 / 撤回消息
 *  - 创建会话
 *  - 订阅 WebSocket 实时消息（新消息 / 编辑 / 撤回 / 在线状态 / 正在输入 / 已读）
 *  - 标记已读
 *
 * 数据流：
 *  1. 初始化时 loadConversations() 拉取会话列表
 *  2. selectConversation(cid) 加载会话详情 + 消息 + 订阅 WS + 标记已读
 *  3. ws.onMessage 统一处理服务端推送，更新 conversations / messages
 *
 * 错误处理：
 *  - API 失败时 setError(message)，loading 复位
 *  - WS 消息处理异常不抛出（避免中断订阅），仅 console.error
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useIMWebSocket } from "@/lib/im/ws-client";
import { api } from "@/lib/api";
import type { ServerMessage, MessagePayload } from "@/lib/im/types";
import type {
  Conversation,
  Message,
  SendMessageOptions,
  CreateConversationParams,
} from "./types";

/** 消息分页每页条数（与后端 limit 上限 200 对齐，取 50 平衡首屏性能） */
const MESSAGES_PAGE_SIZE = 50;

/** 消息列表 API 响应（游标分页信封） */
interface MessagesListResponse {
  messages: Message[];
  hasMore: boolean;
}

/**
 * 将 WebSocket 推送的 MessagePayload 转换为前端 Message 类型。
 *
 * MessagePayload 扁平存储作者信息（authorName/authorImage），
 * 前端 Message 用嵌套 author 对象，且需补齐 attachments 等字段。
 */
function payloadToMessage(p: MessagePayload): Message {
  return {
    id: p.id,
    conversationId: p.conversationId,
    authorId: p.authorId,
    author: {
      id: p.authorId ?? "",
      name: p.authorName,
      email: null,
      image: p.authorImage,
    },
    body: p.body,
    createdAt: p.createdAt,
    editedAt: p.editedAt,
    revokedAt: p.revokedAt,
    revokedBy: null,
    replyToId: p.replyToId,
    replyTo: null,
    mentions: p.mentions,
    attachments: [],
  };
}

/** useIM Hook 返回值 */
export interface UseIMResult {
  /** 会话列表 */
  conversations: Conversation[];
  /** 当前选中的会话 */
  activeConversation: Conversation | null;
  /** 当前会话的消息列表（正序） */
  messages: Message[];
  /** 是否正在加载 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;
  /** WebSocket 连接状态 */
  wsStatus: "connecting" | "connected" | "disconnected" | "error";
  /** 加载会话列表 */
  loadConversations: () => Promise<void>;
  /** 选择会话（加载详情 + 消息 + 订阅 + 标记已读） */
  selectConversation: (cid: string) => Promise<void>;
  /** 加载更多历史消息（向上加载，用最早消息 createdAt 作 before 游标） */
  loadMoreMessages: (cid: string) => Promise<void>;
  /** 是否正在加载更多历史消息 */
  loadingMore: boolean;
  /** 发送消息 */
  sendMessage: (cid: string, body: string, opts?: SendMessageOptions) => Promise<void>;
  /** 编辑消息 */
  editMessage: (cid: string, mid: string, body: string) => Promise<void>;
  /** 撤回消息 */
  revokeMessage: (cid: string, mid: string) => Promise<void>;
  /** 创建会话 */
  createConversation: (params: CreateConversationParams) => Promise<Conversation>;
  /** 手动设置当前会话（不触发加载） */
  setActiveConversation: (c: Conversation | null) => void;
}

/**
 * IM 主 Hook。
 *
 * @param workspaceId 当前工作区 ID
 * @returns IM 状态和操作方法
 */
export function useIM(workspaceId: string): UseIMResult {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 是否正在加载更多历史消息（独立于全局 loading，避免全屏 spinner） */
  const [loadingMore, setLoadingMore] = useState(false);

  const ws = useIMWebSocket(workspaceId);

  // 当前活跃会话 ID 引用（供 WS 消息处理判断是否属于当前会话）
  const activeCidRef = useRef<string | null>(null);
  // 消息列表引用（供 loadMoreMessages 读取最早消息游标，避免依赖 messages 致使函数频繁重建）
  const messagesRef = useRef<Message[]>([]);

  /** 加载会话列表 */
  const loadConversations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<Conversation[]>(
        `/api/v1/workspaces/${workspaceId}/conversations`,
      );
      setConversations(data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load conversations");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  /** 选择会话：加载详情 + 消息 + 订阅 WS + 标记已读 */
  const selectConversation = useCallback(
    async (cid: string) => {
      setLoading(true);
      setError(null);
      try {
        // 1. 加载会话详情
        const conv = await api<Conversation>(
          `/api/v1/workspaces/${workspaceId}/conversations/${cid}`,
        );

        // 2. 加载消息列表（游标分页，取最近 MESSAGES_PAGE_SIZE 条）
        const result = await api<MessagesListResponse>(
          `/api/v1/workspaces/${workspaceId}/conversations/${cid}/messages?limit=${MESSAGES_PAGE_SIZE}`,
        );
        const initialMessages = result?.messages ?? [];
        const hasMoreMessages = result?.hasMore ?? false;

        setActiveConversation({ ...conv, hasMoreMessages });
        activeCidRef.current = cid;
        setMessages(initialMessages);

        // 3. 订阅 WebSocket
        ws.subscribe(cid);

        // 4. 标记已读（best-effort，失败不影响展示）
        try {
          await api(
            `/api/v1/workspaces/${workspaceId}/conversations/${cid}/read`,
            { method: "POST" },
          );
        } catch {
          // 标记已读失败静默忽略
        }

        // 5. 更新会话列表中的未读数
        setConversations((prev) =>
          prev.map((c) => (c.id === cid ? { ...c, unreadCount: 0 } : c)),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load conversation");
      } finally {
        setLoading(false);
      }
    },
    [workspaceId, ws],
  );

  /** 加载更多历史消息（向上加载）：用当前最早消息的 createdAt 作 before 游标 */
  const loadMoreMessages = useCallback(
    async (cid: string) => {
      const earliest = messagesRef.current[0];
      if (!earliest) return;

      setLoadingMore(true);
      try {
        const result = await api<MessagesListResponse>(
          `/api/v1/workspaces/${workspaceId}/conversations/${cid}/messages?before=${encodeURIComponent(earliest.createdAt)}&limit=${MESSAGES_PAGE_SIZE}`,
        );
        const olderMessages = result?.messages ?? [];
        const hasMoreMessages = result?.hasMore ?? false;
        // prepend 更早的消息到列表头部（时间线正序：旧在前）
        setMessages((prev) => [...olderMessages, ...prev]);
        setActiveConversation((prev) =>
          prev ? { ...prev, hasMoreMessages } : prev,
        );
      } catch (err) {
        console.error("[useIM] Failed to load more messages:", err);
      } finally {
        setLoadingMore(false);
      }
    },
    [workspaceId],
  );

  /** 发送消息 */
  const sendMessage = useCallback(
    async (cid: string, body: string, opts?: SendMessageOptions) => {
      const payload: Record<string, unknown> = { body };
      if (opts?.replyToId) payload.replyToId = opts.replyToId;
      if (opts?.mentions) payload.mentions = opts.mentions;
      // 附件：仅传服务端需要的字段（剔除本地预览用的 thumbnailUrl 中的 blob: URL 由后端处理）
      if (opts?.attachments && opts.attachments.length > 0) {
        payload.attachments = opts.attachments.map((a) => ({
          fileName: a.fileName,
          url: a.url,
          fileType: a.fileType,
          fileSize: a.fileSize,
          thumbnailUrl: a.thumbnailUrl,
        }));
      }

      const msg = await api<Message>(
        `/api/v1/workspaces/${workspaceId}/conversations/${cid}/messages`,
        { method: "POST", body: JSON.stringify(payload) },
      );
      // 乐观更新：立即追加到消息列表
      setMessages((prev) => [...prev, msg]);
    },
    [workspaceId],
  );

  /** 编辑消息 */
  const editMessage = useCallback(
    async (cid: string, mid: string, body: string) => {
      const msg = await api<Message>(
        `/api/v1/workspaces/${workspaceId}/conversations/${cid}/messages/${mid}`,
        { method: "PATCH", body: JSON.stringify({ body }) },
      );
      setMessages((prev) => prev.map((m) => (m.id === mid ? msg : m)));
    },
    [workspaceId],
  );

  /** 撤回消息 */
  const revokeMessage = useCallback(
    async (cid: string, mid: string) => {
      await api(
        `/api/v1/workspaces/${workspaceId}/conversations/${cid}/messages/${mid}`,
        { method: "DELETE" },
      );
      // 本地标记撤回（WS 也会推送，此处乐观更新）
      setMessages((prev) =>
        prev.map((m) =>
          m.id === mid ? { ...m, revokedAt: new Date().toISOString() } : m,
        ),
      );
    },
    [workspaceId],
  );

  /** 创建会话 */
  const createConversation = useCallback(
    async (params: CreateConversationParams): Promise<Conversation> => {
      const conv = await api<Conversation>(
        `/api/v1/workspaces/${workspaceId}/conversations`,
        { method: "POST", body: JSON.stringify(params) },
      );
      // 追加到会话列表
      setConversations((prev) => [...prev, conv]);
      return conv;
    },
    [workspaceId],
  );

  /** WebSocket 消息处理：统一分发服务端推送 */
  useEffect(() => {
    const unsubscribe = ws.onMessage((msg: ServerMessage) => {
      try {
        switch (msg.type) {
          case "message": {
            // 新消息 → 追加到当前会话消息列表
            if (msg.conversationId === activeCidRef.current) {
              setMessages((prev) => [...prev, payloadToMessage(msg.message)]);
            }
            // 更新会话列表的 lastMessageAt 和未读数
            setConversations((prev) =>
              prev.map((c) =>
                c.id === msg.conversationId
                  ? {
                      ...c,
                      lastMessageAt: msg.message.createdAt,
                      unreadCount:
                        c.id === activeCidRef.current
                          ? 0
                          : (c.unreadCount ?? 0) + 1,
                    }
                  : c,
              ),
            );
            break;
          }
          case "edit": {
            // 编辑消息 → 更新消息列表
            if (msg.conversationId === activeCidRef.current) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === msg.messageId
                    ? { ...m, body: msg.body, editedAt: msg.editedAt }
                    : m,
                ),
              );
            }
            break;
          }
          case "revoke": {
            // 撤回消息 → 更新消息列表
            if (msg.conversationId === activeCidRef.current) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === msg.messageId ? { ...m, revokedAt: msg.revokedAt } : m,
                ),
              );
            }
            break;
          }
          case "presence": {
            // 在线状态变更：目前仅更新会话成员的在线标记（未来扩展）
            // 会话成员没有 online 字段，此处预留扩展点
            break;
          }
          case "typing": {
            // 正在输入：由专门的 typing 状态管理（未来扩展）
            break;
          }
          case "read": {
            // 已读回执：更新消息已读状态（未来扩展）
            break;
          }
          case "error": {
            console.error("[useIM] WebSocket error:", msg.message);
            break;
          }
        }
      } catch (err) {
        console.error("[useIM] Message handling error:", err);
      }
    });
    return unsubscribe;
  }, [ws]);

  // 同步消息列表引用（供 loadMoreMessages 读取游标）
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // 初始加载会话列表
  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  return {
    conversations,
    activeConversation,
    messages,
    loading,
    error,
    wsStatus: ws.status,
    loadConversations,
    selectConversation,
    loadMoreMessages,
    loadingMore,
    sendMessage,
    editMessage,
    revokeMessage,
    createConversation,
    setActiveConversation,
  };
}