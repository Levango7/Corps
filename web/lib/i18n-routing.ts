/**
 * next-intl 路由定义 · lib/i18n-routing.ts
 *
 * 集中暴露 routing 实例，供 middleware 与 navigation 工具复用。
 * 依据：ADR-008 方案 A；next-intl 4.x App Router 推荐结构。
 *
 * 策略：
 *  - localePrefix: as-needed（默认 zh 不带前缀，en 带 /en 前缀）
 *    → 保留现有 URL 形态（/auth/login 仍直达中文），降低迁移破坏面
 *  - localeDetection: true（从 cookie / Accept-Language 协商）
 */

import { defineRouting } from "next-intl/routing";
import { locales, defaultLocale } from "./i18n";

export const routing = defineRouting({
  locales,
  defaultLocale,
  // as-needed：默认 locale 不出现在 URL 路径中，避免破坏既有外链与 SEO
  localePrefix: "as-needed",
});
