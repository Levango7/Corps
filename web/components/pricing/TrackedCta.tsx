"use client";

/**
 * TrackedCta —— 带 click_upgrade 上报的 CTA 链接微组件。
 *
 * 设计：
 *  - 包裹 nav/hero/card/tail_cta 四处 CTA，使服务端区块不沾染客户端行为。
 *  - fire-and-forget：onClick 内联调用 track() 后放行默认导航，不阻塞跳转。
 *  - analytics 队列 5s 兜底 flush + beforeunload sendBeacon 保证离开前发出
 *    （analytics.ts L72–81/L135–150 机制已覆盖）。
 *
 * 关联：
 *  - docs/design/pricing-page-impl-design.md §5.3（选型论证）
 *  - docs/market/pricing-page-spec.md §8（click_upgrade 事件规格）
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { track } from "@/lib/analytics";
import type { BillingPeriod, CtaSource, PlanId } from "@/lib/pricing";

export interface TrackedCtaProps {
  /** 链接目标（CTA 跳转地址，含 query string）。 */
  href: string;
  /** 套餐计划：free / pro。 */
  plan: PlanId;
  /** CTA 位：nav / hero / card / tail_cta（spec §8 source 枚举）。 */
  source: CtaSource;
  /** 当前计费周期（透传至 click_upgrade props.period）。 */
  period: BillingPeriod;
  /** 按钮内容（文本或带图标的 ReactNode）。 */
  children: ReactNode;
  /** 视觉变体：primary 实心 accent / ghost 幽灵样式。 */
  variant?: "primary" | "ghost";
  /** 透传 className（用于点位微调）。 */
  className?: string;
}

/** variant → className 映射（spec §3.2/§3.5 按钮样式）。 */
const VARIANT_CLASS: Record<NonNullable<TrackedCtaProps["variant"]>, string> = {
  primary:
    "inline-flex items-center justify-center gap-2 h-10 px-5 rounded-[var(--radius-md)] " +
    "bg-[var(--accent)] text-[var(--on-accent)] font-[var(--weight-medium)] " +
    "hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)] " +
    "transition-colors duration-[var(--motion-base)] ease-[var(--ease-standard)] " +
    "focus-visible:outline-none focus-visible:ring-[var(--focus-ring)]",
  ghost:
    "inline-flex items-center justify-center gap-2 h-10 px-5 rounded-[var(--radius-md)] " +
    "border border-[var(--border)] text-[var(--fg-2)] font-[var(--weight-medium)] " +
    "hover:bg-[var(--surface-2)] hover:text-[var(--fg)] " +
    "transition-colors duration-[var(--motion-base)] ease-[var(--ease-standard)] " +
    "focus-visible:outline-none focus-visible:ring-[var(--focus-ring)]",
};

/**
 * 渲染一个带 click_upgrade 上报的 Link。
 * onClick 内 track() 调用不抛错、不阻塞导航（fire-and-forget）。
 */
export function TrackedCta({
  href,
  plan,
  source,
  period,
  children,
  variant = "primary",
  className,
}: TrackedCtaProps) {
  return (
    <Link
      href={href}
      className={className ?? VARIANT_CLASS[variant]}
      onClick={() => {
        // fire-and-forget：track 内部已 try-catch 静默，不抛错不阻塞
        track("click_upgrade", { plan, source, period });
      }}
    >
      {children}
    </Link>
  );
}
