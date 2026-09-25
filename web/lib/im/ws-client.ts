"use client";

/**
 * IM WebSocket 客户端连接管理 Hook
 *
 * 提供 React 组件中管理 IM WebSocket 连接的能力：
 *  - 自动连接/断开（组件挂载时连接，卸载时断开）
 *  - 自动重连（指数退避，最大 30s）
 *  - 心跳保活（每 30s 发送 heartbeat）
 *  - 消息分发（收到服务端消息后调用注册的 handler）
 *  - 会话订阅/取消订阅
 *
 * 认证策略：
 *  WebSocket 连接时浏览器自动携带 httpOnly cookie（含 access_token），
 *  服务端在 upgrade 阶段从 cookie 提取并验证。客户端无需手动发送 auth 消息，
 *  也无法读取 httpOnly cookie（XSS 防护）。
 *  workspaceId 通过 URL query 参数传递，服务端据此验证工作区成员身份。
 *
 * 用法：
 *  const { status, subscribe, onMessage } = useIMWebSocket(workspaceId)
 *  useEffect(() => {
 *    const off = onMessage((msg) => { ... })
 *    return off
 *  }, [onMessage])
 *  useEffect(() => { subscribe(conversationId) }, [subscribe, conversationId])
 */

import { useRef, useEffect, useCallback, useState } from "react";
import type { ClientMessage, ServerMessage, ConnectionStatus } from "./types";

/** 心跳间隔：30 秒 */
const HEARTBEAT_INTERVAL_MS = 30_000;
/** 重连基础延迟：1 秒（指数退避基准） */
const RECONNECT_BASE_DELAY_MS = 1_000;
/** 重连最大延迟：30 秒 */
const RECONNECT_MAX_DELAY_MS = 30_000;
/** onerror 后等待 onclose 的超时时间（ms），超时后强制清理并触发重连 */
const ONERROR_DISCONNECT_TIMEOUT_MS = 30_000;

/**
 * 根据当前页面 location 构建 WebSocket URL。
 *
 * http → ws, https → wss；拼接 workspaceId 为 query 参数。
 */
function buildWsUrl(workspaceId: string): string {
  if (typeof window === "undefined") {
    // SSR 安全：服务端渲染时不创建连接，返回占位 URL
    return "";
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;
  return `${protocol}//${host}/api/v1/im/ws?wid=${encodeURIComponent(workspaceId)}`;
}

/**
 * 计算重连延迟（指数退避 + 随机抖动）。
 *
 * @param attempt 重连次数（0-based）
 * @returns 延迟毫秒数
 */
function reconnectDelay(attempt: number): number {
  const base = RECONNECT_BASE_DELAY_MS * 2 ** attempt;
  const capped = Math.min(base, RECONNECT_MAX_DELAY_MS);
  // 叠加 0-30% 随机抖动，避免多客户端同步重连造成服务端连接风暴
  const jitter = Math.random() * capped * 0.3;
  return capped + jitter;
}

/**
 * IM WebSocket 连接管理 Hook。
 *
 * @param workspaceId 当前工作区 ID，用于构建连接 URL 和服务端验证
 * @returns 连接状态和操作方法
 */
export function useIMWebSocket(workspaceId: string): {
  /** 当前连接状态 */
  status: ConnectionStatus;
  /** 发送原始客户端消息（高级用法，通常用 subscribe/unsubscribe） */
  send: (msg: ClientMessage) => void;
  /** 订阅指定会话的消息推送 */
  subscribe: (conversationId: string) => void;
  /** 取消订阅指定会话 */
  unsubscribe: (conversationId: string) => void;
  /**
   * 注册服务端消息回调。
   * @returns 取消注册函数（在组件卸载或依赖变更时调用）
   */
  onMessage: (handler: (msg: ServerMessage) => void) => () => void;
  /** 手动连接（通常无需调用，组件挂载时自动连接） */
  connect: () => void;
  /** 手动断开（通常无需调用，组件卸载时自动断开） */
  disconnect: () => void;
} {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");

  // WebSocket 实例引用
  const wsRef = useRef<WebSocket | null>(null);
  // 心跳定时器引用
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 重连定时器引用
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 重连次数（用于指数退避）
  const reconnectAttemptRef = useRef<number>(0);
  // 主动断开标记（true 时 onclose 不触发重连）
  const intentionalCloseRef = useRef<boolean>(false);
  // 消息回调集合（支持多个 handler）
  const handlersRef = useRef<Set<(msg: ServerMessage) => void>>(new Set());
  // 已认证标记（连接建立后等待服务端确认，此处简化为连接即认证）
  const authedRef = useRef<boolean>(false);
  // 已订阅会话集合（重连后自动恢复所有订阅）
  const subscribedConversationsRef = useRef<Set<string>>(new Set());
  // onerror 超时定时器引用（防止 onclose 未触发时资源泄漏）
  const onerrorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * 清理心跳定时器。
   */
  const clearHeartbeat = useCallback(() => {
    if (heartbeatRef.current !== null) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  /**
   * 清理重连定时器。
   */
  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  /**
   * 清理 onerror 超时定时器。
   */
  const clearOerrorTimeout = useCallback(() => {
    if (onerrorTimeoutRef.current !== null) {
      clearTimeout(onerrorTimeoutRef.current);
      onerrorTimeoutRef.current = null;
    }
  }, []);

  /**
   * 发送消息到服务端（内部实现）。
   * 连接未 OPEN 时静默丢弃（调用方应通过 status 判断连接状态）。
   */
  const sendRaw = useCallback((msg: ClientMessage): void => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch (err) {
      // 序列化失败或连接已断开，静默忽略
      console.error("[im-ws-client] 发送失败:", err);
    }
  }, []);

  /**
   * 建立 WebSocket 连接。
   *
   * 如果已有连接则先清理。设置 onopen/onmessage/onclose/onerror 回调。
   * 连接建立后启动心跳定时器。
   */
  const connect = useCallback((): void => {
    // SSR 安全：服务端渲染时不创建连接
    if (typeof window === "undefined") return;

    // 已有连接且处于连接中/已连接状态，不重复连接
    const existing = wsRef.current;
    if (
      existing &&
      (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const url = buildWsUrl(workspaceId);
    if (!url) return;

    // 重置主动断开标记
    intentionalCloseRef.current = false;
    setStatus("connecting");

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      console.error("[im-ws-client] 创建 WebSocket 失败:", err);
      setStatus("error");
      return;
    }

    wsRef.current = ws;

    // 连接建立：更新状态 + 恢复订阅 + 启动心跳 + 重置重连计数
    ws.onopen = () => {
      setStatus("connected");
      authedRef.current = true;
      reconnectAttemptRef.current = 0;

      // 重连后自动恢复所有订阅
      for (const conversationId of subscribedConversationsRef.current) {
        sendRaw({ type: "subscribe", conversationId });
      }

      // 启动心跳定时器
      clearHeartbeat();
      heartbeatRef.current = setInterval(() => {
        sendRaw({ type: "heartbeat" });
      }, HEARTBEAT_INTERVAL_MS);
    };

    // 收到消息：解析 JSON 并分发给所有注册的 handler
    ws.onmessage = (event: MessageEvent) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data as string) as ServerMessage;
      } catch {
        console.error("[im-ws-client] 消息解析失败:", event.data);
        return;
      }
      // 分发给所有注册的 handler
      for (const handler of handlersRef.current) {
        try {
          handler(msg);
        } catch (err) {
          // 单个 handler 异常不影响其他 handler
          console.error("[im-ws-client] 消息回调异常:", err);
        }
      }
    };

    // 连接关闭：清理资源 + 触发重连（非主动断开时）
    ws.onclose = () => {
      clearHeartbeat();
      clearOerrorTimeout();
      authedRef.current = false;

      if (intentionalCloseRef.current) {
        // 主动断开：不重连
        setStatus("disconnected");
        return;
      }

      // 非主动断开：触发重连
      setStatus("disconnected");
      const delay = reconnectDelay(reconnectAttemptRef.current);
      reconnectAttemptRef.current += 1;
      clearReconnectTimer();
      reconnectTimerRef.current = setTimeout(() => {
        connect();
      }, delay);
    };

    // 连接错误：更新状态 + 启动超时兜底定时器
    // 某些网络异常下 onclose 可能不触发，启动 30 秒定时器，
    // 若 onclose 仍未触发则强制清理并触发重连（参考服务端 ws-server.ts 的 socketErrorTimer 模式）
    ws.onerror = () => {
      setStatus("error");
      if (onerrorTimeoutRef.current === null) {
        onerrorTimeoutRef.current = setTimeout(() => {
          console.warn("[im-ws-client] onerror 后 30s 未收到 onclose，强制清理并触发重连");
          onerrorTimeoutRef.current = null;
          clearHeartbeat();
          authedRef.current = false;
          // 尝试关闭 ws（可能已处于异常状态）
          try {
            ws.close();
          } catch {
            // 忽略关闭错误
          }
          // 非主动断开时触发重连
          if (!intentionalCloseRef.current) {
            setStatus("disconnected");
            const delay = reconnectDelay(reconnectAttemptRef.current);
            reconnectAttemptRef.current += 1;
            clearReconnectTimer();
            reconnectTimerRef.current = setTimeout(() => {
              connect();
            }, delay);
          }
        }, ONERROR_DISCONNECT_TIMEOUT_MS);
      }
    };
  }, [workspaceId, clearHeartbeat, clearReconnectTimer, clearOerrorTimeout, sendRaw]);

  /**
   * 主动断开连接。
   *
   * 设置主动断开标记，清理定时器，关闭 WebSocket。
   * onclose 回调中检测到主动断开标记后不触发重连。
   */
  const disconnect = useCallback((): void => {
    intentionalCloseRef.current = true;
    clearHeartbeat();
    clearReconnectTimer();
    clearOerrorTimeout();
    const ws = wsRef.current;
    if (ws) {
      try {
        ws.close();
      } catch {
        // 忽略关闭错误
      }
    }
    wsRef.current = null;
    setStatus("disconnected");
  }, [clearHeartbeat, clearReconnectTimer, clearOerrorTimeout]);

  /**
   * 发送客户端消息。
   */
  const send = useCallback(
    (msg: ClientMessage): void => {
      sendRaw(msg);
    },
    [sendRaw],
  );

  /**
   * 订阅指定会话。
   * 连接已建立时立即发送 subscribe 消息，并记录到订阅集合以便重连后恢复。
   */
  const subscribe = useCallback(
    (conversationId: string): void => {
      subscribedConversationsRef.current.add(conversationId);
      sendRaw({ type: "subscribe", conversationId });
    },
    [sendRaw],
  );

  /**
   * 取消订阅指定会话。
   * 从订阅集合中移除，重连后不再恢复该会话的订阅。
   */
  const unsubscribe = useCallback(
    (conversationId: string): void => {
      subscribedConversationsRef.current.delete(conversationId);
      sendRaw({ type: "unsubscribe", conversationId });
    },
    [sendRaw],
  );

  /**
   * 注册服务端消息回调。
   *
   * 支持多次注册（内部用 Set 存储）。返回取消注册函数，
   * 在组件卸载或依赖变更时调用以避免内存泄漏。
   */
  const onMessage = useCallback((handler: (msg: ServerMessage) => void): (() => void) => {
    handlersRef.current.add(handler);
    // 返回取消注册函数（幂等）
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      handlersRef.current.delete(handler);
    };
  }, []);

  // 自动连接/断开：组件挂载时连接，卸载时断开
  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return { status, send, subscribe, unsubscribe, onMessage, connect, disconnect };
}
