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

/**
 * 单用户并发 SSE 连接计数（审计遗留：连接建立限流已有，但缺并发硬上限——
 * 按每分钟 20 次建立 × 5 分钟空闲存活，单用户理论上可累积约百条长连接占句柄）。
 * key=userId，value=当前活跃连接数。多端登录场景正常值 1-3（PC + 手机 + 平板），
 * 上限取 5 留足余量；超出返回 429 由调用方拒绝连接。
 */
const MAX_SSE_PER_USER = 5;
const sseConnections = new Map<string, number>();

/** 该用户是否还有 SSE 连接额度（未达并发上限） */
export function tryAcquireSseSlot(userId: string): boolean {
  const current = sseConnections.get(userId) ?? 0;
  if (current >= MAX_SSE_PER_USER) return false;
  sseConnections.set(userId, current + 1);
  return true;
}

/** 释放一个 SSE 连接额度（断开时调用，与 acquire 配对） */
export function releaseSseSlot(userId: string): void {
  const current = sseConnections.get(userId) ?? 0;
  if (current <= 1) sseConnections.delete(userId);
  else sseConnections.set(userId, current - 1);
}

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
