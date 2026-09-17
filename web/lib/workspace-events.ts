import { EventEmitter } from "events";
// 复用 chat-events.ts 的 SSE 连接额度管理（RAII 风格 acquireSseSlot），
// 单用户并发 SSE 上限按用户计，不区分 chat/workspace 通道。
export { acquireSseSlot, releaseSseSlot, tryAcquireSseSlot } from "./chat-events";

/**
 * M4 实时协作基础：工作区级事件总线（单实例 pub/sub）。
 *
 * 设计与 chat-events.ts 同构（复用 EventEmitter 模式）：
 *  - 事件通道命名空间：`workspace:${workspaceId}`，按工作区隔离事件流。
 *  - 单实例限制与升级路径同 chat-events（多实例需替换为 Redis Pub/Sub）。
 *  - 复用 chat-events 的 SSE 连接额度管理（acquireSseSlot），单用户并发上限
 *    跨 chat/workspace 通道共享，避免双倍占句柄。
 *
 * 事件类型（WorkspaceEvent 联合）：
 *  - task.created：新建任务（taskId + title + status + createdBy）
 *  - task.updated：任务变更（taskId + title + status + 字段快照）
 *  - task.deleted：任务删除（taskId + title）
 *  - presence.online：成员上线（userId）
 *  - presence.offline：成员离线（userId）
 *  - ping：心跳保活
 *
 * 触发点：tasks POST / tasks/[id] PATCH / DELETE 路由 emit 事件，
 *        SSE 端点 events/stream 订阅并推送给前端。
 */

export const workspaceEvents = new EventEmitter();
// 同一工作区可能多端订阅（看板 + 详情 + 仪表盘），上限 100 与 chat-events 对齐。
workspaceEvents.setMaxListeners(100);

/** 事件通道命名：`workspace:${workspaceId}` */
export function workspaceChannel(workspaceId: string): string {
  return `workspace:${workspaceId}`;
}

/** SSE 推送的事件载荷联合类型 */
export type WorkspaceEvent =
  | {
      type: "task.created";
      taskId: string;
      title: string;
      status: string;
      createdBy?: string | null;
    }
  | {
      type: "task.updated";
      taskId: string;
      title: string;
      status: string;
      updatedBy?: string | null;
    }
  | {
      type: "task.deleted";
      taskId: string;
      title: string;
    }
  | { type: "presence.online"; userId: string }
  | { type: "presence.offline"; userId: string }
  | { type: "ping" };

/**
 * 发布工作区事件（供 tasks POST/PATCH/DELETE、presence 心跳调用）。
 * 静默处理无监听器情况（首次连接前的事件会被丢弃，前端通过 activity API 补拉）。
 */
export function emitWorkspaceEvent(workspaceId: string, event: WorkspaceEvent): void {
  workspaceEvents.emit(workspaceChannel(workspaceId), event);
}

/**
 * 订阅工作区事件，返回取消订阅函数（RAII 风格，幂等安全）。
 *
 * 用法：
 *   const unsubscribe = subscribeWorkspaceEvents(wid, (event) => { ... });
 *   // 连接断开时：
 *   unsubscribe();
 */
export function subscribeWorkspaceEvents(
  workspaceId: string,
  listener: (event: WorkspaceEvent) => void,
): () => void {
  const channel = workspaceChannel(workspaceId);
  workspaceEvents.on(channel, listener);
  let unsubscribed = false;
  return () => {
    if (unsubscribed) return; // 幂等
    unsubscribed = true;
    workspaceEvents.off(channel, listener);
  };
}