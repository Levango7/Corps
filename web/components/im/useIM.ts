"use client";

/**
 * IM 主 Hook —— 管理独立 IM 的所有状态和操作
 *
 * 职责：
 *  - 加载会话列表 / 会话详情 / 消息列表
 *  - 发送 / 编辑 / 撤回消息
 *  - 创建会话
 *  - 订阅 WebSocket 实时消息（新消息 / 编辑 / 撤回 / 在线状态 / 正在输入 / 已读）
 *  - WS 不可用时按 ADR-009 §2.1.1 以 5s 轮询兜底（见下方「轮询兜底」effect）
 *  - 标记已读
 *
 * 数据流：
 *  1. 初始化时 loadConversations() 拉取会话列表
 *  2. selectConversation(cid) 加载会话详情 + 消息 + 订阅 WS + 标记已读
 *  3. ws.onMessage 统一处理服务端推送，更新 conversations / messages
 *  4. WS 未连接时，5s 轮询用 `?after=` 游标增量补齐消息与会话列表
 *
 * 错误处理：
 *  - API 失败时 setError(message)，loading 复位
 *  - WS 消息处理异常不抛出（避免中断订阅），仅 console.error
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useIMWebSocket } from "@/lib/im/ws-client";
import { api, apiList } from "@/lib/api";
import type { ServerMessage, MessagePayload } from "@/lib/im/types";
import type { Conversation, Message, SendMessageOptions, CreateConversationParams } from "./types";

/** 消息分页每页条数（与后端 limit 上限 200 对齐，取 50 平衡首屏性能） */
const MESSAGES_PAGE_SIZE = 50;

/**
 * 轮询兜底间隔（ms）。
 *
 * ADR-009 §2.1.1 裁定的 MVP 实时方案就是「5s 间隔 + 游标增量」，此处取同一口径。
 */
const POLL_INTERVAL_MS = 5_000;

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
    type: p.type ?? "text",
    createdAt: p.createdAt,
    editedAt: p.editedAt,
    revokedAt: p.revokedAt,
    revokedBy: null,
    replyToId: p.replyToId,
    replyTo: null,
    mentions: p.mentions,
    attachments: [],
    // call_invite 消息默认通话状态为 ongoing
    callStatus: p.type === "call_invite" ? "ongoing" : undefined,
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
  /**
   * 加载会话列表。
   * @param opts.silent 静默刷新：不动 loading / error，供轮询兜底调用
   */
  loadConversations: (opts?: { silent?: boolean }) => Promise<void>;
  /** 选择会话（加载详情 + 消息 + 订阅 + 标记已读） */
  selectConversation: (cid: string) => Promise<void>;
  /** 从任务 ID 获取/创建关联会话（任务详情页内嵌聊天用） */
  selectTaskConversation: (taskId: string) => Promise<void>;
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
  /**
   * 正在输入的用户列表。
   * key 为 conversationId，value 为正在输入的 userId 列表。
   * typing 状态 5 秒无更新自动清除。
   */
  typingUsers: Record<string, string[]>;
}

/**
 * IM 主 Hook。
 *
 * @param workspaceId 当前工作区 ID
 * @param t i18n 翻译函数（useTranslations("chat") 的返回值），用于错误消息本地化
 * @returns IM 状态和操作方法
 */
export function useIM(workspaceId: string, t?: (key: string) => string): UseIMResult {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 是否正在加载更多历史消息（独立于全局 loading，避免全屏 spinner） */
  const [loadingMore, setLoadingMore] = useState(false);
  /**
   * 正在输入的用户列表。
   * key 为 conversationId，value 为正在输入的 userId 列表。
   * 由 WebSocket "typing" 消息驱动，5 秒无更新自动清除。
   */
  const [typingUsers, setTypingUsers] = useState<Record<string, string[]>>({});

  const ws = useIMWebSocket(workspaceId);
  /**
   * 是否已建立 WS 连接。
   * 只取布尔值、不把整个 status 放进依赖：status 会在 connecting→error→connecting
   * 之间随重连抖动，若直接依赖它，5s 轮询定时器会被反复重建而打断节奏。
   */
  const wsConnected = ws.status === "connected";

  // 当前活跃会话 ID 引用（供 WS 消息处理判断是否属于当前会话）
  const activeCidRef = useRef<string | null>(null);
  // 请求序号（递增 counter），用于 selectConversation 竞态条件防护
  const requestSeqRef = useRef(0);
  // 消息列表引用（供 loadMoreMessages 读取最早消息游标，避免依赖 messages 致使函数频繁重建）
  const messagesRef = useRef<Message[]>([]);
  /**
   * typing 过期定时器映射。
   * key 为 `${conversationId}:${userId}`，value 为 setTimeout 句柄。
   * 每次收到 typing=true 时重置对应定时器，5 秒后清除该用户的 typing 状态。
   */
  const typingTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  /**
   * 上一次观察到的各会话未读数（轮询兜底用）。
   * `null` 表示基线尚未建立——首次快照只记录不通知。
   */
  const unreadSnapshotRef = useRef<Map<string, number> | null>(null);

  /**
   * 轮询兜底下的「非活跃会话新消息」浏览器通知。
   *
   * 为什么需要：这个通知原本只挂在 `ws.onMessage` 的 "message" 分支（见下方 effect），
   * 而 WS 在本部署连不上（Next standalone 不处理 upgrade，实测部署产物
   * `.next/standalone/web/server.js` 里 `handleImUpgrade` 出现 0 次）→ 那个分支永不执行
   * → 非活跃会话的新消息**从不弹通知**。轮询拿到会话列表后用未读数增量还原同一行为。
   *
   * 未读口径由后端保证「只统计他人消息」（`conversations/route.ts:118` 的
   * `author_id IS DISTINCT FROM userId`），所以未读数增加必然意味着别人发了消息。
   *
   * 首次快照只建基线不通知：否则每次打开 IM 页面都会为历史未读刷一屏通知。
   */
  const notifyOnUnreadIncrease = useCallback((list: Conversation[]) => {
    const prev = unreadSnapshotRef.current;
    const next = new Map<string, number>();
    for (const c of list) next.set(c.id, c.unreadCount ?? 0);
    unreadSnapshotRef.current = next;

    if (prev === null) return;
    if (typeof window === "undefined" || typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;

    for (const c of list) {
      // 正在看的会话不弹（与 ws.onMessage 的 "message" 分支同口径）
      if (c.id === activeCidRef.current) continue;
      if ((c.unreadCount ?? 0) <= (prev.get(c.id) ?? 0)) continue;

      const last = c.lastMessage;
      try {
        const notification = new Notification(last?.author?.name || c.title || "新消息", {
          body: last?.body ?? "",
          icon: last?.author?.image ?? undefined,
        });
        notification.onclick = () => {
          window.focus();
          notification.close();
        };
      } catch {
        // 非用户手势上下文等限制下构造失败，静默忽略（与 ws 分支同口径）
      }
    }
  }, []);

  /**
   * 加载会话列表。
   *
   * @param opts.silent 静默刷新：不动 loading / error，供轮询兜底每 5s 调用。
   *   若沿用非静默路径，会话列表会每 5s 闪一次全屏 spinner，
   *   且一次轮询失败会把页面级 error 点亮。
   */
  const loadConversations = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent === true;
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        // GET /conversations 返回分页信封 { items, nextCursor, hasMore }，不是裸数组。
        // 曾把信封直接存进 conversations，下一次 setConversations(prev => prev.map(...))
        // 就在渲染期抛 TypeError，任务详情页整体被打进路由级错误边界。
        const list = await apiList<Conversation>(`/api/v1/workspaces/${workspaceId}/conversations`);
        setConversations(list);
        // 未读增量 → 非活跃会话的新消息通知（WS 不可用时的替代路径）
        notifyOnUnreadIncrease(list);
      } catch (err) {
        // 静默刷新失败不写 error：下一个 tick 会重试，不该把轮询抖动冒泡成页面错误
        if (silent) return;
        setError(
          err instanceof Error
            ? err.message
            : (t?.("loadConversationsFailed") ?? "Failed to load conversations"),
        );
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [workspaceId, t, notifyOnUnreadIncrease],
  );

  /** 选择会话：加载详情 + 消息 + 订阅 WS + 标记已读 */
  const selectConversation = useCallback(
    async (cid: string) => {
      // 递增请求序号，用于竞态条件防护
      const seq = ++requestSeqRef.current;
      setLoading(true);
      setError(null);
      try {
        // 1. 加载会话详情
        const conv = await api<Conversation>(
          `/api/v1/workspaces/${workspaceId}/conversations/${cid}`,
        );

        // 竞态检查：如果用户已切换到其他会话，丢弃此旧响应
        if (seq !== requestSeqRef.current) return;

        // 2. 加载消息列表（游标分页，取最近 MESSAGES_PAGE_SIZE 条）
        const result = await api<MessagesListResponse>(
          `/api/v1/workspaces/${workspaceId}/conversations/${cid}/messages?limit=${MESSAGES_PAGE_SIZE}`,
        );

        // 竞态检查：加载消息后再次确认
        if (seq !== requestSeqRef.current) return;

        const initialMessages = result?.messages ?? [];
        const hasMoreMessages = result?.hasMore ?? false;

        setActiveConversation({ ...conv, hasMoreMessages });
        activeCidRef.current = cid;
        setMessages(initialMessages);

        // 3. 订阅 WebSocket
        ws.subscribe(cid);

        // 4. 标记已读（best-effort，失败不影响展示）
        try {
          await api(`/api/v1/workspaces/${workspaceId}/conversations/${cid}/read`, {
            method: "POST",
          });
        } catch {
          // 标记已读失败静默忽略
        }

        // 5. 更新会话列表中的未读数
        setConversations((prev) => prev.map((c) => (c.id === cid ? { ...c, unreadCount: 0 } : c)));
      } catch (err) {
        // 竞态检查：错误响应也需丢弃旧请求
        if (seq !== requestSeqRef.current) return;
        setError(
          err instanceof Error
            ? err.message
            : (t?.("loadConversationFailed") ?? "Failed to load conversation"),
        );
      } finally {
        // 竞态检查：仅当前请求才复位 loading
        if (seq === requestSeqRef.current) {
          setLoading(false);
        }
      }
    },
    [workspaceId, ws, t],
  );

  /** 从任务 ID 获取/创建关联会话（任务详情页内嵌聊天用） */
  const selectTaskConversation = useCallback(
    async (taskId: string) => {
      try {
        setError(null);
        const conv = await api<Conversation>(
          `/api/v1/workspaces/${workspaceId}/tasks/${taskId}/conversation`,
          { method: "POST" },
        );
        await selectConversation(conv.id);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : (t?.("loadTaskConversationFailed") ?? "Failed to load task conversation"),
        );
      }
    },
    [workspaceId, selectConversation, t],
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
        setActiveConversation((prev) => (prev ? { ...prev, hasMoreMessages } : prev));
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
      if (opts?.type) payload.type = opts.type;
      // 附件：仅传服务端需要的字段（剔除本地预览用的 thumbnailUrl 中的 blob: URL 由后端处理）
      // 字段名对齐后端 zod schema：filename / mimeType / size
      if (opts?.attachments && opts.attachments.length > 0) {
        payload.attachments = opts.attachments.map((a) => ({
          filename: a.fileName,
          url: a.url,
          mimeType: a.fileType,
          size: a.fileSize,
          thumbnailUrl: a.thumbnailUrl,
        }));
      }

      try {
        const msg = await api<Message>(
          `/api/v1/workspaces/${workspaceId}/conversations/${cid}/messages`,
          { method: "POST", body: JSON.stringify(payload) },
        );
        // 乐观更新：立即追加到消息列表
        setMessages((prev) => [...prev, msg]);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : (t?.("sendMessageFailed") ?? "Failed to send message"),
        );
        throw err;
      }
    },
    [workspaceId, t],
  );

  /** 编辑消息 */
  const editMessage = useCallback(
    async (cid: string, mid: string, body: string) => {
      try {
        const msg = await api<Message>(
          `/api/v1/workspaces/${workspaceId}/conversations/${cid}/messages/${mid}`,
          { method: "PATCH", body: JSON.stringify({ body }) },
        );
        setMessages((prev) => prev.map((m) => (m.id === mid ? msg : m)));
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : (t?.("editMessageFailed") ?? "Failed to edit message"),
        );
        throw err;
      }
    },
    [workspaceId, t],
  );

  /** 撤回消息 */
  const revokeMessage = useCallback(
    async (cid: string, mid: string) => {
      try {
        await api(`/api/v1/workspaces/${workspaceId}/conversations/${cid}/messages/${mid}`, {
          method: "DELETE",
        });
        // 本地标记撤回（WS 也会推送，此处乐观更新）
        setMessages((prev) =>
          prev.map((m) => (m.id === mid ? { ...m, revokedAt: new Date().toISOString() } : m)),
        );
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : (t?.("revokeMessageFailed") ?? "Failed to revoke message"),
        );
        throw err;
      }
    },
    [workspaceId, t],
  );

  /** 创建会话 */
  const createConversation = useCallback(
    async (params: CreateConversationParams): Promise<Conversation> => {
      try {
        const conv = await api<Conversation>(`/api/v1/workspaces/${workspaceId}/conversations`, {
          method: "POST",
          body: JSON.stringify(params),
        });
        // 追加到会话列表
        setConversations((prev) => [...prev, conv]);
        return conv;
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : (t?.("createConversationFailed") ?? "Failed to create conversation"),
        );
        throw err;
      }
    },
    [workspaceId, t],
  );

  /** WebSocket 消息处理：统一分发服务端推送 */
  useEffect(() => {
    const unsubscribe = ws.onMessage((msg: ServerMessage) => {
      try {
        switch (msg.type) {
          case "message": {
            // 新消息 → 追加到当前会话消息列表
            if (msg.conversationId === activeCidRef.current) {
              const newMessage = payloadToMessage(msg.message);
              // 如果收到 call_ended 或 call_rejected 消息，
              // 更新同会话中最近的 call_invite 消息的 callStatus
              if (newMessage.type === "call_ended" || newMessage.type === "call_rejected") {
                const callStatus = newMessage.type === "call_ended" ? "ended" : "rejected";
                setMessages((prev) => {
                  // 从末尾向前查找最近的 call_invite 消息
                  const updated = [...prev];
                  for (let i = updated.length - 1; i >= 0; i--) {
                    if (updated[i].type === "call_invite") {
                      updated[i] = { ...updated[i], callStatus };
                      break;
                    }
                  }
                  return [...updated, newMessage];
                });
              } else {
                // 新 call_invite 消息默认 callStatus 为 "ongoing"
                if (newMessage.type === "call_invite") {
                  newMessage.callStatus = "ongoing";
                }
                setMessages((prev) => [...prev, newMessage]);
              }
            } else {
              // 非当前活跃会话 → 触发浏览器通知（需权限已授予）
              // 仅在浏览器环境且权限已授予时弹出，避免在 SSR 或权限未授予时报错
              if (
                typeof window !== "undefined" &&
                typeof Notification !== "undefined" &&
                Notification.permission === "granted"
              ) {
                try {
                  const notification = new Notification(msg.message.authorName || "新消息", {
                    body: msg.message.body,
                    icon: msg.message.authorImage || undefined,
                  });
                  // MVP：通知点击时聚焦窗口（暂不实现跳转到对应会话）
                  notification.onclick = () => {
                    window.focus();
                    notification.close();
                  };
                } catch {
                  // 通知构造失败静默忽略（部分浏览器在非用户手势上下文限制通知）
                }
              }
            }
            // 更新会话列表的 lastMessageAt 和未读数
            setConversations((prev) =>
              prev.map((c) =>
                c.id === msg.conversationId
                  ? {
                      ...c,
                      lastMessageAt: msg.message.createdAt,
                      unreadCount: c.id === activeCidRef.current ? 0 : (c.unreadCount ?? 0) + 1,
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
                  m.id === msg.messageId ? { ...m, body: msg.body, editedAt: msg.editedAt } : m,
                ),
              );
            }
            break;
          }
          case "revoke": {
            // 撤回消息 → 更新消息列表
            if (msg.conversationId === activeCidRef.current) {
              setMessages((prev) =>
                prev.map((m) => (m.id === msg.messageId ? { ...m, revokedAt: msg.revokedAt } : m)),
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
            // 正在输入：更新 typingUsers 状态，5 秒无更新自动清除
            const { conversationId: tCid, userId: tUid, isTyping } = msg;
            const timerKey = `${tCid}:${tUid}`;

            // 清除该用户已有的过期定时器（避免重复定时器堆积）
            const existingTimer = typingTimersRef.current[timerKey];
            if (existingTimer) {
              clearTimeout(existingTimer);
              delete typingTimersRef.current[timerKey];
            }

            if (isTyping) {
              // 添加到 typing 列表（去重）
              setTypingUsers((prev) => {
                const list = prev[tCid] ?? [];
                if (list.includes(tUid)) return prev;
                return { ...prev, [tCid]: [...list, tUid] };
              });
              // 设置 5 秒过期定时器，到期后从 typing 列表移除
              typingTimersRef.current[timerKey] = setTimeout(() => {
                setTypingUsers((prev) => {
                  const list = prev[tCid] ?? [];
                  const next = list.filter((id) => id !== tUid);
                  // 列表为空时移除 key，避免对象膨胀
                  const { [tCid]: _removed, ...rest } = prev;
                  return next.length > 0 ? { ...rest, [tCid]: next } : rest;
                });
                delete typingTimersRef.current[timerKey];
              }, 5000);
            } else {
              // isTyping=false → 立即从 typing 列表移除
              setTypingUsers((prev) => {
                const list = prev[tCid] ?? [];
                if (!list.includes(tUid)) return prev;
                const next = list.filter((id) => id !== tUid);
                const { [tCid]: _removed, ...rest } = prev;
                return next.length > 0 ? { ...rest, [tCid]: next } : rest;
              });
            }
            break;
          }
          case "read": {
            // 已读回执：更新对应消息的 readByCount
            if (msg.conversationId === activeCidRef.current) {
              setMessages((prev) =>
                prev.map((m) => {
                  if (msg.messageIds.includes(m.id)) {
                    // 使用服务端提供的 readByCount 值，避免本地递增导致多设备重复计数
                    return { ...m, readByCount: msg.readByCount ?? m.readByCount ?? 0 };
                  }
                  return m;
                }),
              );
            }
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

  // 轮询兜底用的 loadConversations 引用。
  // 不把 loadConversations 直接放进 effect 依赖：它的 identity 依赖调用方传入的 t，
  // 若 t 不稳定，5s 定时器会每次渲染都被重建。
  const loadConversationsRef = useRef(loadConversations);
  useEffect(() => {
    loadConversationsRef.current = loadConversations;
  }, [loadConversations]);

  /**
   * 轮询兜底 —— ADR-009 §2.1.1 裁定的 MVP 实时通道（5s + 游标增量）。
   *
   * 为什么必须有：本部署跑的是 Next.js standalone server
   * （`web/docker/entrypoint.sh:70` 的 `exec node server.js`），它不处理 WebSocket
   * upgrade —— 实测部署产物 `web/.next/standalone/web/server.js` 里 `upgrade` 出现 0 次、
   * `handleImUpgrade` 出现 0 次，且 `ws` 库未安装。于是 `ws-client` 的连接永远建立不起来，
   * 上面那个 `ws.onMessage` 分支一条也收不到，IM 会退化成"必须手动刷新才看得到新消息"。
   *
   * 服务端的增量游标端点是现成的（`GET .../messages?after=ISO`，见
   * `app/api/v1/workspaces/[wid]/conversations/[cid]/messages/route.ts:74-78`），
   * 本 effect 只补客户端这半个循环。
   *
   * WS 一旦真的连上（未来接入 custom server），`wsConnected` 变 true 会让本循环自动停用，
   * 避免与推送重复更新。
   */
  useEffect(() => {
    if (wsConnected) return;

    let cancelled = false;

    const tick = async () => {
      // ① 活跃会话的消息增量（未选中会话时跳过；会话列表仍照刷）
      const cid = activeCidRef.current;
      if (cid) {
        try {
          // 游标回退 1ms：服务端用的是 `createdAt > after`（严格大于），
          // 同一毫秒落库的消息会被漏掉。回退 1ms 后靠下面的 id 去重兜住重叠部分——宁重不漏。
          const last = messagesRef.current[messagesRef.current.length - 1];
          const after = last
            ? `&after=${encodeURIComponent(
                new Date(new Date(last.createdAt).getTime() - 1).toISOString(),
              )}`
            : "";

          const result = await api<MessagesListResponse>(
            `/api/v1/workspaces/${workspaceId}/conversations/${cid}/messages?limit=${MESSAGES_PAGE_SIZE}${after}`,
          );

          // 竞态：请求期间用户可能已切到别的会话 —— 丢弃本批，不要污染新会话的消息列表
          const incoming =
            cancelled || activeCidRef.current !== cid ? [] : (result?.messages ?? []);

          if (incoming.length > 0) {
            setMessages((prev) => {
              const seen = new Set(prev.map((m) => m.id));
              const fresh = incoming.filter((m) => !seen.has(m.id));
              return fresh.length > 0 ? [...prev, ...fresh] : prev;
            });
          }
        } catch {
          // best-effort：单次轮询失败不打断 UI、不写 error，下一个 tick 自然重试
        }
      }

      // ② 会话列表：未读数 / lastMessageAt 同样只靠 WS 推送，不刷就是死的。
      //    放在 cid 判断之外 —— IM 落地页（尚未选中任何会话）也需要看到未读变化。
      //    用静默模式，避免每 5s 闪一次 spinner。
      try {
        await loadConversationsRef.current({ silent: true });
      } catch {
        // 兜底：loadConversations 内部已吞掉失败，此处仅防未来改动引入未捕获拒绝
      }
    };

    const timer = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [workspaceId, wsConnected]);

  // 同步消息列表引用（供 loadMoreMessages 读取游标）
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // 初始加载会话列表
  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  /**
   * 浏览器通知权限请求：IMClient 初始化时请求一次。
   * 仅在浏览器环境且权限未授予也未拒绝时请求，避免重复弹窗。
   */
  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      typeof Notification !== "undefined" &&
      Notification.permission === "default"
    ) {
      // best-effort 请求权限，失败静默忽略（用户拒绝或不支持时不影响核心功能）
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // 组件卸载时清理所有 typing 过期定时器，避免内存泄漏和卸载后 setState
  useEffect(() => {
    return () => {
      for (const timer of Object.values(typingTimersRef.current)) {
        clearTimeout(timer);
      }
      typingTimersRef.current = {};
    };
  }, []);

  return {
    conversations,
    activeConversation,
    messages,
    loading,
    error,
    wsStatus: ws.status,
    loadConversations,
    selectConversation,
    selectTaskConversation,
    loadMoreMessages,
    loadingMore,
    sendMessage,
    editMessage,
    revokeMessage,
    createConversation,
    setActiveConversation,
    typingUsers,
  };
}
