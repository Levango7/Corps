"use client";

/**
 * PricingViewTracker —— view_pricing 埋点副作用组件。
 *
 * 设计：
 *  - useEffect once：挂载后打 view_pricing（spec §8 实现要点 2，客户端挂载触发）。
 *  - sessionStorage 会话去重（key: corps_pricing_viewed），关标签即重置。
 *  - 渲染 null，不产生 DOM。
 *
 * 与 landing_view 的边界（裁决一，docs/design/tri-line-design-review.md §3.1）：
 *  - landing_view 由埋点线 PublicPageTracker 自动覆盖 /pricing（获客段漏斗第一步）。
 *  - view_pricing 为定价页专属曝光与 spec §9 白名单联调事件，由本组件显式触发。
 *  - 单次 PV 两条事件并存，各自独立会话去重，无重复刷量。
 *
 * 关联：
 *  - docs/design/pricing-page-impl-design.md §5.2
 *  - docs/market/pricing-page-spec.md §8（view_pricing 事件规格）
 */

import { useEffect } from "react";
import { track } from "@/lib/analytics";

/** sessionStorage 去重键（会话语义，关标签即重置）。 */
const VIEWED_KEY = "corps_pricing_viewed";

/**
 * 挂载即上报 view_pricing，同 sessionStorage 会话内二次挂载不上报（去重断言）。
 * 渲染 null，不产生 DOM。
 */
export function PricingViewTracker() {
  useEffect(() => {
    // 服务端 / 无 sessionStorage 环境直接跳过（防 SSR 报错）
    if (typeof window === "undefined") return;
    if (typeof window.sessionStorage === "undefined") return;

    // 会话去重：已上报过则不再上报
    if (window.sessionStorage.getItem(VIEWED_KEY) === "1") return;

    // props.theme：根 layout data-theme 由 /theme-init.js 同步设置，挂载时已就绪
    const theme = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";

    // fire-and-forget：track 内部已 try-catch 静默
    track("view_pricing", { theme });

    // 标记本会话已上报
    try {
      window.sessionStorage.setItem(VIEWED_KEY, "1");
    } catch {
      // sessionStorage 写入失败（隐私模式 / 配额满）静默忽略，下次挂载仍可重试
    }
  }, []);

  return null;
}
