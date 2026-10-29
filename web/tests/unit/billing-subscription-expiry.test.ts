// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

/**
 * 国内一次性订阅到期懒降级（lib/billing/subscription-expiry.ts）契约。
 *
 * 触发条件四选一即跳过：无 active 订阅 / stripe 订阅（通道侧管生命周期，
 * 避免双源打架）/ 无 currentPeriodEnd / 尚未到期。
 * 满足条件：订阅标 canceled + 工作区降 free + 席位回落 FREE_SEAT_LIMIT。
 * 尽力而为：整体 try/catch，失败只记日志不阻断主流程。
 */

let currentSub: Record<string, unknown> | null;
let txCalls: string[];

const txMock = {
  subscription: {
    findFirst: vi.fn(async () => currentSub),
    update: vi.fn(async () => {
      txCalls.push("subscription.update");
      return undefined;
    }),
  },
  workspace: {
    update: vi.fn(async () => {
      txCalls.push("workspace.update");
      return undefined;
    }),
  },
};
const tx = txMock as unknown as Prisma.TransactionClient;

vi.mock("@/lib/auth", () => ({
  runWithAuthOp: vi.fn(
    async (_op: string, fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
      txCalls.push(`op:webhook`);
      return fn(tx);
    },
  ),
}));

vi.mock("@/lib/payments", () => ({
  FREE_SEAT_LIMIT: 3,
}));

import { expireSubscriptionIfDue } from "@/lib/billing/subscription-expiry";

beforeEach(() => {
  vi.clearAllMocks();
  currentSub = null;
  txCalls = [];
});

function sub(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub-1",
    provider: "alipay",
    status: "active",
    currentPeriodEnd: new Date(Date.now() - 86_400_000), // 昨天到期
    ...overrides,
  };
}

describe("expireSubscriptionIfDue —— 跳过条件", () => {
  it("无 active 订阅 → 不写任何表", async () => {
    currentSub = null;
    await expireSubscriptionIfDue("w-1");
    expect(txCalls).toEqual(["op:webhook"]);
  });

  it("Stripe 订阅 → 跳过（生命周期由通道 webhook 负责，避免双源打架）", async () => {
    currentSub = sub({ provider: "stripe" });
    await expireSubscriptionIfDue("w-1");
    expect(txCalls).toEqual(["op:webhook"]);
  });

  it("无 currentPeriodEnd（一次性付款未落库到期时间）→ 跳过", async () => {
    currentSub = sub({ currentPeriodEnd: null });
    await expireSubscriptionIfDue("w-1");
    expect(txCalls).toEqual(["op:webhook"]);
  });

  it("尚未到期 → 跳过", async () => {
    currentSub = sub({ currentPeriodEnd: new Date(Date.now() + 86_400_000) });
    await expireSubscriptionIfDue("w-1");
    expect(txCalls).toEqual(["op:webhook"]);
  });

  it("查询走 webhook 逃生口（非 owner 成员也能触发降级）", async () => {
    currentSub = null;
    const { runWithAuthOp } = await import("@/lib/auth");
    await expireSubscriptionIfDue("w-1");
    expect(runWithAuthOp).toHaveBeenCalledWith("webhook", expect.any(Function));
  });
});

describe("expireSubscriptionIfDue —— 到期降级", () => {
  it("国内通道到期：订阅 canceled + 工作区降 free + 席位回落 FREE_SEAT_LIMIT", async () => {
    currentSub = sub();
    await expireSubscriptionIfDue("w-1");
    expect(tx.subscription.update).toHaveBeenCalledWith({
      where: { id: "sub-1" },
      data: { status: "canceled", canceledAt: expect.any(Date) },
    });
    expect(tx.workspace.update).toHaveBeenCalledWith({
      where: { id: "w-1" },
      data: { plan: "free", seatLimit: 3 },
    });
    expect(txCalls).toEqual(["op:webhook", "subscription.update", "workspace.update"]);
  });

  it("微信通道同样降级（所有非 stripe 的国内一次性通道）", async () => {
    currentSub = sub({ provider: "wechat" });
    await expireSubscriptionIfDue("w-1");
    expect(tx.workspace.update).toHaveBeenCalled();
  });

  it("按 id 更新订阅（L27 修复：findFirst → update by id，不用 updateMany）", async () => {
    currentSub = sub({ id: "sub-42" });
    await expireSubscriptionIfDue("w-1");
    expect(tx.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "sub-42" } }),
    );
  });

  it("降级成功输出 warn 日志（含 wid 与到期时间，便于对账）", async () => {
    currentSub = sub();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expireSubscriptionIfDue("w-1");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain("w-1");
    warnSpy.mockRestore();
  });
});

describe("expireSubscriptionIfDue —— 失败不阻断", () => {
  it("tx 抛错 → catch 记 error 日志，函数 resolve（读路径惰性触发不阻断主流程）", async () => {
    txMock.subscription.findFirst.mockRejectedValueOnce(new Error("db unavailable"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(expireSubscriptionIfDue("w-1")).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(String(errSpy.mock.calls[0]?.[0])).toContain("subscription-expiry");
    errSpy.mockRestore();
  });
});
