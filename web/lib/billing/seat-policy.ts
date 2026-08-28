import type { Prisma } from "@prisma/client";
import { runWithWorkspace } from "@/lib/auth";

/**
 * Pro 席位门控策略（审计 P1-5 修复：与定价页承诺对齐）。
 *
 * 口径（docs/market/pricing-strategy.md / FAQ §4）：按"已购席位数"计费，
 * 成员加入自动扩席、退出自动缩席。按通道能力分策略：
 *  - free：达 seatLimit（默认 10）拦截 → 提示升级；
 *  - pro + Stripe：不拦截，加入后 seatLimit 跟随实际人数、通道侧 quantity
 *    自动同步（Stripe 按比例计费）——兑现"成员规模不限"承诺；
 *  - pro + 国内一次性通道（支付宝/微信）：无通道侧订阅对象可按比例扣费，
 *    席位在已购数内固定，达上限拦截 → 提示增购/续费。
 */

type Tx = Prisma.TransactionClient;

export type SeatGateResult =
  | { full: true; plan: string; seatLimit: number }
  | { full: false; autoExpand: boolean; seatLimit: number };

/**
 * 在席位保护事务内评估门控。workspace 为同事务内读出的工作区行（含 plan/seatLimit）。
 * 返回 full=false 时 autoExpand=true 表示创建成员后需调用 expandProSeatsAfterJoin。
 */
export async function evaluateSeatGate(
  tx: Tx,
  wid: string,
  workspace: { plan: string; seatLimit: number },
  memberCount: number,
): Promise<SeatGateResult> {
  if (memberCount < workspace.seatLimit) {
    return { full: false, autoExpand: false, seatLimit: workspace.seatLimit };
  }
  if (workspace.plan === "pro") {
    const sub = await tx.subscription.findUnique({
      where: { workspaceId: wid },
      select: { provider: true },
    });
    if (sub?.provider === "stripe") {
      return { full: false, autoExpand: true, seatLimit: workspace.seatLimit };
    }
  }
  return { full: true, plan: workspace.plan, seatLimit: workspace.seatLimit };
}

/**
 * 成员加入后（仅 Pro + Stripe 且门控判定 autoExpand 时调用）：
 * seatLimit 同步为最新人数，并把通道侧订阅 quantity 一起上调（下一账单按比例计费）。
 * 尽力而为：通道侧同步失败仅记日志，本地席位口径已生效。
 */
export async function expandProSeatsAfterJoin(wid: string): Promise<void> {
  try {
    const outcome = await runWithWorkspace(wid, async (tx) => {
      const count = await tx.member.count({ where: { workspaceId: wid } });
      await tx.workspace.update({ where: { id: wid }, data: { seatLimit: count } });
      const sub = await tx.subscription.findUnique({
        where: { workspaceId: wid },
        select: { provider: true, stripeSubId: true },
      });
      return { count, provider: sub?.provider ?? null, stripeSubId: sub?.stripeSubId ?? null };
    });
    if (outcome.provider === "stripe" && outcome.stripeSubId) {
      const { getPaymentProvider } = await import("@/lib/payments");
      await getPaymentProvider("stripe").syncSubscription({
        providerOrderId: outcome.stripeSubId,
        seats: outcome.count,
      });
    }
  } catch (err) {
    console.error("[seat-policy] expand pro seats failed (non-blocking):", err);
  }
}
