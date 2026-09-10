import { NextRequest, NextResponse } from "next/server";
import { runWithAuthOpTx } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { trackServerEvent } from "@/lib/analytics-server";
import {
  getPaymentProvider,
  FREE_SEAT_LIMIT,
  PaymentProviderError,
  PaymentWebhookError,
} from "@/lib/payments";
import { apiMsg } from "@/lib/api-messages";

/**
 * POST /api/v1/billing/webhook — Stripe 回调（路径不变，D2）。
 *
 * 重构后分层（设计文档 §5.1）：
 *  - provider.parseWebhook：验签 + Stripe event → UnifiedBillingEvent 归一化（通道内）
 *  - 本路由：幂等占位（processed_payment_events 复合主键）+ 通道无关落库 + 4 埋点
 *
 * 行为保全清单（§5.6 红线）逐条冻结：
 *  1. 幂等命中返回 200 { received: true, duplicate: true }
 *  2. checkout.completed workspace 不存在 → console.error + 跳过
 *  3. updated canceled 回落 seatLimit，deleted 不回落（现状不对称，本次不顺手修）
 *  4. current_period_end 断言随迁入 parseWebhook
 *  5. 异常兜底 500 { message: "Handler error" }
 *  6. 非 subscription 模式 checkout session 忽略（parseWebhook 内）
 *
 * DL-1：幂等占位与业务处理合并到同一 Prisma 交互式事务，任一失败整体回滚，
 *  避免占位独立提交后业务失败、回滚占位又失败导致事件永久丢失。
 * DL-2：subscription 落库改为 findFirst + update by id，避免 updateMany 按
 *  stripeSubId 误更新多工作区行。
 */
export async function POST(req: NextRequest) {
  const provider = getPaymentProvider();

  let event;
  try {
    const rawBody = await req.text();
    const sig = req.headers.get("stripe-signature") ?? "";
    event = await provider.parseWebhook(rawBody, { "stripe-signature": sig });
  } catch (err) {
    // 验签失败 → 400（现状文案格式保持）
    if (err instanceof PaymentWebhookError) {
      console.error("Webhook signature error:", err.message);
      return NextResponse.json(
        { code: 400, message: `Webhook Error: ${err.message}` },
        { status: 400 },
      );
    }
    // not_configured → 500 拒收（现状 L13–18 语义）
    if (err instanceof PaymentProviderError && err.code === "not_configured") {
      console.error("Webhook not configured:", err.message);
      return NextResponse.json({ code: 500, message: "Webhook processing failed", data: null }, { status: 500 });
    }
    console.error("Webhook parse error:", err);
    return NextResponse.json({ code: 500, message: apiMsg(req, "handlerError") }, { status: 500 });
  }

  // 未知/忽略事件（非 subscription 模式、未知 type、缺失 metadata 等）→ 直接应答 received
  if (!event) {
    return NextResponse.json({ code: 200, data: { received: true } });
  }

  // 幂等占位 + 业务处理合并到同一事务（DL-1）。事务回滚时占位行自动回滚，
  // 无需手动 deleteMany，避免"占位保留 + 通道重试命中 duplicate → 事件永久丢失"。
  // 埋点上下文：事务内查出 workspaceId/props，事务提交后打点（埋点 best-effort，
  // trackServerEvent 内部 .catch 吞错，失败不影响应答）。null=不打该埋点。
  let duplicate = false;
  let activatedWid: string | null = null;
  let activatedProps: Record<string, unknown> = {};
  let paymentFailedWid: string | null = null;
  let paymentFailedProps: Record<string, unknown> = {};
  let renewedWid: string | null = null;
  let renewedProps: Record<string, unknown> = {};
  let canceledWid: string | null = null;
  let canceledProps: Record<string, unknown> = {};

  try {
    await prisma.$transaction(
      async (tx) => {
        // 幂等占位（事务内）：processed_payment_events (provider='stripe', event_id)
        // INSERT 冲突 → 已处理过，标记 duplicate 让 Stripe 停止重试
        const inserted = await tx.processedPaymentEvent
          .create({
            data: { provider: "stripe", eventId: event.providerEventId },
            select: { eventId: true },
          })
          .catch(() => null);
        if (!inserted) {
          duplicate = true;
          return;
        }

        switch (event.type) {
          case "checkout.completed": {
            const wid = event.workspaceId;
            // 到期时间按计费周期推算（初始值；随后由 customer.subscription.updated
            // 的 subscription.synced 用通道侧真实周期覆盖）
            const expiresAt =
              event.period === "yearly"
                ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
                : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
            await runWithAuthOpTx(tx, "webhook", async (tx2) => {
              // metadata 可能被篡改或指向已删除的工作区：先确认存在再落库
              const workspace = await tx2.workspace.findUnique({
                where: { id: wid },
                select: { id: true },
              });
              if (!workspace) {
                console.error(
                  `[stripe-webhook] checkout.session.completed 指向不存在的工作区，已忽略: event=${event.providerEventId} wid=${wid}`,
                );
                return;
              }
              await tx2.subscription.upsert({
                where: { workspaceId: wid },
                create: {
                  workspaceId: wid,
                  stripeCustomerId: event.providerCustomerId,
                  stripeSubId: event.providerOrderId,
                  provider: "stripe",
                  providerOrderId: event.providerOrderId,
                  status: "active",
                  quantity: event.seats,
                  currentPeriodEnd: expiresAt,
                },
                update: {
                  stripeCustomerId: event.providerCustomerId,
                  stripeSubId: event.providerOrderId,
                  provider: "stripe",
                  providerOrderId: event.providerOrderId,
                  status: "active",
                  quantity: event.seats,
                  currentPeriodEnd: expiresAt,
                },
              });
              // plan 枚举与 schema CHECK / openapi 保持一致：付费即 pro；席位上限同步为购买数
              await tx2.workspace.update({
                where: { id: wid },
                data: { plan: "pro", seatLimit: event.seats },
              });
            });
            // 埋点① subscription_activated（P0）：与原行为一致，workspace 不存在时仍打点
            activatedWid = wid;
            activatedProps = { plan: "pro", quantity: event.seats };
            break;
          }
          case "subscription.synced": {
            const subId = event.providerOrderId;
            await runWithAuthOpTx(tx, "webhook", async (tx2) => {
              // DL-2: 按 stripeSubId 唯一定位单行后 update by id，
              // 避免 updateMany 在异常多工作区关联时误更新
              const subscription = await tx2.subscription.findFirst({
                where: { stripeSubId: subId },
                select: { id: true, workspaceId: true },
              });
              if (!subscription) return;
              await tx2.subscription.update({
                where: { id: subscription.id },
                data: {
                  status: event.status,
                  quantity: event.quantity,
                  currentPeriodEnd: event.currentPeriodEnd,
                  canceledAt: event.status === "canceled" ? new Date() : undefined,
                },
              });
              // A-7: 订阅进入 canceled 状态时同步降级 workspace.plan 为 free，
              // 席位上限回落到 free 档（审计 F-11：计费口径闭环）
              if (event.status === "canceled") {
                await tx2.workspace.update({
                  where: { id: subscription.workspaceId },
                  data: { plan: "free", seatLimit: FREE_SEAT_LIMIT },
                });
              } else {
                // 审计 F-11：订阅变更（升降级/数量调整）时同步 seatLimit 为最新购买数
                await tx2.workspace.update({
                  where: { id: subscription.workspaceId },
                  data: { seatLimit: event.quantity },
                });
              }
            });
            // subscription.synced 无埋点
            break;
          }
          case "payment.failed": {
            const subId = event.providerOrderId;
            // AC-09：扣款失败仅标记 past_due，不立即中断服务
            await runWithAuthOpTx(tx, "webhook", async (tx2) => {
              // DL-2: 按 stripeSubId 唯一定位单行后 update by id
              // TC-RLS-07：subscriptions 表 FORCE RLS，经 webhook 逃生口读取
              const sub = await tx2.subscription.findFirst({
                where: { stripeSubId: subId },
                select: { id: true, workspaceId: true },
              });
              if (!sub) return;
              await tx2.subscription.update({
                where: { id: sub.id },
                data: { status: "past_due" },
              });
              // 埋点② payment_failed：经 providerOrderId 反查 workspaceId，查不到跳过
              paymentFailedWid = sub.workspaceId;
              paymentFailedProps = event.attempt !== undefined ? { attempt: event.attempt } : {};
            });
            break;
          }
          case "payment.succeeded": {
            // 续费成功（invoice.paid + billing_reason=subscription_cycle）：只打点不落库
            // quantity/currentPeriodEnd 已由 customer.subscription.updated 覆盖
            const subId = event.providerOrderId;
            // TC-RLS-07：subscriptions 表 FORCE RLS，经 webhook 逃生口反查 workspaceId
            await runWithAuthOpTx(tx, "webhook", async (tx2) => {
              const sub = await tx2.subscription.findFirst({
                where: { stripeSubId: subId },
                select: { workspaceId: true },
              });
              if (sub) {
                // 埋点③ subscription_renewed
                renewedWid = sub.workspaceId;
                renewedProps = {
                  quantity: event.quantity,
                  amountMinor: event.amountMinor,
                };
              }
            });
            break;
          }
          case "subscription.canceled": {
            const subId = event.providerOrderId;
            await runWithAuthOpTx(tx, "webhook", async (tx2) => {
              // A-7: 订阅删除/取消时，将 workspace.plan 降级为 free，
              // 并标记 subscription 为 canceled。先查 subscription 拿到 workspaceId。
              // DL-2: 按 stripeSubId 唯一定位单行后 update by id
              const subscription = await tx2.subscription.findFirst({
                where: { stripeSubId: subId },
                select: { id: true, workspaceId: true },
              });
              if (!subscription) return;
              await tx2.subscription.update({
                where: { id: subscription.id },
                data: { status: "canceled", canceledAt: new Date() },
              });
              // §5.6 第3条：deleted 分支只降 plan 不回落 seatLimit（现状不对称，本次不顺手修）
              await tx2.workspace.update({
                where: { id: subscription.workspaceId },
                data: { plan: "free" },
              });
              canceledWid = subscription.workspaceId;
              canceledProps = event.reason !== undefined ? { reason: event.reason } : {};
            });
            break;
          }
          default:
            break;
        }
      },
      { maxWait: 10_000, timeout: 20_000 },
    );
  } catch (err) {
    console.error("Webhook handler error:", err);
    // 事务已自动回滚（含幂等占位），无需手动 deleteMany（DL-1）
    return NextResponse.json({ code: 500, message: apiMsg(req, "handlerError") }, { status: 500 });
  }

  if (duplicate) {
    return NextResponse.json({ code: 200, data: { received: true, duplicate: true } });
  }

  // 埋点（事务提交后调用，userId=null §5.5；best-effort，trackServerEvent 内部吞错）
  if (activatedWid) {
    await trackServerEvent({
      userId: null,
      workspaceId: activatedWid,
      name: "subscription_activated",
      props: activatedProps,
    });
  }
  if (paymentFailedWid) {
    await trackServerEvent({
      userId: null,
      workspaceId: paymentFailedWid,
      name: "payment_failed",
      props: paymentFailedProps,
    });
  }
  if (renewedWid) {
    await trackServerEvent({
      userId: null,
      workspaceId: renewedWid,
      name: "subscription_renewed",
      props: renewedProps,
    });
  }
  if (canceledWid) {
    await trackServerEvent({
      userId: null,
      workspaceId: canceledWid,
      name: "subscription_churned",
      props: canceledProps,
    });
  }

  return NextResponse.json({ code: 200, data: { received: true } });
}
