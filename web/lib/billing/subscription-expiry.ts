import { runWithAuthOp } from "@/lib/auth";
import { FREE_SEAT_LIMIT } from "@/lib/payments";

/**
 * 国内一次性支付（支付宝/微信）的到期懒降级。
 *
 * 背景（审计 P1-6）：国内通道为一次付款模式，没有通道侧订阅对象持续回调续费状态，
 * "付费即终身 Pro"。本助手按 subscription.currentPeriodEnd（checkout.completed
 * 落库的到期时间）惰性判定：到期即降级为 free 并把席位回落到免费档。
 *
 * 调用时机：读路径（billing/status、成员邀请的席位门控）惰性触发，尽力而为、
 * 失败不阻断主流程。Stripe 订阅的到期由通道 webhook（subscription.synced
 * status=canceled → 降级）负责，此处显式跳过，避免双源打架。
 *
 * 权限：workspace/subscription 的写经 auth_op='webhook' 逃生口（与支付回调同
 * 信任级别，见 db/rls-activate.sql 与 ADR-006），因此发起者即使是非 owner
 * 成员也能完成降级。
 */
export async function expireSubscriptionIfDue(wid: string): Promise<void> {
  try {
    await runWithAuthOp("webhook", async (tx) => {
      const sub = await tx.subscription.findFirst({
        where: { workspaceId: wid, status: "active" },
        select: { provider: true, currentPeriodEnd: true },
      });
      // Stripe 有通道侧生命周期管理，不在此降级
      if (!sub || sub.provider === "stripe") return;
      if (!sub.currentPeriodEnd || sub.currentPeriodEnd.getTime() > Date.now()) return;

      await tx.subscription.updateMany({
        where: { workspaceId: wid, status: "active" },
        data: { status: "canceled", canceledAt: new Date() },
      });
      await tx.workspace.update({
        where: { id: wid },
        data: { plan: "free", seatLimit: FREE_SEAT_LIMIT },
      });
      console.warn(
        `[subscription-expiry] 国内订阅到期，已降级 wid=${wid} periodEnd=${sub.currentPeriodEnd.toISOString()}`,
      );
    });
  } catch (err) {
    console.error("[subscription-expiry] lazy downgrade failed (non-blocking):", err);
  }
}
