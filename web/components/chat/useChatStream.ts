"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatStreamEvent, ChatMessage } from "./types";

/**
 * IM 升级：SSE 聊天流连接 Hook
 *
 * 功能：
 *  - 建立 SSE 连接到 /messages/stream，实时接收消息/已读/在线状态事件
 *  - 30 秒断线自动重连（指数退避：3s → 6s → 12s → 24s，上限 30s）
 *  - 断线重连时通过 ?since= 补拉错过的消息
 *  - SSE 不可用时降级为 5s 轮询（调用 onFallback 回调）
 *
 * 返回：
 *  - connected: SSE 连接是否正常
 *  - presence: 在线用户列表
 *  - markRead: 通知 hook 已读某些消息（用于触发已读 API）
 *
 * 事件处理：
 *  - message: 调用 onMessage(message) 追加新消息
 *  - read: 调用 onRead(messageId, userId, readAt) 更新已读回执
 *  - presence: 更新在线用户列表
 */

/** 轮询降级间隔 */
const FALLBACK_POLL_INTERVAL_MS = 5000;
/** 重连基础延迟 */
const RECONNECT_BASE_DELAY_MS = 3000;
/** 重连最大延迟 */
const RECONNECT_MAX_DELAY_MS = 30_000;

interface UseChatStreamOptions {
  /** SSE 端点 URL */
  streamUrl: string;
  /** 轮询增量拉取 URL（降级时使用，含 ?since= 占位） */
  pollUrl: string;
  /** 是否启用（面板可见时才连接） */
  enabled: boolean;
  /** 收到新消息时的回调 */
  onMessage: (message: ChatMessage) => void;
  /** 收到已读更新时的回调 */
  onRead: (messageId: string, userId: string, readAt: string) => void;
  /** 当前用户 ID（用于过滤自己的 presence） */
  currentUserId?: string;
}

interface UseChatStreamResult {
  /** SSE 连接是否正常 */
  connected: boolean;
  /** 是否降级为轮询 */
  fallback: boolean;
  /** 在线用户 ID 集合 */
  onlineUsers: Set<string>;
  /** 手动重连 */
  reconnect: () => void;
}

export function useChatStream({
  streamUrl,
  pollUrl,
  enabled,
  onMessage,
  onRead,
  currentUserId,
}: UseChatStreamOptions): UseChatStreamResult {
  const [connected, setConnected] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());

  // 重连尝试次数（指数退避）
  const reconnectAttemptsRef = useRef(0);
  // SSE EventSource 引用
  const eventSourceRef = useRef<EventSource | null>(null);
  // 轮询定时器引用
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 最后一条消息的 createdAt（用于断线重连 ?since= 补偿）
  const lastMessageAtRef = useRef<string | null>(null);
  // 回调 ref（避免闭包陈旧引用）
  const onMessageRef = useRef(onMessage);
  const onReadRef = useRef(onRead);
  onMessageRef.current = onMessage;
  onReadRef.current = onRead;

  /** 更新 lastMessageAt 游标 */
  const updateCursor = useCallback((createdAt: string) => {
    const prev = lastMessageAtRef.current;
    if (!prev || new Date(createdAt) > new Date(prev)) {
      lastMessageAtRef.current = createdAt;
    }
  }, []);

  /** 处理 SSE 事件 */
  const handleEvent = useCallback(
    (data: string) => {
      try {
        const event = JSON.parse(data) as ChatStreamEvent;
        switch (event.type) {
          case "message":
            onMessageRef.current(event.message);
            updateCursor(event.message.createdAt);
            break;
          case "read":
            onReadRef.current(event.messageId, event.userId, event.readAt);
            break;
          case "presence":
            setOnlineUsers((prev) => {
              const next = new Set(prev);
              if (event.online) {
                next.add(event.userId);
              } else {
                next.delete(event.userId);
              }
              return next;
            });
            break;
          case "ping":
            // 心跳，无需处理
            break;
        }
      } catch {
        // 解析失败，忽略
      }
    },
    [updateCursor],
  );

  /** 建立 SSE 连接 */
  const connect = useCallback(() => {
    if (!enabled) return;

    // 关闭现有连接
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    // 构造 URL（含 ?since= 断线重连补偿）
    const since = lastMessageAtRef.current;
    const url = since ? `${streamUrl}?since=${encodeURIComponent(since)}` : streamUrl;

    let connectionSucceeded = false;

    try {
      const es = new EventSource(url, { withCredentials: true });
      eventSourceRef.current = es;

      es.onopen = () => {
        connectionSucceeded = true;
        setConnected(true);
        setFallback(false);
        reconnectAttemptsRef.current = 0;
      };

      es.onmessage = (e) => {
        handleEvent(e.data);
      };

      es.onerror = () => {
        setConnected(false);
        es.close();
        eventSourceRef.current = null;

        // 如果连接从未成功过，降级为轮询
        if (!connectionSucceeded) {
          setFallback(true);
          return;
        }

        // 指数退避重连
        const attempts = reconnectAttemptsRef.current++;
        const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** attempts, RECONNECT_MAX_DELAY_MS);
        setTimeout(() => connect(), delay);
      };
    } catch {
      // EventSource 构造失败，降级为轮询
      setFallback(true);
    }
  }, [enabled, streamUrl, handleEvent]);

  /** 降级轮询：增量拉取新消息 */
  const startFallbackPoll = useCallback(() => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);

    const poll = async () => {
      const since = lastMessageAtRef.current;
      const url = since ? `${pollUrl}?since=${encodeURIComponent(since)}` : pollUrl;
      try {
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) return;
        const json = await res.json();
        const messages = (json.data ?? []) as ChatMessage[];
        for (const msg of messages) {
          onMessageRef.current(msg);
          updateCursor(msg.createdAt);
        }
      } catch {
        // 轮询失败静默重试
      }
    };

    poll();
    pollTimerRef.current = setInterval(poll, FALLBACK_POLL_INTERVAL_MS);
  }, [pollUrl, updateCursor]);

  // 启动连接或降级轮询
  useEffect(() => {
    if (!enabled) return;

    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      setConnected(false);
      setFallback(false);
    };
  }, [enabled, connect]);

  // 降级轮询切换
  useEffect(() => {
    if (fallback && enabled) {
      startFallbackPoll();
    } else if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [fallback, enabled, startFallbackPoll]);

  /** 手动重连 */
  const reconnect = useCallback(() => {
    reconnectAttemptsRef.current = 0;
    setFallback(false);
    connect();
  }, [connect]);

  // 过滤掉自己的 presence（不显示自己在线）
  const filteredOnlineUsers = useRef(onlineUsers);
  filteredOnlineUsers.current = currentUserId
    ? new Set([...onlineUsers].filter((id) => id !== currentUserId))
    : onlineUsers;

  return {
    connected,
    fallback,
    onlineUsers: filteredOnlineUsers.current,
    reconnect,
  };
}
