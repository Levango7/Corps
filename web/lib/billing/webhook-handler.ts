import { NextResponse } from "next/server";
import { runWithAuthOpTx } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { trackServerEvent } from "@/lib/analytics-server";
import { FREE_SEAT_LIMIT, ProviderId, UnifiedBillingEvent } from "@/lib/payments";
import { Prisma } from "@prisma/client";

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
 *
 * DL-1：幂等占位与业务处理合并到同一 Prisma 交互式事务，任一失败整体回滚。
 * DL-2：subscription 落库改为 findFirst + update by id，避免 updateMany 按
 *  providerOrderId 误更新多工作区行。
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
  // 幂等占位 + 业务处理合并到同一事务（DL-1）。事务回滚时占位行自动回滚，
  // 无需手动 deleteMany，避免"占位保留 + 通道重试命中 duplicate → 事件永久丢失"。
  // 埋点上下文：事务内查出 workspaceId/props，事务提交后打点（best-effort）。
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
        // 幂等占位（事务内）：processed_payment_events (provider, event_id)
        // INSERT 冲突 → 已处理过，标记 duplicate 让通道停止重试
        const inserted = await tx.processedPaymentEvent
          .create({
            data: { provider: providerId, eventId: event.providerEventId },
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
            // M12 修复：类型安全检查——workspaceId 必须为非空 string
            if (typeof wid !== "string" || wid.length === 0) {
              console.error(
                `[${providerId}-webhook] checkout.completed 缺少合法 workspaceId，已忽略: event=${event.providerEventId} wid=${wid}`,
              );
              return;
            }
            // 到期时间按计费周期推算：Stripe 随后由 subscription.synced 用通道侧
            // 真实周期覆盖；国内一次性支付则以本值作为到期依据（懒降级）。
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
                  `[${providerId}-webhook] checkout.completed 指向不存在的工作区，已忽略: event=${event.providerEventId} wid=${wid}`,
                );
                return;
              }
              await tx2.subscription.upsert({
                where: { workspaceId: wid },
                create: {
                  workspaceId: wid,
                  stripeCustomerId: event.providerCustomerId,
                  stripeSubId: event.providerOrderId,
                  provider: providerId,
                  providerOrderId: event.providerOrderId,
                  status: "active",
                  quantity: event.seats,
                  currentPeriodEnd: expiresAt,
                },
                update: {
                  stripeCustomerId: event.providerCustomerId,
                  stripeSubId: event.providerOrderId,
                  provider: providerId,
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
              // DL-2: 按 providerOrderId 唯一定位单行后 update by id，
              // 避免 updateMany 在异常多工作区关联时误更新
              const subscription = await tx2.subscription.findFirst({
                where: { providerOrderId: subId },
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
              // A-7: 订阅进入 canceled 状态时同步降级 workspace.plan 为 free
              if (event.status === "canceled") {
                await tx2.workspace.update({
                  where: { id: subscription.workspaceId },
                  data: { plan: "free", seatLimit: FREE_SEAT_LIMIT },
                });
              } else {
                // 审计 F-11：订阅变更时同步 seatLimit 为最新购买数
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
              // DL-2: 按 providerOrderId 唯一定位单行后 update by id
              const sub = await tx2.subscription.findFirst({
                where: { providerOrderId: subId },
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
            // 续费成功：只打点不落库
            const subId = event.providerOrderId;
            await runWithAuthOpTx(tx, "webhook", async (tx2) => {
              const sub = await tx2.subscription.findFirst({
                where: { providerOrderId: subId },
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
              // A-7: 订阅删除/取消时，将 workspace.plan 降级为 free
              // DL-2: 按 providerOrderId 唯一定位单行后 update by id
              const subscription = await tx2.subscription.findFirst({
                where: { providerOrderId: subId },
                select: { id: true, workspaceId: true },
              });
              if (!subscription) return;
              await tx2.subscription.update({
                where: { id: subscription.id },
                data: { status: "canceled", canceledAt: new Date() },
              });
              // §5.6 第3条：deleted 分支只降 plan 不回落 seatLimit
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
    // M11 修复：区分已知业务错误与未知编程错误，避免 catch 过宽掩盖 bug
    // 1. Prisma 已知请求错误（P2025 记录不存在、P2002 唯一约束等）→ 业务错误，正常处理
    // 2. TypeError/ReferenceError/SyntaxError → 编程错误，记录后重新抛出（fail-fast）
    // 3. 其他 → 未知错误，记录并返回 500
    if (
      err instanceof TypeError ||
      err instanceof ReferenceError ||
      err instanceof SyntaxError
    ) {
      console.error(`[${providerId}-webhook] 编程错误（重新抛出，不掩盖 bug）:`, err);
      throw err;
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      console.error(
        `[${providerId}-webhook] Prisma 已知错误 code=${err.code}:`,
        err.message,
      );
    } else {
      console.error(`[${providerId}-webhook] handler error:`, err);
    }
    // 事务已自动回滚（含幂等占位），无需手动 deleteMany（DL-1）
    return NextResponse.json({ code: 500, message: "Handler error" }, { status: 500 });
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
