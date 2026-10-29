// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

/**
 * Pro 席位门控（lib/billing/seat-policy.ts）契约。
 *
 * 三分支口径（与定价页承诺对齐）：
 *  1. 成员数 < seatLimit → 不满，autoExpand=false（free/pro 通用）
 *  2. pro + Stripe 订阅 → 不拦截，autoExpand=true（加入后扩席 + 通道侧同步）
 *  3. pro + 国内一次性通道（或无订阅） → full=true 拦截
 * 另：expandProSeatsAfterJoin 是"尽力而为"——通道侧同步失败仅记日志，
 * 本地 seatLimit 口径必须已生效（R9D-08：结构化日志含 wid/provider 上下文）。
 */

const txMock = {
  subscription: {
    findUnique: vi.fn(),
  },
  member: { count: vi.fn() },
  workspace: { update: vi.fn() },
};
const tx = txMock as unknown as Prisma.TransactionClient;

let runWithWorkspaceImpl: (
  wid: string,
  fn: (tx: Prisma.TransactionClient) => Promise<unknown>,
) => Promise<unknown>;

vi.mock("@/lib/auth", () => ({
  runWithWorkspace: vi.fn(
    async (wid: string, fn: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
      runWithWorkspaceImpl(wid, fn),
  ),
}));

// 通道侧同步 spy 必须单例：实现里 getPaymentProvider("stripe").syncSubscription
// 拿到的对象要与测试里断言的是同一个 mock（不能每次 get 返回新对象）。
// vi.hoisted 与 vi.mock 同批提升，工厂执行时 spy 已就绪（普通 const 会 TDZ）。
const { syncSubscription, getPaymentProviderMock } = vi.hoisted(() => {
  const syncSubscription = vi.fn().mockResolvedValue(undefined);
  return {
    syncSubscription,
    getPaymentProviderMock: vi.fn(() => ({ syncSubscription })),
  };
});

vi.mock("@/lib/payments", () => ({
  getPaymentProvider: getPaymentProviderMock,
}));

import { evaluateSeatGate, expandProSeatsAfterJoin } from "@/lib/billing/seat-policy";
import { getPaymentProvider } from "@/lib/payments";

beforeEach(() => {
  vi.clearAllMocks();
  runWithWorkspaceImpl = async (
    _wid: string,
    fn: (tx: Prisma.TransactionClient) => Promise<unknown>,
  ) => fn(tx);
  txMock.member.count.mockResolvedValue(5);
  txMock.workspace.update.mockResolvedValue(undefined);
});

describe("evaluateSeatGate —— 未达上限", () => {
  it("memberCount < seatLimit → 不拦截、不自动扩席（free 与 pro 同样适用）", async () => {
    const r = await evaluateSeatGate(tx, "w-1", { plan: "free", seatLimit: 10 }, 3);
    expect(r).toEqual({ full: false, autoExpand: false, seatLimit: 10 });
    const r2 = await evaluateSeatGate(tx, "w-1", { plan: "pro", seatLimit: 10 }, 9);
    expect(r2).toEqual({ full: false, autoExpand: false, seatLimit: 10 });
  });

  it("未达上限时不查订阅（省一次查询）", async () => {
    await evaluateSeatGate(tx, "w-1", { plan: "pro", seatLimit: 10 }, 3);
    expect(tx.subscription.findUnique).not.toHaveBeenCalled();
  });
});

describe("evaluateSeatGate —— 达上限", () => {
  it("pro + Stripe 订阅 → 不拦截、autoExpand=true（成员规模不限承诺）", async () => {
    txMock.subscription.findUnique.mockResolvedValue({ provider: "stripe" });
    const r = await evaluateSeatGate(tx, "w-1", { plan: "pro", seatLimit: 5 }, 5);
    expect(r).toEqual({ full: false, autoExpand: true, seatLimit: 5 });
  });

  it("pro + 国内一次性通道（alipay/wechat）→ full=true 拦截", async () => {
    txMock.subscription.findUnique.mockResolvedValue({ provider: "alipay" });
    const r = await evaluateSeatGate(tx, "w-1", { plan: "pro", seatLimit: 5 }, 5);
    expect(r).toEqual({ full: true, plan: "pro", seatLimit: 5 });
  });

  it("pro + 无订阅记录 → full=true 拦截", async () => {
    txMock.subscription.findUnique.mockResolvedValue(null);
    const r = await evaluateSeatGate(tx, "w-1", { plan: "pro", seatLimit: 5 }, 5);
    expect(r.full).toBe(true);
  });

  it("free 计划达上限 → full=true 且不查订阅（free 无通道侧订阅对象）", async () => {
    const r = await evaluateSeatGate(tx, "w-1", { plan: "free", seatLimit: 5 }, 5);
    expect(r).toEqual({ full: true, plan: "free", seatLimit: 5 });
    expect(tx.subscription.findUnique).not.toHaveBeenCalled();
  });

  it("达上限时按 workspaceId 查订阅（select 仅 provider）", async () => {
    txMock.subscription.findUnique.mockResolvedValue({ provider: "stripe" });
    await evaluateSeatGate(tx, "w-99", { plan: "pro", seatLimit: 1 }, 1);
    expect(tx.subscription.findUnique).toHaveBeenCalledWith({
      where: { workspaceId: "w-99" },
      select: { provider: true },
    });
  });
});

describe("expandProSeatsAfterJoin", () => {
  it("seatLimit 同步为最新成员数（本地口径立即生效）", async () => {
    txMock.member.count.mockResolvedValue(6);
    txMock.subscription.findUnique.mockResolvedValue({ provider: "alipay", stripeSubId: null });
    await expandProSeatsAfterJoin("w-1");
    expect(tx.member.count).toHaveBeenCalledWith({ where: { workspaceId: "w-1" } });
    expect(tx.workspace.update).toHaveBeenCalledWith({
      where: { id: "w-1" },
      data: { seatLimit: 6 },
    });
  });

  it("pro + stripe + stripeSubId → 通道侧订阅 quantity 同步（按实际人数）", async () => {
    txMock.member.count.mockResolvedValue(7);
    txMock.subscription.findUnique.mockResolvedValue({
      provider: "stripe",
      stripeSubId: "sub_abc",
    });
    await expandProSeatsAfterJoin("w-1");
    expect(getPaymentProvider).toHaveBeenCalledWith("stripe");
    expect(syncSubscription).toHaveBeenCalledWith({ providerOrderId: "sub_abc", seats: 7 });
  });

  it("provider 非 stripe → 不触发通道侧同步（国内一次性通道无订阅对象）", async () => {
    txMock.subscription.findUnique.mockResolvedValue({ provider: "wechat", stripeSubId: null });
    await expandProSeatsAfterJoin("w-1");
    expect(getPaymentProvider).not.toHaveBeenCalled();
  });

  it("stripe 但无 stripeSubId → 不同步（缺通道侧订阅引用，不编造调用）", async () => {
    txMock.subscription.findUnique.mockResolvedValue({ provider: "stripe", stripeSubId: null });
    await expandProSeatsAfterJoin("w-1");
    expect(getPaymentProvider).not.toHaveBeenCalled();
  });

  it("R9D-08：通道侧同步抛错 → 不向上抛（本地席位口径已生效），且日志含 wid/provider 上下文", async () => {
    txMock.member.count.mockResolvedValue(8);
    txMock.subscription.findUnique.mockResolvedValue({ provider: "stripe", stripeSubId: "sub_x" });
    syncSubscription.mockRejectedValueOnce(new Error("stripe down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(expandProSeatsAfterJoin("w-1")).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalledTimes(1);
    const [msg] = errSpy.mock.calls[0] as [string];
    expect(msg).toContain("w-1");
    expect(msg).toContain("seat-policy");
    expect(msg).toContain("stripe");
    errSpy.mockRestore();
  });

  it("R9D-08：runWithWorkspace 本身抛错（outcome 未赋值）→ catch 中安全引用不炸", async () => {
    runWithWorkspaceImpl = async () => {
      throw new Error("db gone");
    };
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(expandProSeatsAfterJoin("w-1")).resolves.toBeUndefined();
    expect(errSpy.mock.calls[0]?.[0]).toContain("unknown");
    errSpy.mockRestore();
  });
});
