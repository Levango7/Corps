"use client";

/**
 * PricingSection —— 定价卡⑤区块（计费周期切换器 + Free/Pro 双卡）。
 *
 * 设计：
 *  - 本页唯一有状态的客户端区块：周期 state + select_billing_period 埋点。
 *  - 默认年付选中（spec §3.5「默认选中年付」，呼应 ADR-003 年付优先策略）。
 *  - 切换器 onChange 时 track("select_billing_period", { period })。
 *  - Pro 卡按钮 / Free 卡按钮均通过 TrackedCta 上报 click_upgrade（source="card"）。
 *
 * 关联：
 *  - docs/design/pricing-page-impl-design.md §3.2/§5.3
 *  - docs/market/pricing-page-spec.md §3.5/§8
 */

import { useState } from "react";
import { Check } from "lucide-react";
import {
  PRICING_PLANS,
  YEARLY_MONTHLY_AVERAGE,
  YEARLY_SAVING_PER_SEAT,
  type BillingPeriod,
} from "@/lib/pricing";
import { track } from "@/lib/analytics";
import { TrackedCta } from "./TrackedCta";

/** 切换器分段控件选项。 */
const PERIOD_OPTIONS: { value: BillingPeriod; label: string }[] = [
  { value: "monthly", label: "按月付 ¥59/人" },
  { value: "yearly", label: `按年付 ¥${YEARLY_MONTHLY_AVERAGE.toFixed(1)}/人（省 2 个月）` },
];

/** CTA 目标基础 URL（spec §1，已适配为 /auth/signup?src=pricing）。 */
const SIGNUP_BASE = "/auth/signup?src=pricing";

/**
 * 定价卡区块。受控周期 state，默认年付。
 */
export function PricingSection() {
  // 默认年付（spec §3.5）
  const [period, setPeriod] = useState<BillingPeriod>("yearly");

  /** 切换周期并上报 select_billing_period。 */
  function handlePeriodChange(next: BillingPeriod) {
    if (next === period) return;
    setPeriod(next);
    // fire-and-forget
    track("select_billing_period", { period: next });
  }

  // Pro 当前周期价格
  const proPrice =
    period === "monthly" ? PRICING_PLANS.pro.monthlyPrice : PRICING_PLANS.pro.yearlyPrice;
  const proUnit = period === "monthly" ? "/人/月" : "/人/年";

  return (
    <section
      id="plans"
      className="px-[var(--space-8)] md:px-[var(--space-6)] py-[var(--space-20)]"
      aria-labelledby="plans-heading"
    >
      <div className="mx-auto max-w-[var(--container-max)]">
        <h2
          id="plans-heading"
          className="text-[length:var(--text-2xl)] font-[var(--weight-semibold)] text-[var(--fg)] text-center"
        >
          选择适合团队的方案
        </h2>

        {/* 切换器（分段控件） */}
        <div
          className="mt-6 inline-flex p-1 rounded-[var(--radius-pill)] border border-[var(--border)] bg-[var(--surface-2)]"
          role="group"
          aria-label="计费周期切换"
        >
          {PERIOD_OPTIONS.map((opt) => {
            const pressed = opt.value === period;
            return (
              <button
                key={opt.value}
                type="button"
                aria-pressed={pressed}
                onClick={() => handlePeriodChange(opt.value)}
                className={
                  "px-4 h-9 rounded-[var(--radius-pill)] text-[length:var(--text-sm)] font-[var(--weight-medium)] " +
                  "transition-colors duration-[var(--motion-base)] ease-[var(--ease-standard)] " +
                  "focus-visible:outline-none focus-visible:ring-[var(--focus-ring)] " +
                  (pressed
                    ? "bg-[var(--accent-soft)] text-[var(--accent-soft-fg)]"
                    : "text-[var(--muted)] hover:text-[var(--fg-2)]")
                }
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {/* 双卡布局 */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
          {/* Free 卡（移动端 order-2，桌面 order-1） */}
          <FreeCard period={period} className="order-2 md:order-1" />
          {/* Pro 卡（移动端置顶 order-1，桌面 order-2，转化优先 spec §7） */}
          <ProCard
            period={period}
            proPrice={proPrice}
            proUnit={proUnit}
            className="order-1 md:order-2"
          />
        </div>

        {/* 卡片底部辅助行 */}
        <p className="mt-6 text-center text-[length:var(--text-xs)] text-[var(--meta)]">
          支持支付宝 / 微信扫码 · 外币卡 · 随时取消，降级后数据只读保留
        </p>
      </div>
    </section>
  );
}

/** Free 卡。 */
function FreeCard({ period, className }: { period: BillingPeriod; className?: string }) {
  const plan = PRICING_PLANS.free;
  return (
    <div
      className={
        "p-[var(--space-8)] md:p-[var(--space-6)] rounded-[var(--radius-xl)] " +
        "bg-[var(--surface)] border border-[var(--border)] " +
        (className ?? "")
      }
    >
      <h3 className="text-[length:var(--text-lg)] font-[var(--weight-semibold)] text-[var(--fg)]">
        {plan.name}
      </h3>
      <p className="mt-1 text-[length:var(--text-sm)] text-[var(--muted)]">{plan.tagline}</p>

      <div className="mt-4 flex items-baseline gap-1">
        <span className="text-[length:var(--text-4xl)] font-[var(--weight-semibold)] text-[var(--fg)]">
          ¥0
        </span>
        <span className="text-[length:var(--text-sm)] text-[var(--muted)]">/人/月</span>
      </div>

      <ul className="mt-6 space-y-2">
        {plan.features.map((feat) => (
          <li
            key={feat}
            className="flex items-start gap-2 text-[length:var(--text-sm)] text-[var(--fg-2)]"
          >
            <Check size={16} className="shrink-0 mt-0.5 text-[var(--success)]" aria-hidden="true" />
            <span>{feat}</span>
          </li>
        ))}
      </ul>

      <div className="mt-6">
        <TrackedCta href={SIGNUP_BASE} plan="free" source="card" period={period} variant="ghost">
          {plan.cta}
        </TrackedCta>
      </div>
    </div>
  );
}

/** Pro 卡（推荐档）。 */
function ProCard({
  period,
  proPrice,
  proUnit,
  className,
}: {
  period: BillingPeriod;
  proPrice: number;
  proUnit: string;
  className?: string;
}) {
  const plan = PRICING_PLANS.pro;
  return (
    <div
      className={
        "relative p-[var(--space-8)] md:p-[var(--space-6)] rounded-[var(--radius-xl)] " +
        "bg-[var(--surface)] border border-[var(--accent)] shadow-[var(--elev-md)] " +
        (className ?? "")
      }
    >
      {/* 推荐角标 */}
      <span className="absolute top-4 right-4 px-2 py-0.5 rounded-[var(--radius-pill)] bg-[var(--accent)] text-[var(--on-accent)] text-[length:var(--text-xs)] font-[var(--weight-medium)]">
        {plan.badge}
      </span>

      <h3 className="text-[length:var(--text-lg)] font-[var(--weight-semibold)] text-[var(--fg)]">
        {plan.name}
      </h3>
      <p className="mt-1 text-[length:var(--text-sm)] text-[var(--muted)]">{plan.tagline}</p>

      <div className="mt-4 flex items-baseline gap-1">
        {/* 年付态：显示删除线月付原价 + 省钱徽标 */}
        {period === "yearly" && (
          <span className="mr-2 text-[length:var(--text-base)] text-[var(--meta)] line-through">
            ¥{plan.monthlyPrice}
          </span>
        )}
        <span className="text-[length:var(--text-4xl)] font-[var(--weight-semibold)] text-[var(--fg)]">
          ¥{proPrice}
        </span>
        <span className="text-[length:var(--text-sm)] text-[var(--muted)]">{proUnit}</span>
        {period === "yearly" && (
          <span className="ml-2 px-2 py-0.5 rounded-[var(--radius-pill)] bg-[var(--accent-soft)] text-[var(--accent-soft-fg)] text-[length:var(--text-xs)] font-[var(--weight-medium)]">
            省 ¥{YEARLY_SAVING_PER_SEAT}/席
          </span>
        )}
      </div>

      <ul className="mt-6 space-y-2">
        {plan.features.map((feat) => (
          <li
            key={feat}
            className="flex items-start gap-2 text-[length:var(--text-sm)] text-[var(--fg-2)]"
          >
            <Check size={16} className="shrink-0 mt-0.5 text-[var(--success)]" aria-hidden="true" />
            <span>{feat}</span>
          </li>
        ))}
      </ul>

      <div className="mt-6">
        <TrackedCta
          href={`${SIGNUP_BASE}&plan=pro`}
          plan="pro"
          source="card"
          period={period}
          variant="primary"
        >
          {plan.cta}
        </TrackedCta>
      </div>
    </div>
  );
}
