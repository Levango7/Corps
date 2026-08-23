import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { runWithAuthOp } from "@/lib/auth";
import { requireStripe, STRIPE_WEBHOOK_SECRET } from "@/lib/stripe";

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
            if (!workspace) return;

            await tx.subscription.upsert({
              where: { workspaceId: wid },
              create: {
                workspaceId: wid,
                stripeCustomerId: customerId,
                stripeSubId: subId,
                status: "active",
                quantity: 1,
              },
              update: { stripeCustomerId: customerId, stripeSubId: subId, status: "active" },
            });
            // plan 枚举与 schema CHECK / openapi 保持一致：付费即 pro
            await tx.workspace.update({ where: { id: wid }, data: { plan: "pro" } });
          });
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
          await runWithAuthOp("webhook", (tx) =>
            tx.subscription.updateMany({
              where: { stripeSubId: subId },
              data: {
                status: sub.status ?? "active",
                quantity: sub.items?.data?.[0]?.quantity ?? 1,
                currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : undefined,
              },
            }),
          );
        }
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const subId = asString(sub.id);
        if (subId) {
          await runWithAuthOp("webhook", (tx) =>
            tx.subscription.updateMany({
              where: { stripeSubId: subId },
              data: { status: "canceled", canceledAt: new Date() },
            }),
          );
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
