// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { OfflineCache, generateSyncOpId, getOfflineCache } from "@/lib/sync/offline-cache";

/**
 * IndexedDB 离线缓存契约（lib/sync/offline-cache.ts）：
 *  - **SSR 安全**：无 indexedDB 时所有方法优雅退化（get→null / 队列→空 / 写入静默 no-op，
 *    一律不抛）——服务端渲染安全的前提
 *  - TTL：过期条目 get 返回 null 并**异步删除**（不阻塞读取）；ttl=0 表示永不过期
 *  - 入队/出队：FIFO 按 createdAt；dequeue 读删同事务原子（防双标签页取到同一条）
 *  - **LWW 冲突解决**：远程不存在→本地生效；本地更新→本地胜；远程新或相等→远程胜
 *    （远程为权威副本）；远程 updatedAt 支持 ISO 字符串与毫秒数字
 *
 * IndexedDB 用本文件内的最小内存 fake（Map 支撑，请求以微任务回调），
 * 覆盖该模块实际用到的 API 面（open/transaction/get/put/delete/getAll/count/clear/index+cursor）。
 */

// ─── 最小内存 IndexedDB fake ──────────────────────────────────────────
type Store = Map<string, unknown>;

class FakeCursor {
  constructor(
    private rows: Array<Record<string, unknown>>,
    private idx: number,
    private onDelete: (record: Record<string, unknown>) => void,
  ) {}
  get value() {
    return this.rows[this.idx];
  }
  delete() {
    this.onDelete(this.rows[this.idx]);
  }
}

function makeFakeIDB() {
  const stores = new Map<string, Store>();
  const indexSource = new Map<string, { keyPath: string }>();

  const makeStoreHandle = (_db: { storeNames: string[] }) => (name: string) => {
    if (!stores.has(name)) throw new Error(`no store ${name}`);
    const store = stores.get(name)!;
    const keyPath = indexSource.get(name)!.keyPath;
    const done = (req: { onsuccess: (() => void) | null; result: unknown }, result: unknown) => {
      req.result = result;
      queueMicrotask(() => req.onsuccess?.());
    };
    const handle = {
      get: (key: string) => {
        const req = { onsuccess: null as null | (() => void), onerror: null, result: undefined };
        done(req, store.get(key));
        return req;
      },
      put: (value: Record<string, unknown>) => {
        const req = { onsuccess: null as null | (() => void), onerror: null, result: undefined };
        store.set(String(value[keyPath]), value);
        done(req, undefined);
        return req;
      },
      delete: (key: string) => {
        const req = { onsuccess: null as null | (() => void), onerror: null, result: undefined };
        store.delete(key);
        done(req, undefined);
        return req;
      },
      getAll: () => {
        const req = { onsuccess: null as null | (() => void), onerror: null, result: undefined };
        done(req, [...store.values()]);
        return req;
      },
      count: () => {
        const req = { onsuccess: null as null | (() => void), onerror: null, result: undefined };
        done(req, store.size);
        return req;
      },
      clear: () => {
        const req = { onsuccess: null as null | (() => void), onerror: null, result: undefined };
        store.clear();
        done(req, undefined);
        return req;
      },
      index: (_indexName: string) => ({
        openCursor: (_range: unknown, _dir: string) => {
          const req = {
            onsuccess: null as null | (() => void),
            onerror: null,
            result: null as FakeCursor | null,
            _rows: ([...store.values()] as Record<string, unknown>[]).sort(
              (a, b) =>
                Number((a as Record<string, unknown>).createdAt) -
                Number((b as Record<string, unknown>).createdAt),
            ),
            _cur: 0,
            _req: null as unknown,
          };
          const advance = () => {
            if (req._cur >= req._rows.length) {
              req.result = null;
            } else {
              req.result = new FakeCursor(req._rows, req._cur, (rec) => {
                store.delete(String(rec[keyPath]));
              });
              req._cur += 1;
            }
            queueMicrotask(() => req.onsuccess?.());
          };
          // 首次推进 + 每次 cursor 消费后（本模块只消费一条即停，够用）
          queueMicrotask(advance);
          return req;
        },
      }),
    };
    return handle;
  };

  const fake = {
    open: (_name: string, _version: number) => {
      const req = {
        onsuccess: null as null | (() => void),
        onerror: null,
        onupgradeneeded: null as null | (() => void),
        result: null as unknown,
      };
      queueMicrotask(() => {
        const db = {
          objectStoreNames: { contains: (n: string) => stores.has(n) } as unknown as DOMStringList,
          createObjectStore: (n: string, opts: { keyPath: string }) => {
            stores.set(n, new Map());
            indexSource.set(n, opts);
            return { createIndex: () => undefined };
          },
          transaction: (_name: string) => {
            const tx = {
              objectStore: makeStoreHandle({ storeNames: [...stores.keys()] }),
              oncomplete: null as null | (() => void),
              onerror: null,
              onabort: null,
            };
            // 宏任务推后：保证 tx.oncomplete 一定晚于本事务内各请求的 onsuccess 回调
            // （否则 dequeueSync 会在 cursor 回填前拿到 null 就 resolve）
            setTimeout(() => tx.oncomplete?.(), 0);
            return tx;
          },
        };
        // 真 IDB 在触发 upgradeneeded 前 result 已就绪（模块的 onupgradeneeded 读 req.result）
        req.result = db;
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
  return fake;
}

let realIndexedDB: unknown;

beforeEach(() => {
  realIndexedDB = (globalThis as Record<string, unknown>).indexedDB;
});

afterEach(() => {
  (globalThis as Record<string, unknown>).indexedDB = realIndexedDB;
  vi.restoreAllMocks();
});

async function withFakeIDB(): Promise<OfflineCache> {
  (globalThis as Record<string, unknown>).indexedDB = makeFakeIDB();
  // 模块级 dbPromise 单例：换 IDB 实现前要 resetModules 拿干净模块
  vi.resetModules();
  const mod = await import("@/lib/sync/offline-cache");
  return new mod.OfflineCache();
}

// ─── 用例 ─────────────────────────────────────────────────────────────

describe("SSR 安全：无 indexedDB 时全部优雅退化", () => {
  it("读取类返回空、写入类静默 no-op、一律不抛", async () => {
    delete (globalThis as Record<string, unknown>).indexedDB;
    vi.resetModules();
    const mod = await import("@/lib/sync/offline-cache");
    const cache = new mod.OfflineCache();

    expect(await cache.get("k")).toBeNull();
    expect(await cache.getPendingSyncs()).toEqual([]);
    expect(await cache.getPendingCount()).toBe(0);
    expect(await cache.dequeueSync()).toBeNull();
    await expect(cache.set("k", 1)).resolves.toBeUndefined();
    await expect(
      cache.enqueueSync({
        workspaceId: "w",
        module: "task",
        op: "create",
        targetId: "t",
        payload: {},
      }),
    ).resolves.toBeUndefined();
    await expect(cache.delete("k")).resolves.toBeUndefined();
    await expect(cache.removeSyncOp("id")).resolves.toBeUndefined();
    await expect(cache.removeSyncOps(["a", "b"])).resolves.toBeUndefined();
    await expect(cache.clearSyncQueue()).resolves.toBeUndefined();
  });
});

describe("generateSyncOpId", () => {
  it("标准环境：返回 UUID（crypto.randomUUID）", () => {
    expect(generateSyncOpId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("无 crypto.randomUUID：回退时间戳-随机数格式（非严格 UUID 但可去重）", () => {
    const orig = globalThis.crypto;
    vi.stubGlobal("crypto", {});
    const id = generateSyncOpId();
    expect(id).toMatch(/^[a-z0-9]+-[a-z0-9]{8}$/);
    vi.unstubAllGlobals();
    void orig;
  });
});

describe("缓冲：set/get/TTL/delete", () => {
  it("写入后可读回；ttl=0 永不过期", async () => {
    const cache = await withFakeIDB();
    await cache.set("tasks:w1", [{ id: "t1" }]);
    expect(await cache.get("tasks:w1")).toEqual([{ id: "t1" }]);
    await cache.set("forever", "v", 0);
    expect(await cache.get("forever")).toBe("v");
  });

  it("TTL 过期：get 返回 null 并异步删除该条目", async () => {
    const cache = await withFakeIDB();
    await cache.set("ttl:key", "data", 1); // 1ms TTL
    await new Promise((r) => setTimeout(r, 5));
    expect(await cache.get("ttl:key")).toBeNull();
    // 再读一遍仍是 null（说明删除或过期判定稳定，不会“复活”）
    expect(await cache.get("ttl:key")).toBeNull();
  });

  it("delete 后读回 null；未知 key 也返回 null", async () => {
    const cache = await withFakeIDB();
    await cache.set("k", 1);
    await cache.delete("k");
    expect(await cache.get("k")).toBeNull();
    expect(await cache.get("never-set")).toBeNull();
  });
});

describe("同步队列：入队/出队/计数/批量删/清空", () => {
  const op = (targetId: string, createdAt: number) => ({
    workspaceId: "w1",
    module: "task",
    op: "update" as const,
    targetId,
    payload: { t: targetId },
    createdAt,
  });

  it("enqueue 自动补 id/createdAt；getPendingSyncs 按 createdAt 升序", async () => {
    const cache = await withFakeIDB();
    await cache.enqueueSync(op("t2", 2000));
    await cache.enqueueSync(op("t1", 1000));
    const pending = await cache.getPendingSyncs();
    expect(pending.map((o) => o.targetId)).toEqual(["t1", "t2"]);
    expect(pending[0].id).toBeTruthy(); // 自动生成
    expect(await cache.getPendingCount()).toBe(2);
  });

  it("dequeueSync：FIFO 取最早一条并原子删除（再取是下一条）", async () => {
    const cache = await withFakeIDB();
    await cache.enqueueSync(op("first", 100));
    await cache.enqueueSync(op("second", 200));
    const d1 = await cache.dequeueSync();
    expect(d1?.targetId).toBe("first");
    const d2 = await cache.dequeueSync();
    expect(d2?.targetId).toBe("second");
    expect(await cache.dequeueSync()).toBeNull();
    expect(await cache.getPendingCount()).toBe(0);
  });

  it("removeSyncOps 批量删除；clearSyncQueue 清空", async () => {
    const cache = await withFakeIDB();
    await cache.enqueueSync({ ...op("a", 1), id: "id-a" });
    await cache.enqueueSync({ ...op("b", 2), id: "id-b" });
    await cache.removeSyncOps(["id-a"]);
    expect(await cache.getPendingCount()).toBe(1);
    await cache.clearSyncQueue();
    expect(await cache.getPendingCount()).toBe(0);
  });
});

describe("LWW 冲突解决（resolveConflict）", () => {
  const local = (createdAt: number, payload: unknown) => ({
    id: "1",
    workspaceId: "w",
    module: "task",
    op: "update" as const,
    targetId: "t",
    payload,
    createdAt,
  });

  it("远程不存在：本地 payload 直接生效（新建场景）", async () => {
    const cache = new OfflineCache();
    expect(await cache.resolveConflict(local(100, { v: "local" }), null)).toEqual({ v: "local" });
  });

  it("本地更新（createdAt > 远程 ts）：本地胜", async () => {
    const cache = new OfflineCache();
    const res = await cache.resolveConflict(local(2000, { v: "local" }), {
      updatedAt: 1000,
      data: { v: "remote" },
    });
    expect(res).toEqual({ v: "local" });
  });

  it("远程更新（ISO 字符串 updatedAt）：远程胜", async () => {
    const cache = new OfflineCache();
    const res = await cache.resolveConflict(local(1000, { v: "local" }), {
      updatedAt: new Date(2000).toISOString(),
      data: { v: "remote" },
    });
    expect(res).toEqual({ v: "remote" });
  });

  it("时间相等：远程为权威副本（远程胜）", async () => {
    const cache = new OfflineCache();
    const res = await cache.resolveConflict(local(1000, { v: "local" }), {
      updatedAt: 1000,
      data: { v: "remote" },
    });
    expect(res).toEqual({ v: "remote" });
  });

  it("远程无 updatedAt：按 0 处理（本地必然更新）", async () => {
    const cache = new OfflineCache();
    expect(await cache.resolveConflict(local(1, "L"), { data: "R" })).toBe("L");
  });

  it("远程胜但无 data：返回 null（不得返回 undefined）", async () => {
    const cache = new OfflineCache();
    expect(await cache.resolveConflict(local(0, "L"), { updatedAt: 5 })).toBeNull();
  });
});

describe("getOfflineCache 单例", () => {
  it("同一实例复用", () => {
    expect(getOfflineCache()).toBe(getOfflineCache());
  });
});
