import { NextResponse } from "next/server";
import { runWithAuthOp } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { trackServerEvent } from "@/lib/analytics-server";
import { FREE_SEAT_LIMIT, ProviderId, UnifiedBillingEvent } from "@/lib/payments";

/**
 * 统一计费事件处理器（webhook 路由共享层）。
 *
 * 设计目的（ADR-003 §5 落地要点 3）：
 *  - 每通道独立子路径（/webhook、/webhook/wechat、/webhook/alipay）各自验签，
 *    验签后经此函数进入统一事件总线，避免 header 嗅探串扰。
 *  - 幂等占位（processed_payment_events 复合主键 provider+event_id）+ 通道无关落库 + 4 埋点。
 *
 * 行为保全清单（对齐 Stripe webhook/route.ts §5.6 红线）：
 *  1. 幂等命中返回 200 { received: true, duplicate: true }
 *  2. checkout.completed workspace 不存在 → console.error + 跳过
 *  3. updated canceled 回落 seatLimit，deleted 不回落
 *  4. 异常兜底 500 { message: "Handler error" }
 *
 * 注意：现有 Stripe webhook/route.ts 未改为调用本函数（增量扩展原则，
 * 不破坏已通过验收的 Stripe 路径）；新通道（wechat/alipay）路由使用本函数。
 * 逻辑与 Stripe 路由逐行等价，仅 providerId 参数化与 provider 字段写入不同。
 */

/**
 * 处理已验签的统一计费事件。
 *
 * @param event provider.parseWebhook 返回的归一化事件
 * @param providerId 通道标识（幂等表 provider 列 + subscription.provider 列）
 * @returns NextResponse（已构造好 HTTP 应答）
 */
export async function handleBillingEvent(
  event: UnifiedBillingEvent,
  providerId: ProviderId,
): Promise<NextResponse> {
  // 幂等占位：processed_payment_events (provider, event_id)
  // INSERT 冲突 → 已处理过，返回 200 { duplicate: true } 让通道停止重试
  const inserted = await prisma.processedPaymentEvent
    .create({
      data: { provider: providerId, eventId: event.providerEventId },
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
              `[${providerId}-webhook] checkout.completed 指向不存在的工作区，已忽略: event=${event.providerEventId} wid=${wid}`,
            );
            return;
          }
          await tx.subscription.upsert({
            where: { workspaceId: wid },
            create: {
              workspaceId: wid,
              stripeCustomerId: event.providerCustomerId,
              stripeSubId: event.providerOrderId,
              provider: providerId,
              providerOrderId: event.providerOrderId,
              status: "active",
              quantity: event.seats,
            },
            update: {
              stripeCustomerId: event.providerCustomerId,
              stripeSubId: event.providerOrderId,
              provider: providerId,
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
            where: { providerOrderId: subId },
            data: {
              status: event.status,
              quantity: event.quantity,
              currentPeriodEnd: event.currentPeriodEnd,
              canceledAt: event.status === "canceled" ? new Date() : undefined,
            },
          });
          // A-7: 订阅进入 canceled 状态时同步降级 workspace.plan 为 free
          if (event.status === "canceled") {
            const subscription = await tx.subscription.findFirst({
              where: { providerOrderId: subId },
              select: { workspaceId: true },
            });
            if (subscription) {
              await tx.workspace.update({
                where: { id: subscription.workspaceId },
                data: { plan: "free", seatLimit: FREE_SEAT_LIMIT },
              });
            }
          } else {
            // 审计 F-11：订阅变更时同步 seatLimit 为最新购买数
            const subscription = await tx.subscription.findFirst({
              where: { providerOrderId: subId },
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
            where: { providerOrderId: subId },
            data: { status: "past_due" },
          }),
        );
        // 埋点② payment_failed：经 providerOrderId 反查 workspaceId
        const sub = await runWithAuthOp("webhook", (tx) =>
          tx.subscription.findFirst({
            where: { providerOrderId: subId },
            select: { workspaceId: true },
          }),
        );
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
        // 续费成功：只打点不落库
        const subId = event.providerOrderId;
        const sub = await runWithAuthOp("webhook", (tx) =>
          tx.subscription.findFirst({
            where: { providerOrderId: subId },
            select: { workspaceId: true },
          }),
        );
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
          // A-7: 订阅删除/取消时，将 workspace.plan 降级为 free
          const subscription = await tx.subscription.findFirst({
            where: { providerOrderId: subId },
            select: { workspaceId: true },
          });
          await tx.subscription.updateMany({
            where: { providerOrderId: subId },
            data: { status: "canceled", canceledAt: new Date() },
          });
          if (subscription) {
            // §5.6 第3条：deleted 分支只降 plan 不回落 seatLimit
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
    console.error(`[${providerId}-webhook] handler error:`, err);
    return NextResponse.json({ code: 500, message: "Handler error" }, { status: 500 });
  }

  return NextResponse.json({ code: 200, data: { received: true } });
}