// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

import { getBehaviorStats, getUserBehaviors, recordBehavior } from "@/lib/ai/behavior-tracker";

/**
 * 用户行为记录契约（lib/ai/behavior-tracker.ts）：
 *  - 三个函数都接受 tx（RLS 事务客户端）由调用方注入 —— 断言只对 tx 的调用形态负责
 *  - getUserBehaviors：默认 limit 100、上限 500（clamp）、capability/since 过滤、
 *    时间倒序
 *  - getBehaviorStats：按 capability 聚合四类 action；接受率/拒绝率只在 accept+reject
 *    分母上算（use/edit 不进分母）；total 降序；未知 action 进 totalBehaviors 不进任何分桶
 *  - recordBehavior：字段逐项落库（metadata 可缺省）
 *
 * tx 用最小 mock（直接断言传参），不走真实 Prisma。
 */
const h = vi.hoisted(() => ({
  create: vi.fn(),
  findMany: vi.fn(),
}));

const tx = {
  aiUserBehavior: { create: h.create, findMany: h.findMany },
} as never;

beforeEach(() => {
  h.create.mockReset();
  h.findMany.mockReset();
});

describe("recordBehavior", () => {
  it("字段逐项落库（含 metadata）", async () => {
    h.create.mockResolvedValue({});
    await recordBehavior(tx, "w1", "u1", "use_capability", "knowledge-qa", { suggestionId: "s1" });
    expect(h.create).toHaveBeenCalledWith({
      data: {
        workspaceId: "w1",
        userId: "u1",
        action: "use_capability",
        capability: "knowledge-qa",
        metadata: { suggestionId: "s1" },
      },
    });
  });

  it("metadata 缺省：原样传 undefined", async () => {
    h.create.mockResolvedValue({});
    await recordBehavior(tx, "w1", "u1", "edit_output", "task-breakdown");
    expect(h.create.mock.calls[0][0].data.metadata).toBeUndefined();
  });
});

describe("getUserBehaviors", () => {
  it("默认 limit=100、时间倒序、仅按 userId", async () => {
    h.findMany.mockResolvedValue([]);
    await getUserBehaviors(tx, "u1");
    expect(h.findMany).toHaveBeenCalledWith({
      where: { userId: "u1" },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  });

  it("limit clamp：<1 归 100，>500 归 500", async () => {
    h.findMany.mockResolvedValue([]);
    await getUserBehaviors(tx, "u1", { limit: 0 });
    expect(h.findMany.mock.calls[0][0].take).toBe(100);
    await getUserBehaviors(tx, "u1", { limit: 9999 });
    expect(h.findMany.mock.calls[1][0].take).toBe(500);
  });

  it("capability 与 since 进 where 过滤", async () => {
    h.findMany.mockResolvedValue([]);
    const since = new Date("2026-10-01T00:00:00.000Z");
    await getUserBehaviors(tx, "u1", { capability: "knowledge-qa", since, limit: 20 });
    expect(h.findMany).toHaveBeenCalledWith({
      where: { userId: "u1", capability: "knowledge-qa", createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
  });
});

describe("getBehaviorStats", () => {
  const b = (capability: string, action: string) => ({ capability, action });

  it("按 capability 聚合四类 action；接受率只在 accept+reject 分母上算；total 降序", async () => {
    h.findMany.mockResolvedValue([
      b("knowledge-qa", "use_capability"),
      b("knowledge-qa", "use_capability"),
      b("knowledge-qa", "accept_suggestion"),
      b("knowledge-qa", "reject_suggestion"),
      b("knowledge-qa", "edit_output"),
      b("task-breakdown", "accept_suggestion"),
      b("task-breakdown", "accept_suggestion"),
    ]);
    const stats = await getBehaviorStats(tx, "u1");

    expect(stats.totalBehaviors).toBe(7);
    expect(stats.totalCapabilities).toBe(2);
    // knowledge-qa total=5 > task-breakdown total=2
    const [kq, tb] = stats.capabilities;
    expect(kq).toEqual({
      capability: "knowledge-qa",
      total: 5,
      useCount: 2,
      acceptCount: 1,
      rejectCount: 1,
      editCount: 1,
      acceptRate: 0.5, // 1/(1+1)
      rejectRate: 0.5,
    });
    expect(tb.acceptRate).toBe(1); // 2/(2+0)
    expect(tb.rejectRate).toBe(0);
  });

  it("无 accept/reject：两率都为 0（分母为 0 不产生 NaN）", async () => {
    h.findMany.mockResolvedValue([b("docs", "use_capability"), b("docs", "edit_output")]);
    const stats = await getBehaviorStats(tx, "u1");
    expect(stats.capabilities[0].acceptRate).toBe(0);
    expect(stats.capabilities[0].rejectRate).toBe(0);
  });

  it("未知 action：计入 totalBehaviors 但不入任何分桶（该 capability total 可为 0 仍出现）", async () => {
    h.findMany.mockResolvedValue([
      b("weird", "some_new_action"), // 未知
      b("normal", "use_capability"),
    ]);
    const stats = await getBehaviorStats(tx, "u1");
    expect(stats.totalBehaviors).toBe(2);
    const weird = stats.capabilities.find((c) => c.capability === "weird")!;
    expect(weird.total).toBe(0);
    // 降序：normal(total=1) 在前
    expect(stats.capabilities[0].capability).toBe("normal");
  });

  it("查询形态：take 1000 + 仅 select capability/action（防内存膨胀）", async () => {
    h.findMany.mockResolvedValue([]);
    await getBehaviorStats(tx, "u1");
    expect(h.findMany).toHaveBeenCalledWith({
      where: { userId: "u1" },
      orderBy: { createdAt: "desc" },
      take: 1000,
      select: { capability: true, action: true },
    });
  });
});
