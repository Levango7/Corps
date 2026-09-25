/**
 * IM WebSocket 消息协议类型定义
 *
 * 定义独立 IM（即时通讯）WebSocket 通信的客户端/服务端消息格式。
 * 消息分为两个方向：
 *  - ClientMessage：客户端 → 服务端（认证、心跳、订阅、正在输入、已读）
 *  - ServerMessage：服务端 → 客户端（消息推送、编辑、撤回、在线状态、正在输入、已读、错误）
 *
 * 设计原则：
 *  - 判别联合（discriminated union）：每条消息用 `type` 字段区分类型，便于收窄。
 *  - 时间戳统一 ISO 8601 字符串，避免 Date 序列化歧义。
 *  - authorId/authorName 等可为 null，兼容用户注销后消息保留（审计 D3）。
 */

// ─── 基础消息载荷 ──────────────────────────────────────────────

/**
 * 单条消息的完整载荷，用于服务端推送新消息或客户端拉取历史。
 * 字段与 Prisma Message 模型 + 作者信息对齐。
 */
export interface MessagePayload {
  /** 消息唯一 ID（UUID） */
  id: string;
  /** 所属会话 ID */
  conversationId: string;
  /** 作者用户 ID；null 表示系统消息或作者已注销 */
  authorId: string | null;
  /** 作者显示名；null 表示作者已注销 */
  authorName: string | null;
  /** 作者头像 URL；null 表示无头像或作者已注销 */
  authorImage: string | null;
  /** 消息正文（markdown 纯文本） */
  body: string;
  /** 消息类型：text / system / call_invite / call_ended / call_rejected */
  type: "text" | "system" | "call_invite" | "call_ended" | "call_rejected";
  /** 创建时间（ISO 8601） */
  createdAt: string;
  /** 最后编辑时间（ISO 8601）；null 表示未编辑 */
  editedAt: string | null;
  /** 撤回时间（ISO 8601）；null 表示未撤回 */
  revokedAt: string | null;
  /** 回复的目标消息 ID；null 表示非回复消息 */
  replyToId: string | null;
  /** 提及的用户 ID 列表 */
  mentions: string[];
}

// ─── 客户端 → 服务端 ──────────────────────────────────────────

/**
 * 客户端发送给服务端的消息。
 *
 * 连接生命周期：
 *  1. 连接建立后（upgrade 时已通过 cookie 认证），客户端可选地发送 auth 消息
 *     做二次认证或刷新身份。upgrade 阶段已认证的连接无需再发 auth。
 *  2. subscribe/unsubscribe 管理会话订阅。
 *  3. typing 广播正在输入状态。
 *  4. read 上报已读消息。
 *  5. heartbeat 保活。
 */
export type ClientMessage =
  | { type: "auth"; token: string }
  | { type: "heartbeat" }
  | { type: "subscribe"; conversationId: string }
  | { type: "unsubscribe"; conversationId: string }
  | { type: "typing"; conversationId: string; isTyping: boolean }
  | { type: "read"; conversationId: string; messageIds: string[] };

// ─── 服务端 → 客户端 ──────────────────────────────────────────

/**
 * 服务端推送给客户端的消息。
 *
 * - message：新消息推送
 * - edit：消息编辑通知
 * - revoke：消息撤回通知
 * - presence：用户在线/离线状态变更
 * - typing：正在输入状态广播
 * - read：已读回执广播
 * - error：错误通知（非致命，连接不断开）
 */
export type ServerMessage =
  | { type: "message"; conversationId: string; message: MessagePayload }
  | { type: "edit"; conversationId: string; messageId: string; body: string; editedAt: string }
  | {
      type: "revoke";
      conversationId: string;
      messageId: string;
      revokedAt: string;
    }
  | { type: "presence"; userId: string; online: boolean }
  | { type: "typing"; conversationId: string; userId: string; isTyping: boolean }
  | {
      type: "read";
      conversationId: string;
      userId: string;
      messageIds: string[];
      readByCount?: number;
    }
  | { type: "error"; message: string };

// ─── 连接状态 ──────────────────────────────────────────────────

/**
 * WebSocket 连接状态机：
 *  connecting → connected → disconnected
 *                ↘ error → disconnected
 */
export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

// ─── WebSocket 连接抽象接口 ────────────────────────────────────

/**
 * 服务端 WebSocket 连接的最小抽象接口。
 *
 * 为什么不直接 import { WebSocket } from "ws"：
 *  本项目未将 `ws` 列为直接依赖（y-websocket 是前端库，使用浏览器原生 WebSocket）。
 *  定义此接口解耦服务端逻辑与具体 WebSocket 实现：
 *  - `ws` 库的 WebSocket 实例可通过适配器满足此接口（custom server 场景）。
 *  - 未来切换到其他 WebSocket 库（如 uWebSockets.js）只需提供适配器。
 *
 * 采用浏览器风格的事件回调（onmessage/onclose/onerror/onopen），
 * 与浏览器原生 WebSocket 一致，便于客户端/服务端统一心智模型。
 *
 * readyState 值沿用 WebSocket 标准：
 *  0 = CONNECTING, 1 = OPEN, 2 = CLOSING, 3 = CLOSED
 */
export interface IMWebSocket {
  /** 连接当前状态（0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED） */
  readonly readyState: number;
  /** 发送文本数据 */
  send(data: string): void;
  /** 主动关闭连接 */
  close(code?: number, reason?: string): void;
  /** 收到消息回调 */
  onmessage: ((event: { data: string }) => void) | null;
  /** 连接关闭回调 */
  onclose: ((event: { code: number; reason: string }) => void) | null;
  /** 连接错误回调 */
  onerror: ((event: unknown) => void) | null;
  /** 连接建立回调 */
  onopen: (() => void) | null;
}

/** WebSocket readyState 常量（与标准一致） */
export const WS_OPEN = 1;
