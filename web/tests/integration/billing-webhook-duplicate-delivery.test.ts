import { describe, it, expect, beforeAll } from "vitest";

/**
 * 计费 webhook 幂等：同一 event 真投两次 → 真 DB（lib/billing/webhook-handler.ts）。
 *
 * 既有覆盖的缺口：
 *  - tests/unit/billing-webhook-handler.test.ts:571-600 的"P2002 → 200 duplicate"
 *    是 mock prisma 层：事务语义（DL-1 占位与业务同事务）、唯一键真实冲突路径、
 *    占位行落库后的真实计数，都没有被验证过。
 * 本文件用真实 PostgreSQL 走 handleBillingEvent（wechat/alipay 路由的共享处理器，
 * 与 Stripe route.ts 逐行等价）：
 *  1. 首投：200 { received: true }，幂等表/订阅/工作区权益真实落库；
 *  2. 重投：200 { received: true, duplicate: true }，业务表不重复、幂等表仅一条；
 *  3. 并发双投：Promise.all 同时投同一 eventId，恰好一投成功、一投 duplicate，
 *     业务表仍不重复（真实唯一键冲突，而非 mock P2002）。
 *
 * 为什么直接调 handleBillingEvent 而不是 HTTP POST /billing/webhook：
 *  - HTTP 路径需要真实 Stripe 签名 + STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET，
 *    CI 不注入（getPaymentProvider 直接 not_configured → 500），构造签名需要
 *    引入通道 SDK 与密钥，超出集成测试职责；
 *  - 幂等语义（复合主键占位 + 同事务落库）在 handler 层实现，通道验签在
 *    parseWebhook 层，已有 payments-webhook-signature.test.ts 单测覆盖；
 *  - 真 DB 幂等键 + 事务语义的集成价值恰恰在 handler 直调即可兑现。
 */

// 集成测试两套 CI 环境变量口径（同 ai-usage-quota-concurrent.test.ts）：
// 必须在首次 import "@/lib/prisma"（构造时解析连接串）之前落位。
const DB_URL = process.env.DATABASE_URL ?? process.env.RLS_SMOKE_OWNER_URL;
if (DB_URL && !process.env.DATABASE_URL) process.env.DATABASE_URL = DB_URL;
const describeDb = DB_URL ? describe : describe.skip;

import { registerUser } from "../helpers";
import type { UnifiedBillingEvent } from "@/lib/payments";

let wid: string;
let eventSeq = 0;

/** 构造唯一化的 checkout.completed 事件（seats=5，monthly）。 */
function checkoutEvent(
  workspaceId: string,
): Extract<UnifiedBillingEvent, { type: "checkout.completed" }> {
  eventSeq += 1;
  return {
    type: "checkout.completed",
    providerEventId: `evt_int_dup_${Date.now()}_${eventSeq}_${Math.floor(Math.random() * 1e6)}`,
    workspaceId,
    providerCustomerId: `cus_int_dup_${eventSeq}`,
    providerOrderId: `sub_int_dup_${eventSeq}`,
    seats: 5,
    period: "monthly",
  };
}

describeDb("billing webhook 幂等（真 DB，同一事件两次投递）", () => {
  beforeAll(async () => {
    // 幂等表/订阅/工作区落库都需要真实 workspace 行；走既有 HTTP 注册。
    const u = await registerUser({ prefix: "webhook-dup", workspaceName: "幂等重投工作区" });
    wid = u.workspace.id;
  });

  it("首投落库：幂等表 1 条、订阅 1 条、工作区升 pro 且席位=购买数", async () => {
    const { handleBillingEvent } = await import("@/lib/billing/webhook-handler");
    const { prisma } = await import("@/lib/prisma");

    const event = checkoutEvent(wid);
    const res = await handleBillingEvent(event, "stripe");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ code: 200, data: { received: true } });

    const [idem, subs, ws] = await Promise.all([
      prisma.processedPaymentEvent.count({
        where: { provider: "stripe", eventId: event.providerEventId },
      }),
      prisma.subscription.count({ where: { workspaceId: wid } }),
      prisma.workspace.findUnique({ where: { id: wid }, select: { plan: true, seatLimit: true } }),
    ]);
    expect(idem, "首投后幂等表必须有且仅一条占位").toBe(1);
    expect(subs, "首投后订阅表恰好一条").toBe(1);
    expect(ws?.plan, "付费即 pro（schema CHECK/openapi 同源口径）").toBe("pro");
    expect(ws?.seatLimit, "席位上限同步为购买数").toBe(5);
  });

  it("重投同一 eventId：200 duplicate，幂等表不增、订阅不重复、权益不漂移", async () => {
    const { handleBillingEvent } = await import("@/lib/billing/webhook-handler");
    const { prisma } = await import("@/lib/prisma");

    const event = checkoutEvent(wid);
    const first = await handleBillingEvent(event, "stripe");
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ code: 200, data: { received: true } });

    const again = await handleBillingEvent(event, "stripe");
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ code: 200, data: { received: true, duplicate: true } });

    const [idem, subs, subRows, ws] = await Promise.all([
      prisma.processedPaymentEvent.count({
        where: { provider: "stripe", eventId: event.providerEventId },
      }),
      prisma.subscription.count({ where: { workspaceId: wid } }),
      prisma.subscription.findMany({
        where: { workspaceId: wid },
        select: { providerOrderId: true, quantity: true, status: true },
      }),
      prisma.workspace.findUnique({ where: { id: wid }, select: { plan: true, seatLimit: true } }),
    ]);
    expect(idem, "重投不得新增幂等占位").toBe(1);
    expect(subs, "重投不得产生第二条订阅").toBe(1);
    expect(subRows[0]?.providerOrderId).toBe(event.providerOrderId);
    expect(subRows[0]?.status).toBe("active");
    expect(ws?.plan).toBe("pro");
    expect(ws?.seatLimit).toBe(5);
  });

  it("并发双投同一 eventId：恰好一投成功、一投 duplicate，业务表不重复", async () => {
    const { handleBillingEvent } = await import("@/lib/billing/webhook-handler");
    const { prisma } = await import("@/lib/prisma");

    const event = checkoutEvent(wid);
    const results = await Promise.all([
      handleBillingEvent(event, "stripe"),
      handleBillingEvent(event, "stripe"),
    ]);

    const bodies = await Promise.all(results.map((r) => r.json()));
    const fresh = bodies.filter((b) => (b.data as { duplicate?: boolean }).duplicate !== true);
    const dup = bodies.filter((b) => (b.data as { duplicate?: boolean }).duplicate === true);
    expect(
      results.every((r) => r.status === 200),
      "两投都必须是 200（通道重试语义）",
    ).toBe(true);
    expect(fresh.length, "唯一键竞争恰好一投拿到首次处理").toBe(1);
    expect(dup.length, "另一投必须命中幂等 duplicate").toBe(1);
    expect(fresh[0]).toEqual({ code: 200, data: { received: true } });
    expect(dup[0]).toEqual({ code: 200, data: { received: true, duplicate: true } });

    const [idem, subs] = await Promise.all([
      prisma.processedPaymentEvent.count({
        where: { provider: "stripe", eventId: event.providerEventId },
      }),
      prisma.subscription.count({ where: { workspaceId: wid } }),
    ]);
    expect(idem, "并发双投后幂等表有且仅一条").toBe(1);
    expect(subs, "并发双投后订阅有且仅一条").toBe(1);
  });
});
