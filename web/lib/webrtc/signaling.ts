"use client";

/**
 * 远程控制信令管理器 · lib/webrtc/signaling.ts
 *
 * ─── 信令通道选型 ─────────────────────────────────────────────
 * Next.js 16 Route Handler 基于 Web Fetch API，不原生支持 WebSocket upgrade
 * （见 app/api/v1/im/ws/route.ts 注释）。因此本模块采用 SSE + POST 模式：
 *  - 接收：EventSource（SSE）长连接，服务端通过 EventEmitter 推送信令消息
 *  - 发送：POST /api/v1/remote-control/signal，服务端转发给对端 SSE
 *
 * 与 WebSocket 相比：
 *  - 优点：无需 custom server，标准 Next.js 运行时即可工作；SSE 自动重连
 *  - 缺点：单向（服务端→客户端），客户端→服务端需 POST（每条消息一个 HTTP 请求）
 *  - 对于信令这种低频消息（SDP/ICE 数量有限），POST 开销可接受
 *
 * ─── 消息流 ───────────────────────────────────────────────────
 *  Alice (控制方)                     Bob (被控方)
 *     │                                  │
 *     │── POST request-control ─────────→│ (SSE 推送给 Bob)
 *     │                                  │
 *     │←────── POST accept-control ──────│
 *     │                                  │
 *     │── POST offer (SDP) ─────────────→│
 *     │←────── POST answer (SDP) ────────│
 *     │                                  │
 *     │── POST ice-candidate ───────────→│ (双向，直到 ICE 完成)
 *     │←────── POST ice-candidate ───────│
 *
 * ─── SSR 安全 ────────────────────────────────────────────────
 * 所有浏览器 API（EventSource、fetch）访问前均检测 typeof window，
 * 服务端渲染时所有方法安全 no-op。
 */

import { api } from "@/lib/api";

// ─── 信令消息类型 ──────────────────────────────────────────────

/** 信令消息类型标签 */
export type SignalingMessageType =
  | "offer"
  | "answer"
  | "ice-candidate"
  | "request-control"
  | "accept-control"
  | "reject-control"
  | "end-control";

/** SDP 会话描述（与 RTCSessionDescriptionInit 同构） */
export interface SdpPayload {
  type: "offer" | "answer";
  sdp: string;
}

/** ICE 候选（与 RTCIceCandidateInit 同构） */
export interface IceCandidatePayload {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  usernameFragment?: string | null;
}

/** 信令消息联合类型（判别联合，type 字段区分） */
export type SignalingMessage =
  | { type: "offer"; fromUserId: string; toUserId: string; sessionId: string; sdp: string }
  | { type: "answer"; fromUserId: string; toUserId: string; sessionId: string; sdp: string }
  | {
      type: "ice-candidate";
      fromUserId: string;
      toUserId: string;
      sessionId: string;
      candidate: IceCandidatePayload;
    }
  | {
      type: "request-control";
      fromUserId: string;
      toUserId: string;
      sessionId: string;
      workspaceId: string;
    }
  | { type: "accept-control"; fromUserId: string; toUserId: string; sessionId: string }
  | {
      type: "reject-control";
      fromUserId: string;
      toUserId: string;
      sessionId: string;
      reason?: string;
    }
  | {
      type: "end-control";
      fromUserId: string;
      toUserId: string;
      sessionId: string;
      reason?: string;
    };

/** SSE 端点推送的信令信封（含时间戳用于排序/去重） */
export interface SignalingEnvelope {
  message: SignalingMessage;
  timestamp: number;
}

// ─── SignalingClient ───────────────────────────────────────────

/** SSE 连接状态 */
export type SignalingConnectionState = "disconnected" | "connecting" | "connected" | "error";

/** 信令客户端配置 */
export interface SignalingClientOptions {
  /** 当前工作区 ID（用于 SSE URL 隔离） */
  workspaceId: string;
  /** SSE 重连最大间隔（毫秒，默认 5000） */
  maxReconnectIntervalMs?: number;
  /** SSE 连接超时（毫秒，默认 10000） */
  connectTimeoutMs?: number;
}

/**
 * 远程控制信令客户端。
 *
 * 生命周期：
 *   const client = new SignalingClient({ workspaceId });
 *   const unsubscribe = client.onMessage((msg) => { ... });
 *   await client.connect();           // 建立 SSE 连接
 *   await client.send(message);       // 通过 POST 发送信令
 *   client.disconnect();              // 断开
 *   unsubscribe();                    // 取消订阅
 *
 * 线程安全：单实例仅支持一个 SSE 连接。多标签页各自创建独立实例。
 */
export class SignalingClient {
  private eventSource: EventSource | null = null;
  private listeners = new Set<(msg: SignalingMessage) => void>();
  private stateListeners = new Set<(state: SignalingConnectionState) => void>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private currentState: SignalingConnectionState = "disconnected";
  private disposed = false;

  private readonly workspaceId: string;
  private readonly maxReconnectIntervalMs: number;
  private readonly connectTimeoutMs: number;

  constructor(options: SignalingClientOptions) {
    this.workspaceId = options.workspaceId;
    this.maxReconnectIntervalMs = options.maxReconnectIntervalMs ?? 5000;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 10000;
  }

  /** 当前连接状态 */
  get state(): SignalingConnectionState {
    return this.currentState;
  }

  /**
   * 建立 SSE 连接，开始接收信令消息。
   *
   * SSR 安全：服务端调用直接返回，不创建 EventSource。
   * 自动重连：SSE 断开后按指数退避重连（1s → 2s → 4s → ... → max）。
   */
  async connect(): Promise<void> {
    // SSR 安全：服务端无 EventSource
    if (typeof window === "undefined") return;
    if (this.disposed) return;
    if (this.currentState === "connected" || this.currentState === "connecting") return;

    this.setState("connecting");

    const sseUrl = `/api/v1/remote-control/signal?workspaceId=${encodeURIComponent(this.workspaceId)}`;

    try {
      // EventSource 浏览器原生 API，自动携带 cookie（同源）
      this.eventSource = new EventSource(sseUrl, { withCredentials: true });

      // 连接超时守卫：若 connectTimeoutMs 内未收到 open 事件，关闭重连
      const timeoutId = setTimeout(() => {
        if (this.currentState === "connecting") {
          this.eventSource?.close();
          this.eventSource = null;
          this.scheduleReconnect();
        }
      }, this.connectTimeoutMs);

      this.eventSource.onopen = () => {
        clearTimeout(timeoutId);
        this.reconnectAttempts = 0;
        this.setState("connected");
      };

      // 信令消息通过名为 "message" 的 SSE 事件传递
      this.eventSource.onmessage = (event: MessageEvent) => {
        try {
          const envelope = JSON.parse(event.data) as SignalingEnvelope;
          if (envelope?.message) {
            for (const listener of this.listeners) {
              try {
                listener(envelope.message);
              } catch (err) {
                console.error("[signaling] listener error:", err);
              }
            }
          }
        } catch (err) {
          console.error("[signaling] failed to parse SSE message:", err);
        }
      };

      this.eventSource.onerror = () => {
        clearTimeout(timeoutId);
        // EventSource 在 onerror 后会自动尝试重连，但行为不一致。
        // 这里主动关闭并用自己的退避逻辑重连，保证跨浏览器一致性。
        this.eventSource?.close();
        this.eventSource = null;
        if (!this.disposed) {
          this.scheduleReconnect();
        } else {
          this.setState("disconnected");
        }
      };
    } catch (err) {
      console.error("[signaling] connect failed:", err);
      this.setState("error");
      this.scheduleReconnect();
    }
  }

  /**
   * 通过 POST 发送信令消息到服务端，服务端转发给 toUserId 的 SSE 连接。
   *
   * 使用项目统一的 api() 客户端（自动处理 401 刷新）。
   */
  async send(message: SignalingMessage): Promise<void> {
    if (this.disposed) throw new Error("[signaling] client disposed");
    // POST 发送不依赖 SSE 连接状态（服务端会缓存/转发）
    await api("/api/v1/remote-control/signal", {
      method: "POST",
      body: JSON.stringify(message),
    });
  }

  /**
   * 注册信令消息回调。返回取消订阅函数（RAII 风格，幂等）。
   */
  onMessage(callback: (msg: SignalingMessage) => void): () => void {
    this.listeners.add(callback);
    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;
      this.listeners.delete(callback);
    };
  }

  /**
   * 注册连接状态变更回调。返回取消订阅函数（RAII 风格，幂等）。
   */
  onStateChange(callback: (state: SignalingConnectionState) => void): () => void {
    this.stateListeners.add(callback);
    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;
      this.stateListeners.delete(callback);
    };
  }

  /**
   * 断开 SSE 连接并清理资源。幂等，多次调用安全。
   */
  disconnect(): void {
    this.disposed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.setState("disconnected");
    this.listeners.clear();
    this.stateListeners.clear();
  }

  // ─── 内部方法 ──────────────────────────────────────────────

  private setState(state: SignalingConnectionState): void {
    if (this.currentState === state) return;
    this.currentState = state;
    for (const listener of this.stateListeners) {
      try {
        listener(state);
      } catch (err) {
        console.error("[signaling] state listener error:", err);
      }
    }
  }

  /** 指数退避重连：1s → 2s → 4s → ... → maxReconnectIntervalMs */
  private scheduleReconnect(): void {
    if (this.disposed) return;
    this.setState("error");
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), this.maxReconnectIntervalMs);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      void this.connect();
    }, delay);
  }
}

// ─── 工厂函数 ──────────────────────────────────────────────────

/**
 * 创建信令客户端（便捷工厂）。
 *
 * SSR 安全：服务端调用返回的实例所有方法均为 no-op（connect 直接 return）。
 */
export function createSignalingClient(options: SignalingClientOptions): SignalingClient {
  return new SignalingClient(options);
}
