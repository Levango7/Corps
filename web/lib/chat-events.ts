import { EventEmitter } from "events";

/**
 * IM 升级：聊天实时事件总线（单实例 pub/sub）
 *
 * ⚠️ 单实例限制（DL-6）：
 *  本模块使用 Node.js 内置 EventEmitter，仅在单进程内传递事件。
 *  多实例部署（PM2 cluster / Docker 多容器 / K8s 多 Pod）时，
 *  不同实例的订阅者无法收到彼此 emit 的事件，消息将丢失。
 *
 *  当前适用场景：单实例部署（PM2 fork 模式 / Docker 单容器 / K8s 单 Pod）。
 *
 *  升级路径：替换为 Redis Pub/Sub 即可支持多实例水平扩展，
 *           接口（emit/on）保持不变，调用方无需改动。
 *           引入 ioredis 依赖，将 chatEvents 替换为 Redis 客户端，
 *           emitChatEvent → redis.publish(channel, JSON.stringify(event))，
 *           订阅端 → redis.subscribe(channel) + message 事件反序列化。
 *
 * 事件命名空间：`chat:${taskId}`，按任务隔离事件流。
 * 事件类型：
 *  - message：新消息（含作者、附件、已读列表快照）
 *  - read：已读更新（messageId + readerId）
 *  - presence：在线状态变更（userId + online）
 */

export const chatEvents = new EventEmitter();
// 同一任务可能有多端订阅，设合理上限 100（L6 修复：原 setMaxListeners(0) 无上限，
// 既允许多端订阅又能在监听器泄漏时触发 MaxListenersExceededWarning 预警）
chatEvents.setMaxListeners(100);

/**
 * 多实例部署运行时警告（DL-6 + M8 修复：完善检测，纳入 Redis 配置检查）：
 *  如果检测到可能的多实例部署环境（如 PM2 cluster 模式、K8s 多 Pod），
 *  输出警告提醒开发者消息总线仅在单实例内有效。
 *  检测依据：PM2 实例 > 1 或 K8s 环境变量指示多副本。
 *
 *  M8 修复：在多实例检测基础上，额外检查 REDIS_URL 配置：
 *   - 多实例 + 无 REDIS_URL → 严重警告（消息将丢失，必须升级 Redis Pub/Sub）
 *   - 多实例 + 有 REDIS_URL → 警告（Redis 已配置但 chat-events 仍用 EventEmitter，
 *     需要将本模块升级为 Redis Pub/Sub 才能跨实例传递消息）
 *   - 单实例 + 无 REDIS_URL → 正常，不警告（EventEmitter 单实例内有效）
 *   - 生产环境 + 无任何实例标志 + 无 REDIS_URL → info 提示（可能漏配实例标志，
 *     提醒若未来扩容到多实例需先接入 Redis）
 */
if (process.env.NODE_ENV === "production") {
  const pm2Instances = parseInt(process.env.PM2_INSTANCES ?? "1", 10);
  const k8sReplicas = parseInt(process.env.K8S_REPLICAS ?? "1", 10);
  const hasRedis = !!process.env.REDIS_URL;
  const isMultiInstance = pm2Instances > 1 || k8sReplicas > 1;

  if (isMultiInstance) {
    if (!hasRedis) {
      // 多实例 + 无 Redis：消息必然丢失，严重警告
      console.warn(
        "[chat-events] 🔴 严重：检测到多实例部署环境（PM2_INSTANCES=" +
          pm2Instances +
          ", K8S_REPLICAS=" +
          k8sReplicas +
          "）且未配置 REDIS_URL。IM 事件总线（EventEmitter）仅在单实例内有效，" +
          "多实例间消息将丢失。必须配置 REDIS_URL 并将本模块升级为 Redis Pub/Sub" +
          "（见文件头注释升级路径）。",
      );
    } else {
      // 多实例 + 有 Redis：Redis 已配置但本模块仍用 EventEmitter，需代码升级
      console.warn(
        "[chat-events] ⚠️ 检测到多实例部署环境（PM2_INSTANCES=" +
          pm2Instances +
          ", K8S_REPLICAS=" +
          k8sReplicas +
          "），REDIS_URL 已配置但 chat-events 仍使用进程内 EventEmitter。" +
          "多实例间消息将丢失。请将本模块升级为 Redis Pub/Sub 以利用已有 Redis" +
          "（见文件头注释升级路径）。",
      );
    }
  } else if (!hasRedis) {
    // 单实例 + 无 Redis：可能漏配实例标志，info 提示
    console.info(
      "[chat-events] ℹ️ 单实例模式运行，未配置 REDIS_URL。当前 EventEmitter 总线可用。" +
        "若未来扩容到多实例，请先接入 Redis Pub/Sub（见文件头注释升级路径）。",
    );
  }
}

/**
 * 单用户并发 SSE 连接计数（审计遗留：连接建立限流已有，但缺并发硬上限——
 * 按每分钟 20 次建立 × 5 分钟空闲存活，单用户理论上可累积约百条长连接占句柄）。
 * key=userId，value=当前活跃连接数。多端登录场景正常值 1-3（PC + 手机 + 平板），
 * 上限取 5 留足余量；超出返回 429 由调用方拒绝连接。
 *
 * L-02 已知限制：sseConnections 计数依赖客户端在连接断开时调用 releaseSseSlot
 * 释放额度。若客户端崩溃/网络断开未发送 FIN，或调用方在异常路径漏调 release，
 * 计数会泄漏（只增不减），最终用户被误限流（达到 MAX_SSE_PER_USER 后拒绝新连接）。
 *
 * 当前防护：依赖应用层心跳——SSE 路由发送定期 ping，客户端 pong 超时后路由
 * 主动关闭连接并调 release。若未来需更强的防护，可添加定期扫描机制：
 *   - 每 5 分钟扫描 sseConnections，对计数 > 0 的 userId 发心跳探测；
 *   - 探测无响应的连接标记为僵尸，扣减计数并清理。
 * 或改为在 sseConnections 中存储最后活跃时间戳，定期清理超时（如 10 分钟无活动）的条目。
 */
const MAX_SSE_PER_USER = 5;
const sseConnections = new Map<string, number>();

// R8D-06：定期清理零计数条目，防止泄漏（依赖 releaseSseSlot 正常调用的前提下，
// 异常路径可能导致计数只增不减；定期扫描清理 count<=0 的僵尸条目）
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    for (const [key, count] of sseConnections) {
      if (count <= 0) sseConnections.delete(key);
    }
  }, 5 * 60 * 1000).unref?.(); // unref 避免阻止进程退出
}

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

// ─── S6/S7 修复：RAII 风格安全 API，确保资源在所有退出路径释放 ──────────

/**
 * S7 修复：订阅聊天事件，返回取消订阅函数。
 *
 * 替代裸 `chatEvents.on(channel, listener)` + `chatEvents.off(channel, listener)` 配对。
 * 调用方只需保存返回的 unsubscribe 函数，在连接断开时调用一次即可。
 * unsubscribe 内部幂等，多次调用安全。
 *
 * 用法：
 *   const unsubscribe = subscribeChatEvents(taskId, (event) => { ... });
 *   // 连接断开时：
 *   unsubscribe();
 */
export function subscribeChatEvents(taskId: string, listener: (event: ChatEvent) => void): () => void {
  const channel = chatChannel(taskId);
  chatEvents.on(channel, listener);
  let unsubscribed = false;
  return () => {
    if (unsubscribed) return; // 幂等
    unsubscribed = true;
    chatEvents.off(channel, listener);
  };
}

/**
 * S6 修复：获取 SSE 连接额度，返回释放函数（RAII 模式）。
 *
 * 替代裸 `tryAcquireSseSlot(userId)` + `releaseSseSlot(userId)` 配对。
 * 调用方只需保存返回的 release 函数，在连接断开时调用一次即可。
 * release 内部幂等，多次调用安全。
 *
 * 返回 null 表示额度已满（应拒绝连接），否则返回 release 函数。
 *
 * 用法：
 *   const release = acquireSseSlot(userId);
 *   if (!release) return new Response(null, { status: 429 });
 *   // 连接断开时（所有退出路径：正常断开、错误、超时）：
 *   release();
 */
export function acquireSseSlot(userId: string): (() => void) | null {
  if (!tryAcquireSseSlot(userId)) return null;
  let released = false;
  return () => {
    if (released) return; // 幂等
    released = true;
    releaseSseSlot(userId);
  };
}
