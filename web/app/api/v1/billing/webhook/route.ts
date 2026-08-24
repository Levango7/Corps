import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { runWithAuthOp } from "@/lib/auth";
import { FREE_SEAT_LIMIT, requireStripe, STRIPE_WEBHOOK_SECRET } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";

function asString(v: string | { id: string } | null | undefined): string | undefined {
  if (!v) return undefined;
  return typeof v === "string" ? v : v.id;
}

export async function POST(req: NextRequest) {
  if (!STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json(
      { code: 500, message: "STRIPE_WEBHOOK_SECRET 未配置，webhook 拒绝接收" },
      { status: 500 },
    );
  }

  const rawBody = await req.text();
  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ code: 400, message: "Missing stripe-signature" }, { status: 400 });
  }

  let event;
  try {
    const stripe = requireStripe();
    event = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature";
    console.error("Webhook signature error:", message);
    return NextResponse.json({ code: 400, message: `Webhook Error: ${message}` }, { status: 400 });
  }

  // T2.7 Webhook 幂等：同一条 Stripe 事件不重复处理
  // INSERT ON CONFLICT DO NOTHING —— 若已处理过则 affected rows = 0，跳过后续逻辑
  const inserted = await prisma.processedStripeEvent.create({
    data: { id: event.id },
    select: { id: true },
  }).catch(() => null);
  if (!inserted) {
    // 已处理过（幂等命中），返回 200 让 Stripe 停止重试
    return NextResponse.json({ code: 200, data: { received: true, duplicate: true } });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object;
        // 仅处理订阅模式会话，其他模式（一次性支付等）不属于本产品计费流
        if (s.mode !== "subscription") break;
        const wid = s.metadata?.workspaceId;
        const customerId = asString(s.customer);
        const subId = asString(s.subscription);
        if (wid && customerId && subId) {
          await runWithAuthOp("webhook", async (tx) => {
            // metadata 可能被篡改或指向已删除的工作区：先确认存在再落库
            const workspace = await tx.workspace.findUnique({
              where: { id: wid },
              select: { id: true },
            });
            if (!workspace) {
              console.error(
                `[stripe-webhook] checkout.session.completed 指向不存在的工作区，已忽略: event=${event.id} wid=${wid}`,
              );
              return;
            }

            // 审计 F-11：从订阅项取真实购买席位数，闭环写回 seatLimit
            let quantity = 1;
            try {
              const full = await requireStripe().subscriptions.retrieve(subId);
              quantity = full.items?.data?.[0]?.quantity ?? 1;
            } catch (e) {
              console.error(`[stripe-webhook] 订阅详情拉取失败 event=${event.id}:`, e);
            }

            await tx.subscription.upsert({
              where: { workspaceId: wid },
              create: {
                workspaceId: wid,
                stripeCustomerId: customerId,
                stripeSubId: subId,
                status: "active",
                quantity,
              },
              update: {
                stripeCustomerId: customerId,
                stripeSubId: subId,
                status: "active",
                quantity,
              },
            });
            // plan 枚举与 schema CHECK / openapi 保持一致：付费即 pro；席位上限同步为购买数
            await tx.workspace.update({
              where: { id: wid },
              data: { plan: "pro", seatLimit: quantity },
            });
          });
        } else {
          console.error(
            `[stripe-webhook] checkout.session.completed 缺失关键 metadata，无法激活订阅: event=${event.id}`,
          );
        }
        break;
      }
      case "invoice.payment_failed": {
        // AC-09：扣款失败仅标记 past_due，不立即中断服务
        const inv = event.data.object as Stripe.Invoice & {
          subscription?: string | { id: string } | null;
        };
        const subId = asString(inv.subscription);
        if (subId) {
          await runWithAuthOp("webhook", (tx) =>
            tx.subscription.updateMany({
              where: { stripeSubId: subId },
              data: { status: "past_due" },
            }),
          );
        }
        break;
      }
      case "customer.subscription.updated": {
        const sub = event.data.object;
        const subId = asString(sub.id);
        if (subId) {
          // Stripe SDK v18+ 类型已移除 current_period_end，但 API 响应仍包含此字段
          const periodEnd = (
            sub as Stripe.Subscription & {
              current_period_end?: number;
            }
          ).current_period_end;
          await runWithAuthOp("webhook", async (tx) => {
            await tx.subscription.updateMany({
              where: { stripeSubId: subId },
              data: {
                status: sub.status ?? "active",
                quantity: sub.items?.data?.[0]?.quantity ?? 1,
                currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : undefined,
                canceledAt:
                  sub.status === "canceled" ? new Date() : undefined,
              },
            });
            // A-7: 订阅进入 canceled 状态时同步降级 workspace.plan 为 free，
            // 席位上限回落到 free 档（审计 F-11：计费口径闭环）
            if (sub.status === "canceled") {
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
              const newQty = sub.items?.data?.[0]?.quantity;
              if (typeof newQty === "number") {
                const subscription = await tx.subscription.findFirst({
                  where: { stripeSubId: subId },
                  select: { workspaceId: true },
                });
                if (subscription) {
                  await tx.workspace.update({
                    where: { id: subscription.workspaceId },
                    data: { seatLimit: newQty },
                  });
                }
              }
            }
          });
        }
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const subId = asString(sub.id);
        if (subId) {
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
              await tx.workspace.update({
                where: { id: subscription.workspaceId },
                data: { plan: "free" },
              });
            }
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
