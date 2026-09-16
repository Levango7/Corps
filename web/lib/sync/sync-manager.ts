"use client";

/**
 * 跨设备状态同步管理器。
 *
 * 职责：
 *  1. 初始化工作区同步（initSync）
 *  2. 上传本地变更（syncUp）—— 处理离线同步队列，批量 POST
 *  3. 拉取远程变更（syncDown）—— 增量同步，按 since timestamp 拉取
 *  4. 在线/离线检测 —— navigator.onLine + 可选 WebSocket 状态注入
 *  5. 在线时自动 syncUp + syncDown；离线时写操作入队
 *  6. 冲突回调（onSyncConflict）
 *
 * 设计：
 *  - 非单例：每个 workspaceId 一个实例（多工作区切换时各自管理）
 *  - 状态机：synced → syncing → synced | offline | error
 *  - 防抖：syncUp/syncDown 串行，避免并发请求风暴
 *  - 指数退避：syncDown 失败后重试间隔递增
 *
 * 与 IM WebSocket 的关系：
 *  IM WS 负责实时消息推送；本同步管理器负责业务数据（任务/决策/文档等）的
 *  跨设备一致性。两者独立，但在线判定可融合（WS 断开但 navigator.onLine
 *  仍 true 时，视为"弱在线"——仍尝试 HTTP 同步，因为 HTTP 不依赖 WS）。
 *
 * 经验来源：2026-09-12-frontend-role-permission-extension-fullstack-pattern
 *  - 客户端模块用 'use client' + api() 客户端调用
 */

import { api, ApiError } from "@/lib/api";
import {
  OfflineCache,
  getOfflineCache,
  generateSyncOpId,
  type SyncOperation,
} from "./offline-cache";

/** 同步状态 */
export type SyncStatus = "synced" | "syncing" | "offline" | "error";

/** 冲突信息（传给 onSyncConflict 回调） */
export interface SyncConflict {
  /** 本地操作 */
  local: SyncOperation;
  /** 远程当前值 */
  remote: unknown;
  /** 解决后的值 */
  resolved: unknown;
}

/** syncDown 拉取的增量变更响应 */
export interface SyncDownResponse {
  /** 各模块变更（task: [...], decision: [...], ...） */
  changes: Record<string, unknown[]>;
  /** 服务端当前时间戳（ms），作为下次 since */
  serverTime: number;
}

/** syncUp 上传响应 */
export interface SyncUpResponse {
  /** 已接受的操作 ID */
  accepted: string[];
  /** 发生冲突的操作（需客户端处理） */
  conflicts: Array<{ id: string; remote: unknown }>;
}

/** 状态变更监听器 */
type StatusListener = (status: SyncStatus, lastSyncAt: number | null) => void;
/** 冲突监听器 */
type ConflictListener = (conflict: SyncConflict) => void;
/** 待同步数量监听器 */
type PendingListener = (count: number) => void;

/** 自动同步间隔（在线时定期 syncDown） */
const AUTO_SYNC_INTERVAL_MS = 60_000;
/** syncDown 失败后基础重试延迟 */
const RETRY_BASE_DELAY_MS = 5_000;
/** syncDown 失败后最大重试延迟 */
const RETRY_MAX_DELAY_MS = 60_000;
/** localStorage 中记录 lastSyncAt 的 key 前缀 */
const LAST_SYNC_KEY_PREFIX = "corps-sync:lastSync:";

/**
 * 同步管理器。
 *
 * 用法：
 *  const manager = new SyncManager(workspaceId);
 *  manager.onStatusChange((status, lastSync) => { ... });
 *  manager.initSync();
 *  // 业务写操作：
 *  manager.enqueueWrite({ module: "task", op: "update", targetId, payload });
 *  // 手动同步：
 *  await manager.syncNow();
 *  // 卸载：
 *  manager.destroy();
 */
export class SyncManager {
  private readonly workspaceId: string;
  private readonly cache: OfflineCache;

  private status: SyncStatus = "synced";
  private lastSyncAt: number | null = null;
  /** since timestamp：下次 syncDown 传入的增量起点 */
  private since: number = 0;

  private statusListeners = new Set<StatusListener>();
  private conflictListeners = new Set<ConflictListener>();
  private pendingListeners = new Set<PendingListener>();

  /** 自动同步定时器 */
  private autoSyncTimer: ReturnType<typeof setInterval> | null = null;
  /** 重试定时器 */
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** 重试次数（指数退避） */
  private retryAttempt = 0;

  /** syncUp/syncDown 串行锁 */
  private syncUpInProgress = false;
  private syncDownInProgress = false;

  /** 在线状态覆盖（可由外部注入 WS 状态） */
  private wsOnlineOverride: boolean | null = null;

  /** 已销毁标记 */
  private destroyed = false;

  constructor(workspaceId: string, cache?: OfflineCache) {
    this.workspaceId = workspaceId;
    this.cache = cache ?? getOfflineCache();
    // 从 localStorage 恢复 lastSyncAt / since
    this.restoreLastSync();
  }

  // ─── 公开 API ───────────────────────────────────────────────────────────

  /**
   * 初始化同步。
   *
   *  - 注册 online/offline 事件监听
   *  - 立即执行一次 syncDown（拉取最新）+ syncUp（上传离线积压）
   *  - 启动定时自动同步
   */
  initSync(): void {
    if (this.destroyed) return;
    if (typeof window === "undefined") return;

    // 监听在线/离线切换
    window.addEventListener("online", this.handleOnline);
    window.addEventListener("offline", this.handleOffline);

    // 初始状态判定
    if (this.isOnline()) {
      this.setStatus("syncing");
      // 立即同步：先上传离线积压，再拉取远程
      void this.syncUp().then(() => this.syncDown());
    } else {
      this.setStatus("offline");
    }

    // 启动定时自动同步
    this.startAutoSync();
  }

  /**
   * 上传本地变更（处理同步队列）。
   *
   * 从离线缓存取出所有 pending 操作，批量 POST 到 /api/v1/sync。
   * 成功的操作从队列删除；冲突的操作触发 onSyncConflict 回调。
   *
   * @returns 是否全部成功（无冲突、无错误）
   */
  async syncUp(): Promise<boolean> {
    if (this.destroyed || this.syncUpInProgress) return false;
    if (!this.isOnline()) {
      this.setStatus("offline");
      return false;
    }

    this.syncUpInProgress = true;
    try {
      const pending = await this.cache.getPendingSyncs();
      if (pending.length === 0) {
        // 无待同步：仅更新 pending 通知
        this.notifyPending(0);
        return true;
      }

      this.setStatus("syncing");
      this.notifyPending(pending.length);

      const result = await api<SyncUpResponse>("/api/v1/sync", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: this.workspaceId,
          operations: pending,
        }),
      });

      // 删除已接受的操作
      if (result.accepted.length > 0) {
        await this.cache.removeSyncOps(result.accepted);
      }

      // 处理冲突
      for (const conflict of result.conflicts) {
        const localOp = pending.find((p) => p.id === conflict.id);
        if (!localOp) continue;
        const resolved = await this.cache.resolveConflict(localOp, conflict.remote as { updatedAt?: string | number; data?: unknown } | null);
        // 触发冲突回调
        this.notifyConflict({
          local: localOp,
          remote: conflict.remote,
          resolved,
        });
        // 冲突解决后：以 resolved 重新入队（下次 syncUp 再上传）
        // 但 remote 已是权威值，若 resolved === remote.data 则直接接受、删除该操作
        const remoteData = (conflict.remote as { data?: unknown } | null)?.data;
        if (resolved !== remoteData) {
          await this.cache.enqueueSync({
            id: generateSyncOpId(),
            workspaceId: this.workspaceId,
            module: localOp.module,
            op: localOp.op,
            targetId: localOp.targetId,
            payload: resolved,
          });
        }
        await this.cache.removeSyncOp(conflict.id);
      }

      // 更新 pending 计数
      const remaining = await this.cache.getPendingCount();
      this.notifyPending(remaining);

      this.lastSyncAt = Date.now();
      this.persistLastSync();
      this.setStatus("synced");
      this.retryAttempt = 0;
      return result.conflicts.length === 0;
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) {
        // 网络错误：转为离线
        this.setStatus("offline");
      } else {
        this.setStatus("error");
      }
      if (process.env.NODE_ENV === "development") {
        console.error("[SyncManager] syncUp error:", err);
      }
      return false;
    } finally {
      this.syncUpInProgress = false;
    }
  }

  /**
   * 拉取远程变更（增量同步）。
   *
   * GET /api/v1/sync?workspaceId=xxx&since=timestamp
   * 返回各模块自 since 以来的变更，客户端据此更新本地缓存与 UI。
   *
   * @returns 拉取到的变更（空对象表示无变更）
   */
  async syncDown(): Promise<Record<string, unknown[]> | null> {
    if (this.destroyed || this.syncDownInProgress) return null;
    if (!this.isOnline()) {
      this.setStatus("offline");
      return null;
    }

    this.syncDownInProgress = true;
    try {
      this.setStatus("syncing");

      const result = await api<SyncDownResponse>(
        `/api/v1/sync?workspaceId=${encodeURIComponent(this.workspaceId)}&since=${this.since}`,
        { method: "GET" },
      );

      // 更新 since 游标
      this.since = result.serverTime;
      this.lastSyncAt = Date.now();
      this.persistLastSync();

      // 更新本地缓存（各模块最新列表）
      for (const [module, items] of Object.entries(result.changes)) {
        const cacheKey = `${module}:${this.workspaceId}`;
        await this.cache.set(cacheKey, items);
      }

      this.setStatus("synced");
      this.retryAttempt = 0;
      return result.changes;
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) {
        this.setStatus("offline");
      } else {
        this.setStatus("error");
        // 失败重试（指数退避）
        this.scheduleRetry();
      }
      if (process.env.NODE_ENV === "development") {
        console.error("[SyncManager] syncDown error:", err);
      }
      return null;
    } finally {
      this.syncDownInProgress = false;
    }
  }

  /**
   * 手动触发完整同步（syncUp + syncDown）。
   *
   * 用户点击"立即同步"按钮时调用。
   */
  async syncNow(): Promise<void> {
    if (this.destroyed) return;
    if (!this.isOnline()) {
      this.setStatus("offline");
      return;
    }
    this.setStatus("syncing");
    await this.syncUp();
    await this.syncDown();
  }

  /**
   * 业务写操作入口。
   *
   * 在线时：直接返回（调用方应走常规 API；本方法仅用于离线兜底入队）。
   * 离线时：入队到同步队列，待恢复连接后上传。
   *
   * @param op 操作描述（不含 id/createdAt/workspaceId，自动填充）
   */
  async enqueueWrite(op: {
    module: string;
    op: "create" | "update" | "delete";
    targetId: string;
    payload: unknown;
  }): Promise<void> {
    if (this.destroyed) return;
    await this.cache.enqueueSync({
      workspaceId: this.workspaceId,
      module: op.module,
      op: op.op,
      targetId: op.targetId,
      payload: op.payload,
    });
    const count = await this.cache.getPendingCount();
    this.notifyPending(count);
  }

  /**
   * 注册状态变更监听。
   *
   * @returns 取消注册函数
   */
  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    // 立即推送当前状态
    listener(this.status, this.lastSyncAt);
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      this.statusListeners.delete(listener);
    };
  }

  /**
   * 注册冲突监听。
   *
   * @returns 取消注册函数
   */
  onSyncConflict(listener: ConflictListener): () => void {
    this.conflictListeners.add(listener);
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      this.conflictListeners.delete(listener);
    };
  }

  /**
   * 注册待同步数量监听。
   *
   * @returns 取消注册函数
   */
  onPendingChange(listener: PendingListener): () => void {
    this.pendingListeners.add(listener);
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      this.pendingListeners.delete(listener);
    };
  }

  /**
   * 注入 WebSocket 在线状态（融合判定）。
   *
   * WS 连接状态可由外部（如 useIMWebSocket）注入，与 navigator.onLine
   * 取交集：两者皆在线才视为完全在线。但 HTTP 同步不强制要求 WS，
   * 故仅当 WS 明确断开且 navigator.onLine 为 true 时仍尝试 HTTP。
   *
   * @param online WS 是否已连接
   */
  setWsOnline(online: boolean): void {
    this.wsOnlineOverride = online;
  }

  /** 获取当前同步状态 */
  getStatus(): SyncStatus {
    return this.status;
  }

  /** 获取最后同步时间（ms），未同步过返回 null */
  getLastSyncAt(): number | null {
    return this.lastSyncAt;
  }

  /** 获取当前待同步操作数 */
  async getPendingCount(): Promise<number> {
    return this.cache.getPendingCount();
  }

  /**
   * 销毁管理器：移除监听、清理定时器。
   *
   * 组件卸载时必须调用，避免内存泄漏。
   */
  destroy(): void {
    this.destroyed = true;
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.handleOnline);
      window.removeEventListener("offline", this.handleOffline);
    }
    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer);
      this.autoSyncTimer = null;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.statusListeners.clear();
    this.conflictListeners.clear();
    this.pendingListeners.clear();
  }

  // ─── 内部实现 ───────────────────────────────────────────────────────────

  /** 当前是否在线（navigator.onLine + WS 覆盖） */
  private isOnline(): boolean {
    if (typeof navigator === "undefined") return false;
    const navOnline = navigator.onLine;
    if (this.wsOnlineOverride === false) {
      // WS 明确断开：仍按 navigator.onLine 判定（HTTP 同步可独立工作）
      // 但若 navigator 也离线，则确属离线
      return navOnline;
    }
    return navOnline;
  }

  /** online 事件处理 */
  private handleOnline = (): void => {
    if (this.destroyed) return;
    this.retryAttempt = 0;
    this.setStatus("syncing");
    // 恢复连接：先上传积压，再拉取最新
    void this.syncUp().then(() => this.syncDown());
  };

  /** offline 事件处理 */
  private handleOffline = (): void => {
    if (this.destroyed) return;
    this.setStatus("offline");
  };

  /** 启动定时自动同步 */
  private startAutoSync(): void {
    if (this.autoSyncTimer) clearInterval(this.autoSyncTimer);
    this.autoSyncTimer = setInterval(() => {
      if (this.destroyed || !this.isOnline()) return;
      // 定时同步：仅 syncDown（syncUp 由写操作触发）
      void this.syncDown();
    }, AUTO_SYNC_INTERVAL_MS);
  }

  /** 失败重试（指数退避） */
  private scheduleRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const base = RETRY_BASE_DELAY_MS * 2 ** this.retryAttempt;
    const delay = Math.min(base, RETRY_MAX_DELAY_MS);
    this.retryAttempt += 1;
    this.retryTimer = setTimeout(() => {
      if (this.destroyed || !this.isOnline()) return;
      void this.syncDown();
    }, delay);
  }

  /** 设置状态并通知监听器 */
  private setStatus(status: SyncStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this.statusListeners) {
      try {
        listener(status, this.lastSyncAt);
      } catch (err) {
        if (process.env.NODE_ENV === "development") {
          console.error("[SyncManager] status listener error:", err);
        }
      }
    }
  }

  /** 通知冲突监听器 */
  private notifyConflict(conflict: SyncConflict): void {
    for (const listener of this.conflictListeners) {
      try {
        listener(conflict);
      } catch (err) {
        if (process.env.NODE_ENV === "development") {
          console.error("[SyncManager] conflict listener error:", err);
        }
      }
    }
  }

  /** 通知 pending 监听器 */
  private notifyPending(count: number): void {
    for (const listener of this.pendingListeners) {
      try {
        listener(count);
      } catch (err) {
        if (process.env.NODE_ENV === "development") {
          console.error("[SyncManager] pending listener error:", err);
        }
      }
    }
  }

  /** 持久化 lastSyncAt / since 到 localStorage */
  private persistLastSync(): void {
    if (typeof localStorage === "undefined") return;
    try {
      const key = `${LAST_SYNC_KEY_PREFIX}${this.workspaceId}`;
      localStorage.setItem(key, JSON.stringify({
        lastSyncAt: this.lastSyncAt,
        since: this.since,
      }));
    } catch {
      // localStorage 不可用（隐私模式等）静默忽略
    }
  }

  /** 从 localStorage 恢复 lastSyncAt / since */
  private restoreLastSync(): void {
    if (typeof localStorage === "undefined") return;
    try {
      const key = `${LAST_SYNC_KEY_PREFIX}${this.workspaceId}`;
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { lastSyncAt?: number; since?: number };
      if (typeof parsed.lastSyncAt === "number") this.lastSyncAt = parsed.lastSyncAt;
      if (typeof parsed.since === "number") this.since = parsed.since;
    } catch {
      // 解析失败静默忽略
    }
  }
}

/**
 * 同步管理器实例池（按 workspaceId 缓存）。
 *
 * 多工作区切换时复用同一实例，避免重复初始化监听。
 * 组件卸载时不销毁实例（由工作区切换时清理）。
 */
const managerPool = new Map<string, SyncManager>();

/**
 * 获取指定工作区的同步管理器（池化单例）。
 *
 * @param workspaceId 工作区 ID
 * @returns SyncManager 实例
 */
export function getSyncManager(workspaceId: string): SyncManager {
  let manager = managerPool.get(workspaceId);
  if (!manager) {
    manager = new SyncManager(workspaceId);
    managerPool.set(workspaceId, manager);
  }
  return manager;
}

/**
 * 销毁指定工作区的同步管理器（工作区切换/退出时调用）。
 *
 * @param workspaceId 工作区 ID
 */
export function destroySyncManager(workspaceId: string): void {
  const manager = managerPool.get(workspaceId);
  if (manager) {
    manager.destroy();
    managerPool.delete(workspaceId);
  }
}