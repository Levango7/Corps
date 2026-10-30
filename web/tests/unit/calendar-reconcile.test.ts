// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * 日历对账任务契约（lib/calendar/reconcile.ts）：
 *  - 三阶段：① error 连接重置为 idle（清 syncError，允许重试）② 过期连接只告警不改状态
 *    ③ 孤儿事件映射清理（task 已删而映射残留）
 *  - 全部经 runWithAuthOp("calendar") 系统级逃生口（FORCE RLS 下裸查询读空）
 *  - 单条失败不炸整批：重置/清理单条异常只 warn，其余继续；整个任务异常也吞掉返回部分结果
 *  - 计数语义：scannedConnections 累计「阶段1+2 扫到的连接数」（孤儿映射不计数）
 */
const h = vi.hoisted(() => ({
  connectionFindMany: vi.fn(),
  connectionUpdate: vi.fn(),
  mappingFindMany: vi.fn(),
  taskFindMany: vi.fn(),
  mappingDelete: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  err: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  runWithAuthOp: vi.fn(async (_op: string, fn: (tx: unknown) => unknown) =>
    fn({
      calendarConnection: { findMany: h.connectionFindMany, update: h.connectionUpdate },
      taskCalendarEvent: { findMany: h.mappingFindMany, delete: h.mappingDelete },
      task: { findMany: h.taskFindMany },
    }),
  ),
}));

import { reconcileCalendarSync } from "@/lib/calendar/reconcile";

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
  h.connectionFindMany.mockResolvedValue([]);
  h.mappingFindMany.mockResolvedValue([]);
  h.taskFindMany.mockResolvedValue([]);
  vi.spyOn(console, "warn").mockImplementation(h.warn);
  vi.spyOn(console, "info").mockImplementation(h.info);
  vi.spyOn(console, "error").mockImplementation(h.err);
});

describe("阶段 1：错误连接重置", () => {
  it("error 连接 → update 为 idle + syncError:null，计数 resetErrorConnections", async () => {
    h.connectionFindMany
      .mockResolvedValueOnce([
        {
          id: "c1",
          provider: "google",
          userId: "u1",
          syncError: "token expired",
          updatedAt: new Date(),
        },
        { id: "c2", provider: "outlook", userId: "u2", syncError: null, updatedAt: new Date() },
      ])
      .mockResolvedValueOnce([]); // 阶段 2：无过期连接
    h.connectionUpdate.mockResolvedValue({});
    const res = await reconcileCalendarSync();
    expect(h.connectionUpdate).toHaveBeenCalledTimes(2);
    expect(h.connectionUpdate).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { syncStatus: "idle", syncError: null },
    });
    expect(res.resetErrorConnections).toBe(2);
    expect(res.scannedConnections).toBe(2);
  });

  it("单条 update 失败：只 warn 不中断，其余照常", async () => {
    h.connectionFindMany.mockResolvedValue([
      { id: "c1", provider: "google", userId: "u", syncError: "e", updatedAt: new Date() },
      { id: "c2", provider: "google", userId: "u", syncError: "e", updatedAt: new Date() },
    ]);
    h.connectionUpdate.mockRejectedValueOnce(new Error("db hiccup")).mockResolvedValueOnce({});
    const res = await reconcileCalendarSync();
    expect(res.resetErrorConnections).toBe(1);
    expect(h.warn).toHaveBeenCalledWith(
      expect.stringContaining("重置连接失败: connectionId=c1"),
      expect.any(Error),
    );
  });
});

describe("阶段 2：过期连接（只告警不改状态）", () => {
  it("stale 连接仅计数与告警，不调 update", async () => {
    h.connectionFindMany
      .mockResolvedValueOnce([]) // 阶段 1 无 error 连接
      .mockResolvedValueOnce([
        { id: "s1", provider: "google", userId: "u", lastSyncAt: null },
        { id: "s2", provider: "outlook", userId: "u", lastSyncAt: new Date(0) },
      ]);
    const res = await reconcileCalendarSync();
    expect(res.staleConnections).toBe(2);
    expect(res.scannedConnections).toBe(2);
    expect(h.connectionUpdate).not.toHaveBeenCalled(); // 不自动改状态（避免误触正在同步的连接）
    expect(h.warn).toHaveBeenCalledWith(expect.stringContaining("发现 2 个过期连接"));
  });

  it("过期查询条件：idle 且（lastSyncAt < 阈值 或 从未同步）", async () => {
    await reconcileCalendarSync();
    const staleQuery = h.connectionFindMany.mock.calls[1][0];
    expect(staleQuery.where.syncStatus).toBe("idle");
    expect(staleQuery.where.OR).toEqual([
      { lastSyncAt: { lt: expect.any(Date) } },
      { lastSyncAt: null },
    ]);
  });
});

describe("阶段 3：孤儿事件映射清理", () => {
  it("task 已不存在的映射 → delete，计数 orphanMappingsRemoved", async () => {
    h.mappingFindMany.mockResolvedValue([
      { id: "m1", taskId: "t1", connectionId: "c1", externalEventId: "e1" },
      { id: "m2", taskId: "t2", connectionId: "c1", externalEventId: "e2" },
    ]);
    h.taskFindMany.mockResolvedValue([{ id: "t1" }]); // t2 已删
    h.mappingDelete.mockResolvedValue({});
    const res = await reconcileCalendarSync();
    expect(h.mappingDelete).toHaveBeenCalledTimes(1);
    expect(h.mappingDelete).toHaveBeenCalledWith({ where: { id: "m2" } });
    expect(res.orphanMappingsRemoved).toBe(1);
    // 孤儿映射不计入 scannedConnections（连接口径）
    expect(res.scannedConnections).toBe(0);
  });

  it("批量查存在性：taskIds 去重后 IN 查询", async () => {
    h.mappingFindMany.mockResolvedValue([
      { id: "m1", taskId: "t1", connectionId: "c", externalEventId: "e" },
      { id: "m2", taskId: "t1", connectionId: "c", externalEventId: "e" },
    ]);
    h.taskFindMany.mockResolvedValue([{ id: "t1" }]);
    await reconcileCalendarSync();
    expect(h.taskFindMany).toHaveBeenCalledWith({
      where: { id: { in: ["t1"] } },
      select: { id: true },
    });
    expect(h.mappingDelete).not.toHaveBeenCalled();
  });

  it("单条清理失败：只 warn，其余继续", async () => {
    h.mappingFindMany.mockResolvedValue([
      { id: "m1", taskId: "gone1", connectionId: "c", externalEventId: "e" },
      { id: "m2", taskId: "gone2", connectionId: "c", externalEventId: "e" },
    ]);
    h.taskFindMany.mockResolvedValue([]);
    h.mappingDelete.mockRejectedValueOnce(new Error("fk")).mockResolvedValueOnce({});
    const res = await reconcileCalendarSync();
    expect(res.orphanMappingsRemoved).toBe(1);
    expect(h.warn).toHaveBeenCalledWith(
      expect.stringContaining("清理孤儿映射失败: mappingId=m1"),
      expect.any(Error),
    );
  });
});

describe("整体容错", () => {
  it("任一阶段抛错：吞掉并返回已完成的部分结果（对账任务不得炸调度器）", async () => {
    h.connectionFindMany.mockRejectedValue(new Error("db down"));
    const res = await reconcileCalendarSync();
    expect(res).toEqual({
      resetErrorConnections: 0,
      staleConnections: 0,
      orphanMappingsRemoved: 0,
      scannedConnections: 0,
    });
    expect(h.err).toHaveBeenCalledWith("[calendar-reconcile] 对账任务异常:", expect.any(Error));
  });

  it("完成后输出汇总日志（scanned/resetErrors/stale/orphanRemoved 四数）", async () => {
    await reconcileCalendarSync();
    expect(h.info).toHaveBeenCalledWith(
      expect.stringContaining("[calendar-reconcile] 对账完成: scanned=0"),
    );
  });
});
