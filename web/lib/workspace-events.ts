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

/**
 * 多实例部署运行时警告（与 chat-events.ts 同构）：
 *  如果检测到可能的多实例部署环境（如 PM2 cluster 模式、K8s 多 Pod），
 *  输出警告提醒开发者事件总线仅在单实例内有效。
 *  检测依据：PM2 实例 > 1 或 K8S 环境变量指示多副本。
 *
 *  - 多实例 + 无 REDIS_URL → 严重警告（事件将丢失，必须升级 Redis Pub/Sub）
 *  - 多实例 + 有 REDIS_URL → 警告（Redis 已配置但 workspace-events 仍用 EventEmitter，
 *    需要将本模块升级为 Redis Pub/Sub 才能跨实例传递事件）
 *  - 单实例 + 无 REDIS_URL → 正常，不警告（EventEmitter 单实例内有效）
 *  - 生产环境 + 无任何实例标志 + 无 REDIS_URL → info 提示（可能漏配实例标志）
 */
if (process.env.NODE_ENV === "production") {
  const pm2Instances = parseInt(process.env.PM2_INSTANCES ?? "1", 10);
  const k8sReplicas = parseInt(process.env.K8S_REPLICAS ?? "1", 10);
  const hasRedis = !!process.env.REDIS_URL;
  const isMultiInstance = pm2Instances > 1 || k8sReplicas > 1;

  if (isMultiInstance) {
    if (!hasRedis) {
      console.warn(
        "[workspace-events] 🔴 严重：检测到多实例部署环境（PM2_INSTANCES=" +
          pm2Instances +
          ", K8S_REPLICAS=" +
          k8sReplicas +
          "）且未配置 REDIS_URL。工作区事件总线（EventEmitter）仅在单实例内有效，" +
          "多实例间事件将丢失。必须配置 REDIS_URL 并将本模块升级为 Redis Pub/Sub" +
          "（见文件头注释升级路径）。",
      );
    } else {
      console.warn(
        "[workspace-events] ⚠️ 检测到多实例部署环境（PM2_INSTANCES=" +
          pm2Instances +
          ", K8S_REPLICAS=" +
          k8sReplicas +
          "），REDIS_URL 已配置但 workspace-events 仍使用进程内 EventEmitter。" +
          "多实例间事件将丢失。请将本模块升级为 Redis Pub/Sub 以利用已有 Redis" +
          "（见文件头注释升级路径）。",
      );
    }
  } else if (!hasRedis) {
    console.info(
      "[workspace-events] ℹ️ 单实例模式运行，未配置 REDIS_URL。当前 EventEmitter 总线可用。" +
        "若未来扩容到多实例，请先接入 Redis Pub/Sub（见文件头注释升级路径）。",
    );
  }
}

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
