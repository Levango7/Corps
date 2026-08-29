import { EventEmitter } from "events";

/**
 * IM 升级：聊天实时事件总线（单实例 pub/sub）
 *
 * MVP 方案：使用 Node.js 内置 EventEmitter 在同一进程内做 pub/sub。
 * 适用场景：单实例部署（PM2 fork 模式 / Docker 单容器）。
 * 升级路径：替换为 Redis Pub/Sub 即可支持多实例水平扩展，
 *           接口（emit/on）保持不变，调用方无需改动。
 *
 * 事件命名空间：`chat:${taskId}`，按任务隔离事件流。
 * 事件类型：
 *  - message：新消息（含作者、附件、已读列表快照）
 *  - read：已读更新（messageId + readerId）
 *  - presence：在线状态变更（userId + online）
 */

export const chatEvents = new EventEmitter();
// 同一任务可能有多端订阅，移除默认 10 监听器上限
chatEvents.setMaxListeners(0);

/** 事件通道命名：`chat:${taskId}` */
export function chatChannel(taskId: string): string {
  return `chat:${taskId}`;
}

/** SSE 推送的事件载荷联合类型 */
export type ChatEvent =
  | { type: "message"; message: unknown }
  | { type: "read"; messageId: string; userId: string; readAt: string }
  | { type: "presence"; taskId: string; userId: string; online: boolean }
  | { type: "ping" };

/**
 * 发布聊天事件（供 messages POST、read PATCH、presence 心跳调用）。
 * 静默处理无监听器情况（首次连接前的事件会被丢弃，前端通过 ?since= 补拉）。
 */
export function emitChatEvent(taskId: string, event: ChatEvent): void {
  chatEvents.emit(chatChannel(taskId), event);
}
