/**
 * IndexedDB 离线缓存管理器（零依赖，原生 IndexedDB API）。
 *
 * 职责：
 *  1. API 响应缓存（带 TTL）—— 离线时从缓存读取数据，保证可读性
 *  2. 同步队列 —— 离线时的写操作排队，恢复连接后批量上传
 *  3. 冲突解决（Last-Write-Wins，按 timestamp 比较）
 *
 * 存储结构（单个 DB，两个 object store）：
 *  - `cache` store: { key(PK), data, createdAt, expiresAt? }
 *  - `syncQueue` store: { id(PK), ...SyncOperation, createdAt }
 *
 * SSR 安全：IndexedDB 仅在浏览器存在。服务端渲染时所有方法优雅退化
 * （get 返回 null，set/enqueue 静默跳过，不抛错）。
 *
 * 经验来源：2026-09-14-multi-database-field-type-layered-implementation-pattern
 *  - 纯函数库风格：无副作用、可独立测试
 *  - 接口先定义、实现后填充
 */

/** 同步操作类型：离线时产生的写操作，恢复连接后上传 */
export interface SyncOperation {
  /** 操作 ID（UUID，用于幂等去重与队列定位） */
  id: string;
  /** 工作区 ID */
  workspaceId: string;
  /** 业务模块：task | decision | document | notification | ... */
  module: string;
  /** 操作类型 */
  op: "create" | "update" | "delete";
  /** 目标资源 ID */
  targetId: string;
  /** 操作载荷（create/update 的字段，delete 时为 null） */
  payload: unknown;
  /** 客户端创建时间戳（ms），用于 LWW 冲突解决 */
  createdAt: number;
}

/** 缓存条目结构（cache store 的 value 形状） */
interface CacheEntry {
  /** 主键 */
  key: string;
  /** 缓存数据 */
  data: unknown;
  /** 写入时间戳（ms） */
  createdAt: number;
  /** 过期时间戳（ms），undefined 表示永不过期 */
  expiresAt?: number;
}

/** 数据库名称 */
const DB_NAME = "corps-offline-cache";
/** 数据库版本 */
const DB_VERSION = 1;
/** cache object store 名称 */
const CACHE_STORE = "cache";
/** syncQueue object store 名称 */
const SYNC_QUEUE_STORE = "syncQueue";
/** 默认 TTL：5 分钟 */
const DEFAULT_TTL_MS = 5 * 60 * 1000;

/** IndexedDB 可用性检测（SSR 安全） */
function isIndexedDBAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

/** 生成 UUID v4（crypto.randomUUID 优先，回退 Math.random 拼凑） */
export function generateSyncOpId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // 回退：时间戳 + 随机数（非严格 UUID，但客户端队列去重足够）
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 打开/复用 IndexedDB 连接（单例）。
 *
 * onupgradeneeded 中创建两个 object store：
 *  - cache: keyPath = "key"
 *  - syncQueue: keyPath = "id"，按 createdAt 建索引便于按时间顺序出队
 *
 * 连接失败时抛出 Error，调用方应 catch 并降级（如回退内存）。
 */
let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (!isIndexedDBAvailable()) {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(SYNC_QUEUE_STORE)) {
        const store = db.createObjectStore(SYNC_QUEUE_STORE, { keyPath: "id" });
        // 按 createdAt 升序索引，出队时取最早入队的操作
        store.createIndex("byCreatedAt", "createdAt", { unique: false });
      }
    };
  });
  return dbPromise;
}

/**
 * 在指定 object store 上执行事务的 Promise 包装。
 *
 * @param storeName  目标 store
 * @param mode       "readonly" | "readwrite"
 * @param fn         接收 store，返回 IDBRequest（其 result 为期望值）
 */
async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDB();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const req = fn(store);
    req.onerror = () => reject(req.error ?? new Error("IDB request failed"));
    req.onsuccess = () => resolve(req.result);
    // 事务完成错误也需捕获（abort 等）
    tx.onerror = () => reject(tx.error ?? new Error("IDB transaction failed"));
  });
}

/**
 * 离线缓存管理器。
 *
 * 用法：
 *  const cache = new OfflineCache();
 *  await cache.set("tasks:ws-xxx", taskList, 60_000);
 *  const cached = await cache.get("tasks:ws-xxx");
 *
 *  await cache.enqueueSync({ id, workspaceId, module: "task", op: "update", ... });
 *  const pending = await cache.getPendingSyncs();
 */
export class OfflineCache {
  // ─── API 响应缓存 ───────────────────────────────────────────────────────

  /**
   * 读取缓存。过期或不存在返回 null。
   *
   * @param key 缓存键（建议命名：`{module}:{workspaceId}:{子维度}`）
   */
  async get(key: string): Promise<unknown | null> {
    if (!isIndexedDBAvailable()) return null;
    try {
      const entry = await withStore<CacheEntry | undefined>(
        CACHE_STORE,
        "readonly",
        (store) => store.get(key) as IDBRequest<CacheEntry | undefined>,
      );
      if (!entry) return null;
      // TTL 过期判定
      if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
        // 过期：异步删除（不阻塞本次读取）
        void this.delete(key);
        return null;
      }
      return entry.data;
    } catch {
      // 读取失败（连接异常等）降级返回 null
      return null;
    }
  }

  /**
   * 写入缓存。
   *
   * @param key   缓存键
   * @param data  任意可结构化克隆的数据
   * @param ttl   过期毫秒数；省略使用默认 5 分钟，传 0 表示永不过期
   */
  async set(key: string, data: unknown, ttl?: number): Promise<void> {
    if (!isIndexedDBAvailable()) return;
    try {
      const now = Date.now();
      const effectiveTtl = ttl === undefined ? DEFAULT_TTL_MS : ttl;
      const entry: CacheEntry = {
        key,
        data,
        createdAt: now,
        expiresAt: effectiveTtl > 0 ? now + effectiveTtl : undefined,
      };
      await withStore(CACHE_STORE, "readwrite", (store) => store.put(entry));
    } catch {
      // 写入失败静默忽略（离线缓存不阻塞业务流程）
    }
  }

  /**
   * 删除缓存条目。
   *
   * @param key 缓存键
   */
  async delete(key: string): Promise<void> {
    if (!isIndexedDBAvailable()) return;
    try {
      await withStore(CACHE_STORE, "readwrite", (store) => store.delete(key));
    } catch {
      // 删除失败静默忽略
    }
  }

  // ─── 同步队列（离线写操作排队）─────────────────────────────────────────

  /**
   * 将离线写操作入队。
   *
   * 同一资源（module + targetId）的多次 update 会累积保留（按 createdAt 顺序回放）；
   * 若需合并，调用方应在入队前自行合并相邻 update。
   *
   * @param op 同步操作（id/createdAt 可省略，自动生成）
   */
  async enqueueSync(op: Omit<SyncOperation, "id" | "createdAt"> & Partial<Pick<SyncOperation, "id" | "createdAt">>): Promise<void> {
    if (!isIndexedDBAvailable()) return;
    try {
      const fullOp: SyncOperation = {
        id: op.id ?? generateSyncOpId(),
        workspaceId: op.workspaceId,
        module: op.module,
        op: op.op,
        targetId: op.targetId,
        payload: op.payload,
        createdAt: op.createdAt ?? Date.now(),
      };
      await withStore(SYNC_QUEUE_STORE, "readwrite", (store) => store.put(fullOp));
    } catch {
      // 入队失败静默忽略（极端情况：QuotaExceededError，调用方无法处理）
    }
  }

  /**
   * 出队最早入队的同步操作（FIFO），并从队列删除。
   *
   * 实现用 getAll + 排序取最早一条，再删除。虽多一次读取，
   * 但类型清晰、无游标事务生命周期问题。
   *
   * @returns 最早的操作；队列空或不可用时返回 null
   */
  async dequeueSync(): Promise<SyncOperation | null> {
    if (!isIndexedDBAvailable()) return null;
    try {
      const all = await withStore<SyncOperation[]>(
        SYNC_QUEUE_STORE,
        "readonly",
        (store) => store.getAll() as IDBRequest<SyncOperation[]>,
      );
      if (all.length === 0) return null;
      // 按 createdAt 升序取最早一条
      const first = all.sort((a, b) => a.createdAt - b.createdAt)[0];
      await this.removeSyncOp(first.id);
      return first;
    } catch {
      return null;
    }
  }


  /**
   * 获取所有待同步操作（按 createdAt 升序），不删除。
   *
   * 用于 UI 展示待同步数量、批量上传。
   */
  async getPendingSyncs(): Promise<SyncOperation[]> {
    if (!isIndexedDBAvailable()) return [];
    try {
      return await withStore<SyncOperation[]>(
        SYNC_QUEUE_STORE,
        "readonly",
        (store) => store.getAll() as IDBRequest<SyncOperation[]>,
      ).then((all) => all.sort((a, b) => a.createdAt - b.createdAt));
    } catch {
      return [];
    }
  }

  /**
   * 获取待同步操作数量（轻量查询，UI 轮询用）。
   */
  async getPendingCount(): Promise<number> {
    if (!isIndexedDBAvailable()) return 0;
    try {
      return await withStore<number>(
        SYNC_QUEUE_STORE,
        "readonly",
        (store) => store.count() as IDBRequest<number>,
      );
    } catch {
      return 0;
    }
  }

  /**
   * 按 ID 删除指定同步操作（上传成功后调用）。
   *
   * @param id 操作 ID
   */
  async removeSyncOp(id: string): Promise<void> {
    if (!isIndexedDBAvailable()) return;
    try {
      await withStore(SYNC_QUEUE_STORE, "readwrite", (store) => store.delete(id));
    } catch {
      // 删除失败静默忽略
    }
  }

  /**
   * 批量删除已成功上传的同步操作。
   *
   * @param ids 已完成操作 ID 列表
   */
  async removeSyncOps(ids: string[]): Promise<void> {
    if (!isIndexedDBAvailable() || ids.length === 0) return;
    try {
      const db = await openDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(SYNC_QUEUE_STORE, "readwrite");
        const store = tx.objectStore(SYNC_QUEUE_STORE);
        for (const id of ids) store.delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("batch delete failed"));
      });
    } catch {
      // 批量删除失败静默忽略
    }
  }

  /**
   * 清空同步队列（调试/重置用）。
   */
  async clearSyncQueue(): Promise<void> {
    if (!isIndexedDBAvailable()) return;
    try {
      await withStore(SYNC_QUEUE_STORE, "readwrite", (store) => store.clear());
    } catch {
      // 清空失败静默忽略
    }
  }

  // ─── 冲突解决（Last-Write-Wins）────────────────────────────────────────

  /**
   * 冲突解决：Last-Write-Wins 策略。
   *
   * 比较本地操作的 createdAt 与远程记录的 updatedAt：
   *  - 本地较新 → 采用本地 payload
   *  - 远程较新或相等 → 采用远程值（远程为权威副本）
   *
   * @param local  本地待同步操作
   * @param remote 远程当前值（含 updatedAt 字段）
   * @returns 冲突解决后的值
   */
  async resolveConflict(
    local: SyncOperation,
    remote: { updatedAt?: string | number; data?: unknown } | null,
  ): Promise<unknown> {
    // 远程不存在：本地操作直接生效（新建场景）
    if (!remote) return local.payload;

    const remoteTs = typeof remote.updatedAt === "string"
      ? new Date(remote.updatedAt).getTime()
      : (remote.updatedAt ?? 0);

    // 本地较新 → 本地胜出
    if (local.createdAt > remoteTs) return local.payload;

    // 远程较新或相等 → 远程胜出（权威副本）
    return remote.data ?? null;
  }
}

/**
 * 全局单例（浏览器端复用同一 DB 连接）。
 *
 * SSR 期间方法均优雅退化，安全调用。
 */
let globalInstance: OfflineCache | null = null;

export function getOfflineCache(): OfflineCache {
  if (!globalInstance) globalInstance = new OfflineCache();
  return globalInstance;
}