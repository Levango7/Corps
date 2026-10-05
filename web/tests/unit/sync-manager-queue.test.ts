// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * 离线同步管理器（lib/sync/sync-manager.ts）的数据安全契约。
 *
 * 这个类决定了"断网时写的东西会不会丢"，所以断言集中在队列与状态机：
 *  - 离线/失败时绝不能把队列里的操作删掉（删了就等于吞用户数据）
 *  - 服务端返回 accepted 才删除
 *  - 冲突时本地意图要么重新入队、要么与远端一致，不能凭空消失
 *  - syncUp 串行，避免并发请求风暴把同一批操作发两次
 *  - destroy 要真的清掉定时器与 window 监听（组件卸载复用同一实例）
 */

interface Op {
  id: string;
  workspaceId: string;
  module: string;
  op: string;
  targetId: string;
  payload: unknown;
}

const h = vi.hoisted(() => ({ api: vi.fn() }));

vi.mock("@/lib/api", () => {
  class ApiError extends Error {
    constructor(
      message: string,
      public status: number,
      public code: number,
    ) {
      super(message);
      this.name = "ApiError";
    }
  }
  return { api: h.api, ApiError };
});

vi.mock("@/lib/sync/offline-cache", () => {
  class OfflineCache {}
  return {
    OfflineCache,
    getOfflineCache: () => ({}),
    generateSyncOpId: () => "op-generated",
  };
});

import { SyncManager } from "@/lib/sync/sync-manager";
import { ApiError } from "@/lib/api";

const WID = "w-1";

function fakeCache(pending: Op[]) {
  const queue = [...pending];
  const removed: string[] = [];
  const enqueued: Op[] = [];
  let resolvedWith: unknown = { local: true };
  return {
    queue,
    removed,
    enqueued,
    setResolution(v: unknown) {
      resolvedWith = v;
    },
    getPendingSyncs: async () => [...queue],
    getPendingCount: async () => queue.length,
    removeSyncOps: async (ids: string[]) => {
      removed.push(...ids);
      for (const id of ids) {
        const i = queue.findIndex((q) => q.id === id);
        if (i >= 0) queue.splice(i, 1);
      }
    },
    removeSyncOp: async (id: string) => {
      removed.push(id);
      const i = queue.findIndex((q) => q.id === id);
      if (i >= 0) queue.splice(i, 1);
    },
    enqueueSync: async (op: Op) => {
      queue.push(op);
      enqueued.push(op);
    },
    resolveConflict: async () => resolvedWith,
  };
}

const OP1: Op = {
  id: "op-1",
  workspaceId: WID,
  module: "task",
  op: "update",
  targetId: "t-1",
  payload: { title: "本地改名" },
};

function setOnline(v: boolean) {
  Object.defineProperty(navigator, "onLine", { value: v, configurable: true, writable: true });
}

beforeEach(() => {
  // reset 而非 clear：clearAllMocks 不清实现，前一用例的 mockResolvedValue 会漏进后一用例
  vi.resetAllMocks();
  setOnline(true);
  // 不碰 localStorage：restoreLastSync/persistLastSync 自身对 undefined 有守卫，
  // 而这里的断言都新建实例，不依赖跨用例的持久化状态。
});

afterEach(() => {
  vi.useRealTimers();
});

describe("syncUp 的队列安全", () => {
  it("离线时不发请求、不删队列，状态转 offline", async () => {
    setOnline(false);
    const cache = fakeCache([OP1]);
    const m = new SyncManager(WID, cache as never);

    expect(await m.syncUp()).toBe(false);
    expect(h.api).not.toHaveBeenCalled();
    expect(cache.removed).toEqual([]);
    expect(cache.queue).toHaveLength(1);
    expect(m.getStatus()).toBe("offline");
  });

  it("只有服务端 accepted 的操作才被删除", async () => {
    const cache = fakeCache([OP1]);
    const m = new SyncManager(WID, cache as never);
    h.api.mockResolvedValue({ accepted: ["op-1"], conflicts: [] });

    expect(await m.syncUp()).toBe(true);
    expect(cache.removed).toEqual(["op-1"]);
    expect(cache.queue).toHaveLength(0);
    expect(m.getStatus()).toBe("synced");
  });

  it("网络错误（status 0）转离线，队列原样保留", async () => {
    const cache = fakeCache([OP1]);
    const m = new SyncManager(WID, cache as never);
    h.api.mockRejectedValue(new ApiError("network down", 0, 0));

    expect(await m.syncUp()).toBe(false);
    expect(cache.removed).toEqual([]);
    expect(cache.queue).toHaveLength(1);
    expect(m.getStatus()).toBe("offline");
  });

  it("服务端 500 转 error，队列同样不丢", async () => {
    const cache = fakeCache([OP1]);
    const m = new SyncManager(WID, cache as never);
    h.api.mockRejectedValue(new ApiError("boom", 500, 500));

    expect(await m.syncUp()).toBe(false);
    expect(cache.removed).toEqual([]);
    expect(m.getStatus()).toBe("error");
  });

  it("队列空时直接成功，不发请求", async () => {
    const cache = fakeCache([]);
    const m = new SyncManager(WID, cache as never);
    expect(await m.syncUp()).toBe(true);
    expect(h.api).not.toHaveBeenCalled();
  });
});

describe("syncUp 的冲突处理", () => {
  it("本地意图与远端不同时重新入队，原操作仍被移除", async () => {
    const cache = fakeCache([OP1]);
    cache.setResolution({ title: "本地改名" });
    const m = new SyncManager(WID, cache as never);
    const seen: unknown[] = [];
    m.onSyncConflict((c) => seen.push(c));

    h.api.mockResolvedValue({
      accepted: [],
      conflicts: [{ id: "op-1", remote: { data: { title: "远端改名" } } }],
    });

    // 有冲突即返回 false：调用方得知道"还没同步干净"
    expect(await m.syncUp()).toBe(false);
    expect(cache.enqueued).toHaveLength(1);
    expect(cache.enqueued[0].payload).toEqual({ title: "本地改名" });
    expect(cache.removed).toEqual(["op-1"]);
    expect(seen).toHaveLength(1);
  });

  it("解决方案与远端一致时不再入队（远端已是权威值）", async () => {
    const remote = { title: "远端改名" };
    const cache = fakeCache([OP1]);
    cache.setResolution(remote);
    const m = new SyncManager(WID, cache as never);

    h.api.mockResolvedValue({
      accepted: [],
      conflicts: [{ id: "op-1", remote: { data: remote } }],
    });
    await m.syncUp();

    expect(cache.enqueued).toHaveLength(0);
    expect(cache.queue).toHaveLength(0);
  });

  it("冲突 id 在本地队列里找不到时跳过，不影响其它操作", async () => {
    const cache = fakeCache([OP1]);
    const m = new SyncManager(WID, cache as never);
    h.api.mockResolvedValue({
      accepted: ["op-1"],
      conflicts: [{ id: "op-ghost", remote: null }],
    });
    expect(await m.syncUp()).toBe(false);
    expect(cache.removed).toEqual(["op-1"]);
    expect(cache.enqueued).toHaveLength(0);
  });
});

describe("syncUp 的串行锁与生命周期", () => {
  it("并发两次 syncUp 只发一次请求", async () => {
    const cache = fakeCache([OP1]);
    const m = new SyncManager(WID, cache as never);
    let release!: (v: unknown) => void;
    h.api.mockImplementation(() => new Promise((r) => (release = r)));

    const first = m.syncUp();
    const second = m.syncUp();
    // 第二个在锁上短路，不必等网络就能定论
    expect(await second).toBe(false);

    // syncUp 先 await 取队列再发请求，release 要等 api 真被调用才存在
    await vi.waitFor(() => expect(h.api).toHaveBeenCalledTimes(1));
    release({ accepted: ["op-1"], conflicts: [] });
    expect(await first).toBe(true);
    expect(h.api).toHaveBeenCalledTimes(1);
  });

  it("状态监听取消订阅后不再收报", async () => {
    // 队列必须非空：空队列时 syncUp 走「无待同步」早退分支，一次 setStatus 都不发，
    // 那时长短断言恒真，取消订阅写成空操作也测不出来（反向变异实证）。
    const cache = fakeCache([OP1]);
    const m = new SyncManager(WID, cache as never);
    const seen: string[] = [];
    const off = m.onStatusChange((s) => seen.push(s));

    setOnline(false);
    expect(await m.syncUp()).toBe(false);
    const afterFirst = seen.length;
    expect(afterFirst).toBeGreaterThan(0);

    off();
    setOnline(true);
    h.api.mockResolvedValue({ accepted: ["op-1"], conflicts: [] });
    expect(await m.syncUp()).toBe(true); // 这一段有 syncing→synced 两次状态变更
    expect(seen).toHaveLength(afterFirst);
  });

  it("destroy 清掉定时器与 window 监听，之后的 syncUp 不再动作", async () => {
    vi.useFakeTimers();
    const cache = fakeCache([OP1]);
    const m = new SyncManager(WID, cache as never);
    const removeSpy = vi.spyOn(window, "removeEventListener");
    // 离线启动：initSync 只注册监听与自动同步定时器，不发网络请求
    setOnline(false);
    m.initSync();
    expect(h.api).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);

    m.destroy();
    const cleared = removeSpy.mock.calls.map((c) => c[0]);
    expect(cleared).toContain("online");
    expect(cleared).toContain("offline");
    // 自动同步定时器必须已清，否则组件卸载后仍在打网络
    expect(vi.getTimerCount()).toBe(0);

    h.api.mockResolvedValue({ accepted: ["op-1"], conflicts: [] });
    expect(await m.syncUp()).toBe(false);
    expect(h.api).not.toHaveBeenCalled();
    expect(cache.removed).toEqual([]);
  });

  it("WS 断开不拦 HTTP 同步（navigator.onLine 才是判据）", async () => {
    const cache = fakeCache([OP1]);
    const m = new SyncManager(WID, cache as never);
    m.setWsOnline(false);
    h.api.mockResolvedValue({ accepted: ["op-1"], conflicts: [] });

    expect(await m.syncUp()).toBe(true);
    expect(h.api).toHaveBeenCalledTimes(1);
  });
});
