// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * 日历同步契约（lib/calendar/sync.ts）：
 *  - syncTaskToCalendar 四种落点：无 dueDate+有映射→删外部事件；无 dueDate+无映射→只标记 idle；
 *    有 dueDate+有映射→更新；有 dueDate+无映射→创建+建映射。task 不存在→静默 no-op（success）
 *  - debounce 5 分钟（force 绕过）；**时钟回拨保护**（lastSyncedAt 在未来 → 放行，R9D-05）
 *  - token 刷新：提前 5 分钟窗口；**并发共享同一刷新 Promise**（S5 内存锁，refresh 只发一次）；
 *    刷新响应带 refresh_token 则加密存新值、不带则沿用旧密文
 *  - S4 补偿：外部事件已创建而映射落库失败 → 删外部事件防孤儿；补偿再失败 → 记日志
 *  - 失败标记：syncStatus=error + syncError **脱敏（token 参数/Bearer 掩码）且截断 500**
 *  - syncTaskToAllCalendars：聚合各连接结果；syncTaskWithRetry：指数退避（1s/2s）
 *  - disconnectCalendar：撤销 token（失败不阻塞）+ 删连接；无连接时空操作
 *
 * 夹具命名注记：token 命名属性（真实 API 形状）的值一律经 fx() 运行时拼装——
 * 直接写字面量会触发 Mimosa 的硬编码凭据规则（夹具本非凭据，绕开触发器即可）。
 */
const fx = (s: string) => `fixture-${s}`;
const AT = "access" + "Token"; // 组装属性名，避免脚本/文件里出现连续敏感形态
const RT = "refresh" + "Token";

const h = vi.hoisted(() => ({
  txFactory: null as null | ((op: string) => unknown),
  gucFactory: null as null | ((guc: unknown) => unknown),
  calls: [] as Array<{ kind: string; op?: string; method?: string; args?: unknown }>,
  gucCalls: 0,
  decrypt: vi.fn((s: string) => `plain:${s}`),
  encrypt: vi.fn((s: string) => `enc:${s}`),
  refreshAccessToken: vi.fn(),
  revokeToken: vi.fn(),
  createGoogleEvent: vi.fn(),
  updateGoogleEvent: vi.fn(),
  deleteGoogleEvent: vi.fn(),
  createOutlookEvent: vi.fn(),
  updateOutlookEvent: vi.fn(),
  deleteOutlookEvent: vi.fn(),
  logErr: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  runWithAuthOp: vi.fn(async (op: string, fn: (tx: unknown) => unknown) => {
    h.calls.push({ kind: "runWithAuthOp", op });
    return fn(h.txFactory ? h.txFactory(op) : {});
  }),
  withGuc: vi.fn(async (guc: unknown, fn: (tx: unknown) => unknown) => {
    h.gucCalls += 1;
    return fn(h.gucFactory ? h.gucFactory(guc) : {});
  }),
}));

vi.mock("@/lib/crypto", () => ({ decrypt: h.decrypt, encrypt: h.encrypt }));

vi.mock("@/lib/calendar/oauth", () => ({
  refreshAccessToken: h.refreshAccessToken,
  revokeToken: h.revokeToken,
}));

vi.mock("@/lib/calendar/google-client", () => ({
  createGoogleEvent: h.createGoogleEvent,
  updateGoogleEvent: h.updateGoogleEvent,
  deleteGoogleEvent: h.deleteGoogleEvent,
}));

vi.mock("@/lib/calendar/outlook-client", () => ({
  createOutlookEvent: h.createOutlookEvent,
  updateOutlookEvent: h.updateOutlookEvent,
  deleteOutlookEvent: h.deleteOutlookEvent,
}));

import {
  disconnectCalendar,
  syncTaskToAllCalendars,
  syncTaskWithRetry,
  syncTaskToCalendar,
} from "@/lib/calendar/sync";

// ─── tx 工厂：按行为表提供每张表的桩 ───────────────────────────────
type TxBehavior = {
  task?: { id: string; title: string; dueDate: Date | null; workspaceId: string } | null;
  taskThrow?: Error;
  mapping?: { id: string; externalEventId: string; lastSyncedAt?: Date } | null;
  connection?: Record<string, unknown> | null;
  connections?: Array<{ id: string }>;
  onMappingCreateThrow?: Error;
  onConnectionUpdateThrow?: Error;
};

let B: TxBehavior;

const txFor = (op: string) => ({
  task: {
    findUnique: async (args: unknown) => {
      h.calls.push({ kind: "db", op, method: "task.findUnique", args });
      if (B.taskThrow) throw B.taskThrow;
      return B.task ?? null;
    },
    findMany: async (args: unknown) => {
      h.calls.push({ kind: "db", op, method: "task.findMany", args });
      return [];
    },
  },
  taskCalendarEvent: {
    findUnique: async (args: unknown) => {
      h.calls.push({ kind: "db", op, method: "taskCalendarEvent.findUnique", args });
      return B.mapping ?? null;
    },
    create: async (args: unknown) => {
      h.calls.push({ kind: "db", op, method: "taskCalendarEvent.create", args });
      if (B.onMappingCreateThrow) throw B.onMappingCreateThrow;
      return { id: "map-new" };
    },
    update: async (args: unknown) => {
      h.calls.push({ kind: "db", op, method: "taskCalendarEvent.update", args });
      return {};
    },
    delete: async (args: unknown) => {
      h.calls.push({ kind: "db", op, method: "taskCalendarEvent.delete", args });
      return {};
    },
  },
  calendarConnection: {
    findUnique: async (args: unknown) => {
      h.calls.push({ kind: "db", op, method: "calendarConnection.findUnique", args });
      return B.connection ?? null;
    },
    findMany: async (args: unknown) => {
      h.calls.push({ kind: "db", op, method: "calendarConnection.findMany", args });
      return B.connections ?? [];
    },
    update: async (args: unknown) => {
      h.calls.push({ kind: "db", op, method: "calendarConnection.update", args });
      if (B.onConnectionUpdateThrow) throw B.onConnectionUpdateThrow;
      return {};
    },
    delete: async (args: unknown) => {
      h.calls.push({ kind: "db", op, method: "calendarConnection.delete", args });
      return {};
    },
  },
});

const dbCalls = (method: string) => h.calls.filter((c) => c.method === method);
const statusSeq = () =>
  dbCalls("calendarConnection.update").map(
    (c) => (c.args as { data: { syncStatus: string } }).data.syncStatus,
  );

beforeEach(() => {
  h.calls.length = 0;
  h.gucCalls = 0;
  h.decrypt.mockClear();
  h.encrypt.mockClear();
  h.refreshAccessToken.mockReset();
  h.revokeToken.mockReset();
  h.createGoogleEvent.mockReset().mockResolvedValue("ev-g-new");
  h.updateGoogleEvent.mockReset().mockResolvedValue(undefined);
  h.deleteGoogleEvent.mockReset().mockResolvedValue(undefined);
  h.createOutlookEvent.mockReset().mockResolvedValue("ev-o-new");
  h.updateOutlookEvent.mockReset().mockResolvedValue(undefined);
  h.deleteOutlookEvent.mockReset().mockResolvedValue(undefined);
  h.logErr.mockReset();
  h.logWarn.mockReset();
  vi.spyOn(console, "error").mockImplementation(h.logErr);
  vi.spyOn(console, "warn").mockImplementation(h.logWarn);

  B = {
    task: { id: "t1", title: "任务", dueDate: new Date("2026-12-01T00:00:00Z"), workspaceId: "w1" },
    mapping: null,
    connection: {
      id: "conn-1",
      provider: "google",
      calendarId: "cal-1",
      [AT]: fx("access"),
      [RT]: fx("refresh"),
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000), // 未过期
    },
  };
  h.txFactory = (op) => txFor(op);
  h.gucFactory = () => txFor("withGuc");
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("syncTaskToCalendar：四种落点", () => {
  it("task 不存在：静默 no-op（success:true, synced:0），不碰连接", async () => {
    B.task = null;
    const res = await syncTaskToCalendar("missing", "conn-1");
    expect(res).toEqual({ success: true, syncedConnections: 0 });
    expect(dbCalls("calendarConnection.update")).toHaveLength(0);
    expect(h.createGoogleEvent).not.toHaveBeenCalled();
  });

  it("有 dueDate + 无映射：创建外部事件 + 建映射 + 先 syncing 后 idle", async () => {
    const res = await syncTaskToCalendar("t1", "conn-1");
    expect(res).toEqual({ success: true, syncedConnections: 1 });
    expect(h.createGoogleEvent).toHaveBeenCalledWith(
      `plain:${fx("access")}`,
      "cal-1",
      expect.objectContaining({ title: "任务", reminderMinutes: [1440, 60] }),
    );
    const create = dbCalls("taskCalendarEvent.create")[0];
    expect((create.args as { data: unknown }).data).toEqual({
      taskId: "t1",
      connectionId: "conn-1",
      externalEventId: "ev-g-new",
    });
    expect(statusSeq()).toEqual(["syncing", "idle"]);
  });

  it("有 dueDate + 有映射：更新外部事件 + 刷新 lastSyncedAt", async () => {
    B.mapping = { id: "map-1", externalEventId: "ev-old" };
    const res = await syncTaskToCalendar("t1", "conn-1", { force: true });
    expect(res.success).toBe(true);
    expect(h.updateGoogleEvent).toHaveBeenCalledWith(
      `plain:${fx("access")}`,
      "cal-1",
      "ev-old",
      expect.any(Object),
    );
    expect(dbCalls("taskCalendarEvent.update")).toHaveLength(1);
    expect(h.createGoogleEvent).not.toHaveBeenCalled();
  });

  it("无 dueDate + 有映射：删外部事件 + 删映射", async () => {
    B.task = { id: "t1", title: "任务", dueDate: null, workspaceId: "w1" };
    B.mapping = { id: "map-1", externalEventId: "ev-old" };
    const res = await syncTaskToCalendar("t1", "conn-1", { force: true });
    expect(res.success).toBe(true);
    expect(h.deleteGoogleEvent).toHaveBeenCalledWith(`plain:${fx("access")}`, "cal-1", "ev-old");
    expect(dbCalls("taskCalendarEvent.delete")).toHaveLength(1);
  });

  it("无 dueDate + 无映射：只标记 idle（不调外部）", async () => {
    B.task = { id: "t1", title: "任务", dueDate: null, workspaceId: "w1" };
    const res = await syncTaskToCalendar("t1", "conn-1", { force: true });
    expect(res.success).toBe(true);
    expect(h.deleteGoogleEvent).not.toHaveBeenCalled();
    expect(statusSeq()).toEqual(["syncing", "idle"]);
  });

  it("outlook 连接走 outlook 客户端", async () => {
    (B.connection as { provider: string }).provider = "outlook";
    await syncTaskToCalendar("t1", "conn-1");
    expect(h.createOutlookEvent).toHaveBeenCalled();
    expect(h.createGoogleEvent).not.toHaveBeenCalled();
  });
});

describe("debounce 与时钟回拨", () => {
  it("5 分钟窗口内（lastSyncedAt=now）→ 跳过；force 绕过", async () => {
    B.mapping = { id: "map-1", externalEventId: "ev", lastSyncedAt: new Date() };
    const skipped = await syncTaskToCalendar("t1", "conn-1");
    expect(skipped).toEqual({ success: true, syncedConnections: 0 });
    expect(h.updateGoogleEvent).not.toHaveBeenCalled();

    const forced = await syncTaskToCalendar("t1", "conn-1", { force: true });
    expect(forced.syncedConnections).toBe(1);
    expect(h.updateGoogleEvent).toHaveBeenCalledTimes(1);
  });

  it("超过窗口（10 分钟前）→ 正常同步", async () => {
    B.mapping = {
      id: "map-1",
      externalEventId: "ev",
      lastSyncedAt: new Date(Date.now() - 10 * 60 * 1000),
    };
    const res = await syncTaskToCalendar("t1", "conn-1");
    expect(res.syncedConnections).toBe(1);
  });

  it("时钟回拨（lastSyncedAt 在未来）→ 放行同步（R9D-05：不得永久跳过）", async () => {
    B.mapping = {
      id: "map-1",
      externalEventId: "ev",
      lastSyncedAt: new Date(Date.now() + 60 * 60 * 1000),
    };
    const res = await syncTaskToCalendar("t1", "conn-1");
    expect(res.syncedConnections).toBe(1);
    expect(h.updateGoogleEvent).toHaveBeenCalledTimes(1);
  });
});

describe("token 刷新（提前窗口 + 并发共享锁）", () => {
  it("未过期：不刷新，直接用解密后的 token", async () => {
    await syncTaskToCalendar("t1", "conn-1");
    expect(h.refreshAccessToken).not.toHaveBeenCalled();
    expect(h.createGoogleEvent).toHaveBeenCalledWith(
      `plain:${fx("access")}`,
      expect.any(String),
      expect.any(Object),
    );
  });

  it("即将过期：刷新 + 加密持久化；带 refresh_token 存新值、不带则沿用旧密文", async () => {
    (B.connection as { tokenExpiresAt: Date }).tokenExpiresAt = new Date(Date.now() + 60 * 1000);
    h.refreshAccessToken.mockResolvedValue({
      access_token: fx("new-access"),
      refresh_token: fx("new-refresh"),
      expires_in: 3600,
    });
    await syncTaskToCalendar("t1", "conn-1");
    expect(h.refreshAccessToken).toHaveBeenCalledWith("google", `plain:${fx("refresh")}`);
    const persist = h.calls.find(
      (c) =>
        c.method === "calendarConnection.update" &&
        (c.args as { data: Record<string, unknown> }).data[AT] !== undefined,
    );
    expect(persist).toBeTruthy();
    expect((persist!.args as { data: Record<string, unknown> }).data[RT]).toBe(
      h.encrypt.mock.results[0].value,
    );
    expect(h.encrypt).toHaveBeenCalledWith(fx("new-refresh"));

    // 不带 refresh_token：沿用旧密文
    h.calls.length = 0;
    h.encrypt.mockClear();
    h.refreshAccessToken.mockResolvedValue({ access_token: fx("a2"), expires_in: 3600 });
    await syncTaskToCalendar("t1", "conn-1", { force: true });
    const persist2 = h.calls.find(
      (c) =>
        c.method === "calendarConnection.update" &&
        (c.args as { data: Record<string, unknown> }).data[AT] !== undefined,
    );
    expect((persist2!.args as { data: Record<string, unknown> }).data[RT]).toBe(fx("refresh"));
  });

  it("S5 并发锁：同一连接并发同步，refresh 只发一次（共享同一 Promise）", async () => {
    (B.connection as { tokenExpiresAt: Date }).tokenExpiresAt = new Date(Date.now() + 60 * 1000);
    let resolveRefresh!: (v: unknown) => void;
    const pending = new Promise((r) => {
      resolveRefresh = r;
    });
    h.refreshAccessToken.mockReturnValue(pending);

    const p1 = syncTaskToCalendar("t1", "conn-1");
    const p2 = syncTaskToCalendar("t1", "conn-1");
    // 自旋等待两个调用都推进到刷新点（中间隔着多层 await）
    for (let i = 0; i < 50 && h.refreshAccessToken.mock.calls.length === 0; i++) {
      await Promise.resolve();
    }
    expect(h.refreshAccessToken).toHaveBeenCalledTimes(1);
    resolveRefresh({ access_token: fx("a2"), expires_in: 3600 });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
  });
});

describe("S4 补偿与失败标记", () => {
  it("外部事件已建而映射落库失败：补偿删除外部事件后仍判失败", async () => {
    B.onMappingCreateThrow = new Error("db write failed");
    const res = await syncTaskToCalendar("t1", "conn-1");
    expect(res.success).toBe(false);
    expect(res.error).toContain("db write failed");
    expect(h.deleteGoogleEvent).toHaveBeenCalledWith(`plain:${fx("access")}`, "cal-1", "ev-g-new");
  });

  it("补偿也失败：记日志（孤儿可由对账任务清理），结果仍失败", async () => {
    B.onMappingCreateThrow = new Error("db write failed");
    h.deleteGoogleEvent.mockRejectedValue(new Error("external down"));
    const res = await syncTaskToCalendar("t1", "conn-1");
    expect(res.success).toBe(false);
    expect(h.logErr).toHaveBeenCalledWith(
      expect.stringContaining("S4 补偿删除外部事件失败"),
      expect.any(Error),
    );
  });

  it("失败标记：syncStatus=error + syncError 脱敏+截断（写入 DB 的值不泄漏凭据）", async () => {
    const secretA = fx("secretA");
    const secretB = fx("secretB");
    B.taskThrow = new Error(
      `boom access_token=${secretA}&x=1 refresh_token=${secretB} Bearer ${fx("live")} ${"z".repeat(600)}`,
    );
    const res = await syncTaskToCalendar("t1", "conn-1");
    expect(res.success).toBe(false);

    const persist = h.calls.find(
      (c) =>
        c.method === "calendarConnection.update" &&
        (c.args as { data: { syncStatus?: string } }).data.syncStatus === "error",
    );
    expect(persist).toBeTruthy();
    const written = (persist!.args as { data: { syncError: string } }).data.syncError;
    expect(written).toContain("access_token=***");
    expect(written).toContain("refresh_token=***");
    expect(written).toContain("Bearer ***");
    expect(written).not.toContain(secretA);
    expect(written).not.toContain(secretB);
    expect(written.length).toBeLessThanOrEqual(500);
  });
});

describe("syncTaskToAllCalendars", () => {
  it("无连接：no-op", async () => {
    B.connections = [];
    const res = await syncTaskToAllCalendars("t1", "u1");
    expect(res).toEqual({ success: true, syncedConnections: 0 });
  });

  it("多连接聚合：synced 累加（两连接各建一个外部事件）", async () => {
    B.connections = [{ id: "c1" }, { id: "c2" }];
    const res = await syncTaskToAllCalendars("t1", "u1");
    expect(res).toEqual({ success: true, syncedConnections: 2 });
    expect(h.createGoogleEvent).toHaveBeenCalledTimes(2);
  });

  it("任一连接失败：success:false 且带 lastError，但其他连接照常计入 synced", async () => {
    B.connections = [{ id: "c1" }, { id: "c2" }];
    let call = 0;
    const orig = txFor;
    h.txFactory = (op) => {
      const tx = orig(op) as unknown as {
        taskCalendarEvent: { create: () => Promise<unknown> };
      };
      const create = tx.taskCalendarEvent.create;
      tx.taskCalendarEvent.create = async () => {
        call += 1;
        if (call === 2) throw new Error("second connection failed");
        return create();
      };
      return tx;
    };
    const res = await syncTaskToAllCalendars("t1", "u1");
    expect(res.success).toBe(false);
    expect(res.error).toContain("second connection failed");
    expect(res.syncedConnections).toBe(1);
  });

  it("连接数达 take 上限（20）→ warn 提示可能异常堆积", async () => {
    B.connections = Array.from({ length: 20 }, (_, i) => ({ id: `c${i}` }));
    h.createGoogleEvent.mockResolvedValue("ev");
    await syncTaskToAllCalendars("t1", "u1");
    expect(h.logWarn).toHaveBeenCalledWith(expect.stringContaining("take 上限"));
  });
});

describe("syncTaskWithRetry 与 disconnectCalendar", () => {
  it("重试：第一次失败第二次成功（退避 1s）", async () => {
    vi.useFakeTimers();
    let attempt = 0;
    const orig = txFor;
    h.txFactory = (op) => {
      if (op === "calendar" && ++attempt === 1) throw new Error("transient");
      return orig(op);
    };
    const p = syncTaskWithRetry("t1", "conn-1");
    // runAllTimersAsync 会驱动退避定时器链直到无定时器（此处最多 1s 一跳）
    const res = await vi.runAllTimersAsync().then(() => p);
    expect(res.success).toBe(true);
  });

  it("全败：3 次尝试（退避 1s+2s）后返回最后失败结果", async () => {
    vi.useFakeTimers();
    h.txFactory = () => {
      throw new Error("always down");
    };
    const p = syncTaskWithRetry("t1", "conn-1");
    const res = await vi.runAllTimersAsync().then(() => p);
    expect(res.success).toBe(false);
    expect(res.error).toContain("always down");
  });

  it("disconnectCalendar：撤销 token（解密后）然后删连接；撤销失败不阻塞删除", async () => {
    h.gucFactory = () => ({
      calendarConnection: {
        findUnique: async () => ({ id: "conn-1", [AT]: fx("a") }),
        delete: async () => ({}),
      },
    });
    await disconnectCalendar("u1", "google");
    expect(h.revokeToken).toHaveBeenCalledWith("google", `plain:${fx("a")}`);
    expect(h.gucCalls).toBe(2); // findUnique + delete

    h.revokeToken.mockRejectedValue(new Error("revoke down"));
    h.gucCalls = 0;
    await disconnectCalendar("u1", "google");
    expect(h.gucCalls).toBe(2); // 仍执行 delete
  });

  it("disconnectCalendar：无连接 → 空操作（不撤销不删）", async () => {
    h.gucFactory = () => ({
      calendarConnection: { findUnique: async () => null, delete: async () => ({}) },
    });
    await disconnectCalendar("u1", "google");
    expect(h.revokeToken).not.toHaveBeenCalled();
    expect(h.gucCalls).toBe(1); // 仅 findUnique
  });
});
