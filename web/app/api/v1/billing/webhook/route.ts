import { NextRequest, NextResponse } from "next/server";
import { runWithAuthOp } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { trackServerEvent } from "@/lib/analytics-server";
import {
  getPaymentProvider,
  FREE_SEAT_LIMIT,
  PaymentProviderError,
  PaymentWebhookError,
} from "@/lib/payments";

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
      return NextResponse.json({ code: 500, message: err.message }, { status: 500 });
    }
    console.error("Webhook parse error:", err);
    return NextResponse.json({ code: 500, message: "Handler error" }, { status: 500 });
  }

  // 未知/忽略事件（非 subscription 模式、未知 type、缺失 metadata 等）→ 直接应答 received
  if (!event) {
    return NextResponse.json({ code: 200, data: { received: true } });
  }

  // 幂等占位：processed_payment_events (provider='stripe', event_id)
  // INSERT 冲突 → 已处理过，返回 200 { duplicate: true } 让 Stripe 停止重试
  const inserted = await prisma.processedPaymentEvent
    .create({
      data: { provider: "stripe", eventId: event.providerEventId },
      select: { eventId: true },
    })
    .catch(() => null);
  if (!inserted) {
    return NextResponse.json({ code: 200, data: { received: true, duplicate: true } });
  }

  try {
    switch (event.type) {
      case "checkout.completed": {
        const wid = event.workspaceId;
        await runWithAuthOp("webhook", async (tx) => {
          // metadata 可能被篡改或指向已删除的工作区：先确认存在再落库
          const workspace = await tx.workspace.findUnique({
            where: { id: wid },
            select: { id: true },
          });
          if (!workspace) {
            console.error(
              `[stripe-webhook] checkout.session.completed 指向不存在的工作区，已忽略: event=${event.providerEventId} wid=${wid}`,
            );
            return;
          }
          await tx.subscription.upsert({
            where: { workspaceId: wid },
            create: {
              workspaceId: wid,
              stripeCustomerId: event.providerCustomerId,
              stripeSubId: event.providerOrderId,
              provider: "stripe",
              providerOrderId: event.providerOrderId,
              status: "active",
              quantity: event.seats,
            },
            update: {
              stripeCustomerId: event.providerCustomerId,
              stripeSubId: event.providerOrderId,
              provider: "stripe",
              providerOrderId: event.providerOrderId,
              status: "active",
              quantity: event.seats,
            },
          });
          // plan 枚举与 schema CHECK / openapi 保持一致：付费即 pro；席位上限同步为购买数
          await tx.workspace.update({
            where: { id: wid },
            data: { plan: "pro", seatLimit: event.seats },
          });
        });
        // 埋点① subscription_activated（P0）：主事务提交后调用，userId=null（§5.5）
        await trackServerEvent({
          userId: null,
          workspaceId: wid,
          name: "subscription_activated",
          props: { plan: "pro", quantity: event.seats },
        });
        break;
      }
      case "subscription.synced": {
        const subId = event.providerOrderId;
        await runWithAuthOp("webhook", async (tx) => {
          await tx.subscription.updateMany({
            where: { stripeSubId: subId },
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
            const subscription = await tx.subscription.findFirst({
              where: { stripeSubId: subId },
              select: { workspaceId: true },
            });
            if (subscription) {
              await tx.workspace.update({
                where: { id: subscription.workspaceId },
                data: { plan: "free", seatLimit: FREE_SEAT_LIMIT },
              });
            }
          } else {
            // 审计 F-11：订阅变更（升降级/数量调整）时同步 seatLimit 为最新购买数
            const subscription = await tx.subscription.findFirst({
              where: { stripeSubId: subId },
              select: { workspaceId: true },
            });
            if (subscription) {
              await tx.workspace.update({
                where: { id: subscription.workspaceId },
                data: { seatLimit: event.quantity },
              });
            }
          }
        });
        // subscription.synced 无埋点
        break;
      }
      case "payment.failed": {
        const subId = event.providerOrderId;
        // AC-09：扣款失败仅标记 past_due，不立即中断服务
        await runWithAuthOp("webhook", (tx) =>
          tx.subscription.updateMany({
            where: { stripeSubId: subId },
            data: { status: "past_due" },
          }),
        );
        // 埋点② payment_failed：经 providerOrderId 反查 workspaceId，查不到跳过
        const sub = await prisma.subscription.findFirst({
          where: { stripeSubId: subId },
          select: { workspaceId: true },
        });
        if (sub) {
          await trackServerEvent({
            userId: null,
            workspaceId: sub.workspaceId,
            name: "payment_failed",
            props: event.attempt !== undefined ? { attempt: event.attempt } : {},
          });
        }
        break;
      }
      case "payment.succeeded": {
        // 续费成功（invoice.paid + billing_reason=subscription_cycle）：只打点不落库
        // quantity/currentPeriodEnd 已由 customer.subscription.updated 覆盖
        const subId = event.providerOrderId;
        const sub = await prisma.subscription.findFirst({
          where: { stripeSubId: subId },
          select: { workspaceId: true },
        });
        if (sub) {
          // 埋点③ subscription_renewed
          await trackServerEvent({
            userId: null,
            workspaceId: sub.workspaceId,
            name: "subscription_renewed",
            props: {
              quantity: event.quantity,
              amountMinor: event.amountMinor,
            },
          });
        }
        break;
      }
      case "subscription.canceled": {
        const subId = event.providerOrderId;
        let canceledWorkspaceId: string | null = null;
        await runWithAuthOp("webhook", async (tx) => {
          // A-7: 订阅删除/取消时，将 workspace.plan 降级为 free，
          // 并标记 subscription 为 canceled。先查 subscription 拿到 workspaceId。
          const subscription = await tx.subscription.findFirst({
            where: { stripeSubId: subId },
            select: { workspaceId: true },
          });
          await tx.subscription.updateMany({
            where: { stripeSubId: subId },
            data: { status: "canceled", canceledAt: new Date() },
          });
          if (subscription) {
            // §5.6 第3条：deleted 分支只降 plan 不回落 seatLimit（现状不对称，本次不顺手修）
            await tx.workspace.update({
              where: { id: subscription.workspaceId },
              data: { plan: "free" },
            });
            canceledWorkspaceId = subscription.workspaceId;
          }
        });
        // 埋点④ subscription_churned
        if (canceledWorkspaceId) {
          await trackServerEvent({
            userId: null,
            workspaceId: canceledWorkspaceId,
            name: "subscription_churned",
            props: event.reason !== undefined ? { reason: event.reason } : {},
          });
        }
        break;
      }
      default:
        break;
    }
  } catch (err) {
    console.error("Webhook handler error:", err);
    return NextResponse.json({ code: 500, message: "Handler error" }, { status: 500 });
  }

  return NextResponse.json({ code: 200, data: { received: true } });
}
