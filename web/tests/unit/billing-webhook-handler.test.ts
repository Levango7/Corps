import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Prisma } from "@prisma/client";

import { FREE_SEAT_LIMIT } from "@/lib/payments";
import type { ProviderId, UnifiedBillingEvent } from "@/lib/payments";

/**
 * handleBillingEvent（lib/billing/webhook-handler.ts）单元测试。
 *
 * 覆盖什么：
 *  - 幂等占位（processed_payment_events 的 P2002 / 非 P2002 分流，DL-1 同事务落库）
 *  - 五类计费事件的落库与降级语义（checkout.completed / subscription.synced /
 *    payment.failed / payment.succeeded / subscription.canceled）
 *  - 事务提交后的 4 个埋点（subscription_activated / payment_failed /
 *    subscription_renewed / subscription_churned）
 *  - 错误分层：编程错误 fail-fast 重抛 vs 已知/未知错误兜底 500（M11）
 *
 * 不覆盖什么（以及为什么）：
 *  - 真实 SQL / RLS GUC / 事务原子性：需要数据库，属集成测试职责
 *    （subscriptions 表带 FORCE RLS，webhook 走 app.auth_op 逃生口，
 *     单测里 runWithAuthOpTx 被 mock 成直接执行回调）
 *  - 三通道验签与事件归一化：见 tests/unit/payments-webhook-signature.test.ts
 *  - Stripe webhook/route.ts 自己那份逐行等价实现：本文件只测共享处理器
 *    （route.ts 未改为调用本函数是已知现状，不顺手"修"）
 *
 * 为什么值得单测（而不是等集成测试）：
 *  这是全仓唯一同时写「资金状态（subscriptions）+ 租户权益（workspaces.plan/seatLimit）」
 *  的代码路径，且三个 webhook 路由共享它。这里任何一处回归都直接表现为
 *  「漏单 / 错误降级 / 事件被当成重复而永久丢弃」——而既有 882 条单测对该文件
 *  零覆盖，回归只能靠线上对账发现。
 *
 * Mock 策略：只 mock 四个叶子依赖（prisma / auth / analytics / payments），
 * 被测的 handleBillingEvent 走真实实现。$transaction 的 mock 把收到的 tx
 * 原样交给回调执行，并记录 maxWait/timeout 选项供断言。
 */

// ─── mock 装配（vi.hoisted：工厂函数被提升执行，引用必须先完成初始化） ───

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
}));

const authMock = vi.hoisted(() => ({
  runWithAuthOpTx: vi.fn(),
}));

const analyticsMock = vi.hoisted(() => ({
  trackServerEvent: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth", () => ({ runWithAuthOpTx: authMock.runWithAuthOpTx }));
vi.mock("@/lib/analytics-server", () => ({ trackServerEvent: analyticsMock.trackServerEvent }));
// FREE_SEAT_LIMIT 用**哨兵值 7**（生产真实值是 10）：
// 若用真实值 10，把实现里的 `seatLimit: FREE_SEAT_LIMIT` 改成硬编码 `seatLimit: 10`
// 这类变异将静默通过——mock 与实现拿到同一个常量，值相同即无差别。
// 哨兵值让"常量引用退化成硬编码"必然变红。常量本身的取值由 schema/文档约束，
// 不归本文件管。改这个值时必须保持 ≠ 10，理由同上。
vi.mock("@/lib/payments", () => ({ FREE_SEAT_LIMIT: 7 }));

const { handleBillingEvent } = await import("@/lib/billing/webhook-handler");

// ─── 测试夹具 ───

type CheckoutCompletedEvent = Extract<UnifiedBillingEvent, { type: "checkout.completed" }>;
type SubscriptionSyncedEvent = Extract<UnifiedBillingEvent, { type: "subscription.synced" }>;
type PaymentFailedEvent = Extract<UnifiedBillingEvent, { type: "payment.failed" }>;
type PaymentSucceededEvent = Extract<UnifiedBillingEvent, { type: "payment.succeeded" }>;
type SubscriptionCanceledEvent = Extract<UnifiedBillingEvent, { type: "subscription.canceled" }>;

function checkoutEvent(overrides: Partial<CheckoutCompletedEvent> = {}): CheckoutCompletedEvent {
  return {
    type: "checkout.completed",
    providerEventId: "evt_checkout_1",
    workspaceId: "ws_1",
    providerCustomerId: "cus_1",
    providerOrderId: "sub_1",
    seats: 3,
    period: "monthly",
    ...overrides,
  };
}

function syncedEvent(overrides: Partial<SubscriptionSyncedEvent> = {}): SubscriptionSyncedEvent {
  return {
    type: "subscription.synced",
    providerEventId: "evt_synced_1",
    providerOrderId: "sub_1",
    status: "active",
    quantity: 4,
    currentPeriodEnd: new Date("2027-06-01T00:00:00.000Z"),
    ...overrides,
  };
}

function paymentFailedEvent(overrides: Partial<PaymentFailedEvent> = {}): PaymentFailedEvent {
  return {
    type: "payment.failed",
    providerEventId: "evt_failed_1",
    providerOrderId: "sub_1",
    attempt: 2,
    ...overrides,
  };
}

function paymentSucceededEvent(
  overrides: Partial<PaymentSucceededEvent> = {},
): PaymentSucceededEvent {
  return {
    type: "payment.succeeded",
    providerEventId: "evt_succeeded_1",
    providerOrderId: "sub_1",
    quantity: 3,
    amountMinor: 2990,
    ...overrides,
  };
}

function canceledEvent(
  overrides: Partial<SubscriptionCanceledEvent> = {},
): SubscriptionCanceledEvent {
  return {
    type: "subscription.canceled",
    providerEventId: "evt_canceled_1",
    providerOrderId: "sub_1",
    reason: "customer_request",
    ...overrides,
  };
}

/** 每个用例一份全新的 tx mock，避免跨用例串话 */
function makeTx() {
  return {
    processedPaymentEvent: {
      // 幂等占位插入。默认成功；P2002 / 非 P2002 分支由各用例覆写
      create: vi.fn(async (): Promise<unknown> => ({ eventId: "evt_checkout_1" })),
    },
    workspace: {
      findUnique: vi.fn(async (): Promise<{ id: string } | null> => ({ id: "ws_1" })),
      update: vi.fn(async (): Promise<unknown> => ({ id: "ws_1" })),
    },
    subscription: {
      upsert: vi.fn(async (): Promise<unknown> => ({ id: "sub_1" })),
      findFirst: vi.fn(async (): Promise<{ id: string; workspaceId: string } | null> => ({
        id: "sub_1",
        workspaceId: "ws_1",
      })),
      update: vi.fn(async (): Promise<unknown> => ({ id: "sub_1" })),
    },
  };
}

/** 真实的 Prisma 已知请求错误（不 mock @prisma/client，用于 P2002/P2025 夹具） */
function prismaKnownError(code: "P2002" | "P2025", message: string) {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code,
    clientVersion: "7.0.0",
  });
}

/** 冻结时钟执行 fn：到期时间断言必须钉死"现在"，否则跨午夜/闰日边界会漂 */
async function withFrozenClock<T>(iso: string, fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
  try {
    return await fn();
  } finally {
    vi.useRealTimers();
  }
}

let tx: ReturnType<typeof makeTx>;
let txOptions: unknown;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tx = makeTx();
  txOptions = undefined;
  prismaMock.$transaction.mockReset();
  authMock.runWithAuthOpTx.mockReset();
  analyticsMock.trackServerEvent.mockReset();
  // $transaction mock：把回调收到的 tx 原样交给回调执行，并记录选项（断言 16）
  prismaMock.$transaction.mockImplementation(
    async (cb: (t: typeof tx) => Promise<unknown>, opts: unknown) => {
      txOptions = opts;
      return cb(tx);
    },
  );
  // runWithAuthOpTx mock：直接执行回调（真实实现是 SET LOCAL GUC 后执行，无返回值差异）
  authMock.runWithAuthOpTx.mockImplementation(
    async (txArg: typeof tx, _op: string, fn: (t: typeof tx) => Promise<unknown>) => fn(txArg),
  );
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

// ─── checkout.completed ───

describe("handleBillingEvent · checkout.completed", () => {
  it("月付激活：upsert create/update 全字段一致 + workspace 升 pro + 打 subscription_activated 点", async () => {
    // 防的回归：字段漏写（如忘写 providerOrderId → 后续 subscription.synced
    // 按 providerOrderId 反查不到行，升降级全部静默失效）或 plan 写错档位。
    // 用 toHaveBeenCalledWith 全量断言而非 objectContaining：多写/少写一个键都会红。
    const res = await handleBillingEvent(checkoutEvent(), "stripe");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ code: 200, data: { received: true } });

    expect(tx.subscription.upsert).toHaveBeenCalledWith({
      where: { workspaceId: "ws_1" },
      create: {
        workspaceId: "ws_1",
        stripeCustomerId: "cus_1",
        stripeSubId: "sub_1",
        provider: "stripe",
        providerOrderId: "sub_1",
        status: "active",
        quantity: 3,
        currentPeriodEnd: expect.any(Date),
      },
      update: {
        stripeCustomerId: "cus_1",
        stripeSubId: "sub_1",
        provider: "stripe",
        providerOrderId: "sub_1",
        status: "active",
        quantity: 3,
        currentPeriodEnd: expect.any(Date),
      },
    });
    expect(tx.workspace.update).toHaveBeenCalledWith({
      where: { id: "ws_1" },
      data: { plan: "pro", seatLimit: 3 },
    });
    expect(analyticsMock.trackServerEvent).toHaveBeenCalledWith({
      userId: null,
      workspaceId: "ws_1",
      name: "subscription_activated",
      props: { plan: "pro", quantity: 3 },
    });
  });

  it("年付：currentPeriodEnd 按日历年 +1（M-02：不是 +365 天）", async () => {
    // 防的回归：M-02 修的就是 `Date.now() + 365*24*3600*1000`。冻结在跨 2028-02-29
    // 的区间，日历年(+1) 与毫秒累加(+365d) 结果相差一天——用这个冻结点，两种实现
    // 不可能同时通过。选 3-15 而非月末：避开 1-31+1 月这类 JS 日期进位歧义。
    await withFrozenClock("2027-03-15T12:00:00.000Z", async () => {
      const now = new Date();
      const expected = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
      // 自证：冻结点必须落在"日历 ≠ 毫秒"区间，否则本用例对两种实现同时放行
      expect(expected.getTime()).not.toBe(now.getTime() + 365 * 24 * 60 * 60 * 1000);

      await handleBillingEvent(checkoutEvent({ period: "yearly" }), "stripe");

      expect(tx.subscription.upsert).toHaveBeenCalledWith({
        where: { workspaceId: "ws_1" },
        create: {
          workspaceId: "ws_1",
          stripeCustomerId: "cus_1",
          stripeSubId: "sub_1",
          provider: "stripe",
          providerOrderId: "sub_1",
          status: "active",
          quantity: 3,
          currentPeriodEnd: expected,
        },
        update: {
          stripeCustomerId: "cus_1",
          stripeSubId: "sub_1",
          provider: "stripe",
          providerOrderId: "sub_1",
          status: "active",
          quantity: 3,
          currentPeriodEnd: expected,
        },
      });
    });
  });

  it("月付：currentPeriodEnd 按日历月 +1（不是 +30 天）", async () => {
    // 防的回归：3-15 + 1 个日历月 = 4-15（31 天后），+30 天 = 4-14。
    // 若有人把实现"简化"回 30 天毫秒累加，本用例差一天即红。
    await withFrozenClock("2027-03-15T12:00:00.000Z", async () => {
      const now = new Date();
      const expected = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
      expect(expected.getTime()).not.toBe(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      await handleBillingEvent(checkoutEvent({ period: "monthly" }), "stripe");

      expect(tx.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ currentPeriodEnd: expected }),
          update: expect.objectContaining({ currentPeriodEnd: expected }),
        }),
      );
    });
  });

  it("workspaceId 为空字符串：不落库、console.error，且不打点（activatedWid 为 falsy）", async () => {
    // 防的回归：M12 类型检查被删 → 空 wid 直达 upsert，写出一条 workspaceId=""
    // 的孤儿订阅（外键/唯一约束取决于 schema，可能静默成功也可能炸事务）。
    // 按现状断言：实现里 activatedWid = "" 是 falsy，事务后的 `if (activatedWid)`
    // 不会打点——这是当前真实行为，钉死它，不为"直觉上该打点"而放宽。
    const res = await handleBillingEvent(checkoutEvent({ workspaceId: "" }), "stripe");

    expect(res.status).toBe(200);
    expect(tx.workspace.findUnique).not.toHaveBeenCalled();
    expect(tx.subscription.upsert).not.toHaveBeenCalled();
    expect(tx.workspace.update).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(analyticsMock.trackServerEvent).not.toHaveBeenCalled();
  });

  it("workspaceId 为非字符串（如数字 123）：不落库、console.error，且不打点", async () => {
    // 防的回归：typeof 检查被删 → 123 直达 Prisma where.id。
    // 关于打点的现状澄清（与任务描述的第 4 条不同，按实现钉死）：
    // 非法 wid 的 `return` 位于**事务回调层**（webhook-handler.ts L84），
    // 直接退出整个 $transaction 回调，L136 的 activatedWid 赋值永远不会执行，
    // 因此这里**不打点**。而"workspace 不存在仍打点"说的是另一条路径——
    // findUnique 返回 null 的 `return` 在 runWithAuthOpTx 内层回调（L105），
    // 只跳过落库，外层继续走到 L136，activatedWid 已设置，打点照常。
    // 两个用例（本条与下一条）把这个不对称钉死：将来任何人调整任一侧的
    // return 位置或提前量，都会先在这里红，而不是线上才发现埋点多少了一个。
    const event = checkoutEvent({ workspaceId: 123 as unknown as string });
    const res = await handleBillingEvent(event, "stripe");

    expect(res.status).toBe(200);
    expect(tx.workspace.findUnique).not.toHaveBeenCalled();
    expect(tx.subscription.upsert).not.toHaveBeenCalled();
    expect(tx.workspace.update).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(analyticsMock.trackServerEvent).not.toHaveBeenCalled();
  });

  it("workspace 不存在（findUnique 返回 null）：不落库、console.error，但仍打点", async () => {
    // 防的回归：存在性确认被删 → metadata 被篡改成任意 wid 也能"激活"，
    // 写出一条指向不存在工作区的订阅（资金状态与租户权益脱钩）。
    tx.workspace.findUnique.mockResolvedValue(null);

    const res = await handleBillingEvent(checkoutEvent({ workspaceId: "ws_missing" }), "stripe");

    expect(res.status).toBe(200);
    expect(tx.workspace.findUnique).toHaveBeenCalledWith({
      where: { id: "ws_missing" },
      select: { id: true },
    });
    expect(tx.subscription.upsert).not.toHaveBeenCalled();
    expect(tx.workspace.update).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(analyticsMock.trackServerEvent).toHaveBeenCalledWith({
      userId: null,
      workspaceId: "ws_missing",
      name: "subscription_activated",
      props: { plan: "pro", quantity: 3 },
    });
  });
});

// ─── subscription.synced ───

describe("handleBillingEvent · subscription.synced", () => {
  it("status=canceled：按 providerOrderId 定位后 update by id，workspace 降 free 并回落 seatLimit", async () => {
    // 防的回归（DL-2）：改回 updateMany 会按 providerOrderId 误更新多工作区行；
    // 漏写 seatLimit 回落 → 取消订阅后席位上限仍停在购买数，超配成员可继续进。
    const res = await handleBillingEvent(syncedEvent({ status: "canceled" }), "stripe");

    expect(res.status).toBe(200);
    expect(tx.subscription.findFirst).toHaveBeenCalledWith({
      where: { providerOrderId: "sub_1" },
      select: { id: true, workspaceId: true },
    });
    expect(tx.subscription.update).toHaveBeenCalledWith({
      where: { id: "sub_1" },
      data: {
        status: "canceled",
        quantity: 4,
        currentPeriodEnd: new Date("2027-06-01T00:00:00.000Z"),
        canceledAt: expect.any(Date),
      },
    });
    expect(tx.workspace.update).toHaveBeenCalledWith({
      where: { id: "ws_1" },
      data: { plan: "free", seatLimit: FREE_SEAT_LIMIT },
    });
    // synced 无埋点（文件头清单第 4 类之外不许多打）
    expect(analyticsMock.trackServerEvent).not.toHaveBeenCalled();
  });

  it("status=active：只同步 seatLimit，不写 canceledAt、不碰 plan", async () => {
    // 防的回归：① canceledAt 无条件写 → 活跃订阅被标记取消时间，对账/展示全错；
    // ② 把 plan 一起改成 free → 升降级把付费工作区误降级。
    const res = await handleBillingEvent(syncedEvent({ status: "active", quantity: 7 }), "stripe");

    expect(res.status).toBe(200);
    expect(tx.subscription.update).toHaveBeenCalledWith({
      where: { id: "sub_1" },
      data: {
        status: "active",
        quantity: 7,
        currentPeriodEnd: new Date("2027-06-01T00:00:00.000Z"),
        canceledAt: undefined,
      },
    });
    expect(tx.workspace.update).toHaveBeenCalledWith({
      where: { id: "ws_1" },
      data: { seatLimit: 7 },
    });
    expect(analyticsMock.trackServerEvent).not.toHaveBeenCalled();
  });

  it("findFirst 返回 null：不调用任何 update，静默返回且不打点", async () => {
    // 防的回归：subscription 行缺失时 update by id 会抛 P2025 把整个 webhook
    // 打成 500（通道无限重试）；静默跳过才是当前约定的容错语义。
    tx.subscription.findFirst.mockResolvedValue(null);

    const res = await handleBillingEvent(syncedEvent(), "stripe");

    expect(res.status).toBe(200);
    expect(tx.subscription.update).not.toHaveBeenCalled();
    expect(tx.workspace.update).not.toHaveBeenCalled();
    expect(analyticsMock.trackServerEvent).not.toHaveBeenCalled();
  });
});

// ─── payment.failed ───

describe("handleBillingEvent · payment.failed", () => {
  it("扣款失败：subscription 标记 past_due，打 payment_failed 点带 attempt", async () => {
    // 防的回归（AC-09）：把 past_due 写成 canceled → 一次扣款失败就中断服务；
    // attempt 漏传 → 催缴漏斗无法区分第几次重试。
    const res = await handleBillingEvent(paymentFailedEvent(), "stripe");

    expect(res.status).toBe(200);
    expect(tx.subscription.findFirst).toHaveBeenCalledWith({
      where: { providerOrderId: "sub_1" },
      select: { id: true, workspaceId: true },
    });
    expect(tx.subscription.update).toHaveBeenCalledWith({
      where: { id: "sub_1" },
      data: { status: "past_due" },
    });
    expect(analyticsMock.trackServerEvent).toHaveBeenCalledWith({
      userId: null,
      workspaceId: "ws_1",
      name: "payment_failed",
      props: { attempt: 2 },
    });
  });

  it("attempt 为 undefined：props 为 {}（不带 attempt 键）", async () => {
    // 防的回归：`event.attempt !== undefined ? {...} : {}` 的三元被改成无条件
    // `{ attempt: event.attempt }` → props 里出现 attempt: undefined，
    // 下游漏斗统计按"有值/无值"分流时会错桶。
    await handleBillingEvent(paymentFailedEvent({ attempt: undefined }), "stripe");

    expect(analyticsMock.trackServerEvent).toHaveBeenCalledWith({
      userId: null,
      workspaceId: "ws_1",
      name: "payment_failed",
      props: {},
    });
  });

  it("findFirst 返回 null：不 update、不打点", async () => {
    // 防的回归：查不到订阅也硬 update → P2025 炸事务，通道重试永动。
    tx.subscription.findFirst.mockResolvedValue(null);

    const res = await handleBillingEvent(paymentFailedEvent(), "stripe");

    expect(res.status).toBe(200);
    expect(tx.subscription.update).not.toHaveBeenCalled();
    expect(analyticsMock.trackServerEvent).not.toHaveBeenCalled();
  });
});

// ─── payment.succeeded ───

describe("handleBillingEvent · payment.succeeded", () => {
  it("续费成功：只打点不落库（无任何 subscription/workspace 写）", async () => {
    // 防的回归：续费事件被加成落库分支 → 与 customer.subscription.updated
    // 重复写 currentPeriodEnd，且把"只读"事件变成写路径，放大并发覆盖风险。
    const res = await handleBillingEvent(paymentSucceededEvent(), "stripe");

    expect(res.status).toBe(200);
    // findFirst 是允许的读（为了反查 workspaceId 打点）
    expect(tx.subscription.findFirst).toHaveBeenCalledWith({
      where: { providerOrderId: "sub_1" },
      select: { workspaceId: true },
    });
    // 但任何写都不允许
    expect(tx.subscription.update).not.toHaveBeenCalled();
    expect(tx.subscription.upsert).not.toHaveBeenCalled();
    expect(tx.workspace.update).not.toHaveBeenCalled();
    // 幂等占位仍必须插（事件级去重，与业务写无关）
    expect(tx.processedPaymentEvent.create).toHaveBeenCalled();
    expect(analyticsMock.trackServerEvent).toHaveBeenCalledWith({
      userId: null,
      workspaceId: "ws_1",
      name: "subscription_renewed",
      props: { quantity: 3, amountMinor: 2990 },
    });
  });

  it("订阅不存在（findFirst 返回 null）：不打点，静默 200", async () => {
    // 防的回归：查不到订阅时给 workspaceId 填占位值硬打点 → 续费漏斗混入
    // "归不到任何工作区"的脏样本，金额口径被污染；或反向性地直接空指针炸成
    // 500，让通道把一条本该幂等忽略的事件重试到天荒地老。
    // 刻意与 checkout.completed「workspace 不存在仍打点」保持**不对称**，别顺手对齐：
    // 那条 wid 直接来自 event.workspaceId（无需反查，wid 一定有效可见），
    // 这条全靠 findFirst 反查，查不到就无从归属——两处是不同的代码已知为何，
    // 强行一致反而会掩盖其中一侧的改动。
    tx.subscription.findFirst.mockResolvedValue(null);

    const res = await handleBillingEvent(paymentSucceededEvent(), "stripe");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ code: 200, data: { received: true } });
    expect(analyticsMock.trackServerEvent).not.toHaveBeenCalled();
  });
});

// ─── subscription.canceled ───

describe("handleBillingEvent · subscription.canceled", () => {
  it("订阅删除：subscription 记 canceled + canceledAt，workspace 只降 plan 不回落 seatLimit", async () => {
    // 防的回归（§5.6 第 3 条红线）：deleted 分支若"顺手"补上 seatLimit 回落，
    // 与 updated/canceled 分支的不对称现状被抹平 → 已购席位被静默砍到 10，
    // 付费用户掉成员。数据用 toEqual 全量断言：多一个 seatLimit 键即红。
    const res = await handleBillingEvent(canceledEvent(), "stripe");

    expect(res.status).toBe(200);
    expect(tx.subscription.findFirst).toHaveBeenCalledWith({
      where: { providerOrderId: "sub_1" },
      select: { id: true, workspaceId: true },
    });
    expect(tx.subscription.update).toHaveBeenCalledWith({
      where: { id: "sub_1" },
      data: { status: "canceled", canceledAt: expect.any(Date) },
    });
    expect(tx.workspace.update).toHaveBeenCalledWith({
      where: { id: "ws_1" },
      data: { plan: "free" },
    });
    expect(analyticsMock.trackServerEvent).toHaveBeenCalledWith({
      userId: null,
      workspaceId: "ws_1",
      name: "subscription_churned",
      props: { reason: "customer_request" },
    });
  });

  it("reason 为 undefined：props 为 {}（不带 reason 键）", async () => {
    // 防的回归：同上三元分支，无条件带 reason 会让"未知原因"与"用户主动取消"
    // 在流失漏斗里混为一谈。
    await handleBillingEvent(canceledEvent({ reason: undefined }), "stripe");

    expect(analyticsMock.trackServerEvent).toHaveBeenCalledWith({
      userId: null,
      workspaceId: "ws_1",
      name: "subscription_churned",
      props: {},
    });
  });
});

// ─── 幂等、事务选项、错误分层 ───

describe("handleBillingEvent · 幂等与错误分层", () => {
  it("幂等命中（P2002）：返回 200 duplicate，且不碰任何业务写、不打点", async () => {
    // 防的回归：L7 修复前 .catch(() => null) 把一切插入失败都当"已处理"，
    // 通道收到 200 后事件永久丢失。命中幂等时必须**止步**——任何业务写
    // 跑两次都是重复激活/重复埋点。
    tx.processedPaymentEvent.create.mockRejectedValue(
      prismaKnownError("P2002", "Unique constraint failed on processed_payment_events"),
    );

    const res = await handleBillingEvent(checkoutEvent(), "stripe");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ code: 200, data: { received: true, duplicate: true } });
    expect(tx.subscription.upsert).not.toHaveBeenCalled();
    expect(tx.workspace.update).not.toHaveBeenCalled();
    expect(tx.subscription.update).not.toHaveBeenCalled();
    expect(analyticsMock.trackServerEvent).not.toHaveBeenCalled();
  });

  it("占位插入抛非 P2002 的 TypeError：handleBillingEvent reject（fail-fast，不吞）", async () => {
    // 防的回归（M11）：catch 过宽把编程错误压成 500 → bug 被伪装成"通道故障"，
    // 永不上报。幂等插入路径同样适用：TypeError 必须穿透到调用方。
    tx.processedPaymentEvent.create.mockRejectedValue(
      new TypeError("Cannot read properties of null (reading 'code')"),
    );

    await expect(handleBillingEvent(checkoutEvent(), "stripe")).rejects.toThrow(TypeError);
  });

  it("占位插入抛非 P2002 的普通 Error：返回 500 Handler error（不得伪装成 duplicate 200）", async () => {
    // 防的回归：与上一条互补——普通错误（连接抖动等）走兜底 500，
    // 通道据此重试；若被误判成 duplicate 回 200，事件同样永久丢失。
    tx.processedPaymentEvent.create.mockRejectedValue(new Error("connection reset by peer"));

    const res = await handleBillingEvent(checkoutEvent(), "stripe");

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: 500, message: "Handler error", data: null });
  });

  it("业务逻辑抛 TypeError：reject（M11 编程错误不掩盖）", async () => {
    // 防的回归：把 catch 写成无条件 500 兜底。业务回调里的 TypeError 是代码 bug，
    // 必须炸出来，不能包装成"handler 错误"静默降级。
    tx.workspace.findUnique.mockRejectedValue(new TypeError("tx2.workspace is undefined"));

    await expect(handleBillingEvent(checkoutEvent(), "stripe")).rejects.toThrow(TypeError);
  });

  it("业务逻辑抛 ReferenceError：同样 reject（白名单不只是 TypeError）", async () => {
    // 防的回归：M11 白名单被"精简"成只认 TypeError。ReferenceError 通常是拼错的
    // 标识符 / 未定义变量——与 TypeError 同属代码缺陷，同样必须炸到调用方，
    // 而不是被兜底成 500 伪装成"通道故障"（那样 bug 永不上报）。
    // 之所以三类各写一个用例、不做参数化：实现是三个 instanceof 的或运算，
    // 删掉任一只让对应那条变红；合成一条的话报错只会说"白名单不全"，
    // 定位从"少了哪个类"退化成"某个类没了"。
    tx.subscription.upsert.mockRejectedValue(new ReferenceError("tx2 is not defined"));

    await expect(handleBillingEvent(checkoutEvent(), "stripe")).rejects.toThrow(ReferenceError);
  });

  it("业务逻辑抛 SyntaxError：同样 reject（三类编程错误全覆盖）", async () => {
    // 同上：白名单的第三个分支。这里是开销最小的哨兵——SyntaxError 在生产
    // 极少见，正因如此若有人把它从或运算里删掉，没有任何其它信号能发现，
    // 只有本用例会红。
    tx.subscription.upsert.mockRejectedValue(new SyntaxError("Unexpected token in JSON"));

    await expect(handleBillingEvent(checkoutEvent(), "stripe")).rejects.toThrow(SyntaxError);
  });

  it("业务逻辑抛 Prisma 已知错误（P2025）：返回 500 Handler error", async () => {
    // 防的回归：已知请求错误是业务性失败（记录不存在等），按约定记录并兜底 500，
    // 与编程错误分流——这条钉住"分流"本身不被改回一锅端。
    tx.workspace.findUnique.mockRejectedValue(
      prismaKnownError("P2025", "Record to update not found."),
    );

    const res = await handleBillingEvent(checkoutEvent(), "stripe");

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: 500, message: "Handler error", data: null });
  });

  it("业务逻辑抛普通 Error：同样返回 500 Handler error", async () => {
    // 防的回归：未知错误分支被漏写 → 异常穿透出路由变成 Next 默认 500 页面，
    // 响应体不符合 { code, message, data } 约定，通道对账解析失败。
    tx.subscription.upsert.mockRejectedValue(new Error("deadlock detected"));

    const res = await handleBillingEvent(checkoutEvent(), "stripe");

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: 500, message: "Handler error", data: null });
  });

  it("runWithAuthOpTx 每次都以 op='webhook' 调用，且收到外层同一个 tx", async () => {
    // 防的回归：op 写错成 "provision" → RLS 逃生口白名单不放行，
    // 生产上 subscriptions 表查询恒空（FORCE RLS 下无 GUC），webhook 全静默失效。
    // 单测里 mock 掉了真实 GUC 注入，只能钉住"传对了 op"这个契约。
    await handleBillingEvent(checkoutEvent(), "stripe");
    await handleBillingEvent(canceledEvent(), "stripe");

    expect(authMock.runWithAuthOpTx).toHaveBeenCalledTimes(2);
    for (const call of authMock.runWithAuthOpTx.mock.calls) {
      expect(call[1]).toBe("webhook");
      expect(call[0]).toBe(tx);
    }
  });

  it("$transaction 选项固定为 { maxWait: 10_000, timeout: 20_000 }", async () => {
    // 防的回归：数字被"调优"改小。maxWait 与连接池 pool_timeout 强耦合
    // （见 lib/prisma.ts 文件头注释），改小会在池饱和时把 webhook 变成
    // 无意义快失败——而失败意味着通道重试，重试意味着重复流量。
    await handleBillingEvent(checkoutEvent(), "stripe");

    expect(txOptions).toEqual({ maxWait: 10_000, timeout: 20_000 });
  });

  it("providerId 参数化：幂等表 provider 列与 subscription.provider 列随通道变化", async () => {
    // 防的回归：providerId 参数被忽略、硬编码 "stripe" → 微信/支付宝事件
    // 写入幂等表时 provider 列全是 stripe，跨通道 event_id 相同时互相误判重复。
    const providerIds: ProviderId[] = ["stripe", "wechatpay-native"];

    for (const providerId of providerIds) {
      tx.processedPaymentEvent.create.mockClear();
      tx.subscription.upsert.mockClear();
      await handleBillingEvent(checkoutEvent({ workspaceId: `ws_${providerId}` }), providerId);

      expect(tx.processedPaymentEvent.create).toHaveBeenCalledWith({
        data: { provider: providerId, eventId: "evt_checkout_1" },
        select: { eventId: true },
      });
      expect(tx.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ provider: providerId }),
          update: expect.objectContaining({ provider: providerId }),
        }),
      );
    }
  });

  it("未知事件类型：直接 200 received，不写库不打点（default 分支）", async () => {
    // 防的回归：default 分支被删 → 未知类型落进某个 case 或被当成错误，
    // 通道侧新事件类型会引发 500 重试风暴。
    const event = { type: "invoice.upcoming" } as unknown as UnifiedBillingEvent;

    const res = await handleBillingEvent(event, "stripe");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ code: 200, data: { received: true } });
    expect(tx.subscription.upsert).not.toHaveBeenCalled();
    expect(tx.workspace.update).not.toHaveBeenCalled();
    expect(analyticsMock.trackServerEvent).not.toHaveBeenCalled();
  });
});
