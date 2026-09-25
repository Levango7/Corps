import { EventEmitter } from "events";

/**
 * 远程控制信令事件总线（服务端单实例 pub/sub）
 *
 * ─── 架构 ─────────────────────────────────────────────────────
 * Next.js 16 Route Handler 不支持 WebSocket upgrade，因此信令通道采用
 * SSE + POST 模式：
 *  - 客户端通过 EventSource（SSE）长连接接收信令消息（GET /signal）
 *  - 客户端通过 POST /signal 发送信令消息，服务端通过本总线转发给对端 SSE
 *
 * 本总线是服务端 EventEmitter，按 userId 隔离事件流：
 *  - 通道命名：`rc-signal:${userId}`
 *  - POST handler emit 消息到目标用户的通道
 *  - SSE handler 订阅当前用户的通道，将消息写入 SSE 流
 *
 * ⚠️ 单实例限制（同 chat-events.ts）：
 *  多实例部署时不同实例的订阅者无法收到彼此 emit 的事件。
 *  升级路径：替换为 Redis Pub/Sub（接口 emit/on 保持不变）。
 *
 * ─── 信令消息类型 ────────────────────────────────────────────
 * 见 lib/webrtc/signaling.ts 的 SignalingMessage 联合类型。
 * 本总线传输的是 SignalingEnvelope（含时间戳），通过 SSE 推送给客户端。
 */

export const remoteControlEvents = new EventEmitter();
// 同一用户可能有多端订阅（PC + 手机），设合理上限 20
remoteControlEvents.setMaxListeners(20);

/** 信令通道命名：`rc-signal:${userId}` */
export function remoteControlChannel(userId: string): string {
  return `rc-signal:${userId}`;
}

/** SSE 推送的信令信封（含时间戳用于排序/去重） */
export interface SignalingEnvelope {
  message: unknown;
  timestamp: number;
}

/**
 * 发布信令消息到目标用户的通道（供 POST /signal 调用）。
 * 静默处理无监听器情况（目标用户离线时消息丢弃，由前端超时重试）。
 */
export function emitSignalingMessage(targetUserId: string, message: unknown): void {
  const envelope: SignalingEnvelope = {
    message,
    timestamp: Date.now(),
  };
  remoteControlEvents.emit(remoteControlChannel(targetUserId), envelope);
}

/**
 * 订阅指定用户的信令消息（供 SSE /signal 调用）。
 * 返回取消订阅函数（RAII 风格，幂等，多次调用安全）。
 *
 * 用法：
 *   const unsubscribe = subscribeSignalingMessages(userId, (envelope) => {
 *     controller.enqueue(`data: ${JSON.stringify(envelope)}\n\n`);
 *   });
 *   // 连接断开时：
 *   unsubscribe();
 */
export function subscribeSignalingMessages(
  userId: string,
  listener: (envelope: SignalingEnvelope) => void,
): () => void {
  const channel = remoteControlChannel(userId);
  remoteControlEvents.on(channel, listener);
  let unsubscribed = false;
  return () => {
    if (unsubscribed) return;
    unsubscribed = true;
    remoteControlEvents.off(channel, listener);
  };
}

// ─── 远程控制会话事件（用于实时通知前端会话状态变更）──

/**
 * 会话状态变更事件通道：`rc-session:${userId}`
 * 当会话被创建/接受/拒绝/结束时，通知相关用户（发起方 + 目标方）。
 */
export function remoteControlSessionChannel(userId: string): string {
  return `rc-session:${userId}`;
}

/** 会话事件类型 */
export type RemoteControlSessionEvent =
  | { type: "session-created"; session: unknown }
  | { type: "session-accepted"; session: unknown }
  | { type: "session-rejected"; session: unknown; reason?: string }
  | { type: "session-ended"; session: unknown; reason?: string };

/**
 * 发布会话状态变更事件（通知发起方 + 目标方）。
 * 供 API 路由在会话状态变更后调用。
 */
export function emitSessionEvent(
  initiatorId: string,
  targetId: string,
  event: RemoteControlSessionEvent,
): void {
  remoteControlEvents.emit(remoteControlSessionChannel(initiatorId), event);
  remoteControlEvents.emit(remoteControlSessionChannel(targetId), event);
}

/**
 * 订阅指定用户的会话状态变更事件。
 * 返回取消订阅函数（RAII 风格，幂等）。
 */
export function subscribeSessionEvents(
  userId: string,
  listener: (event: RemoteControlSessionEvent) => void,
): () => void {
  const channel = remoteControlSessionChannel(userId);
  remoteControlEvents.on(channel, listener);
  let unsubscribed = false;
  return () => {
    if (unsubscribed) return;
    unsubscribed = true;
    remoteControlEvents.off(channel, listener);
  };
}
