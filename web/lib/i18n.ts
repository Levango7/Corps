/**
 * next-intl 配置中心 · lib/i18n.ts
 *
 * 依据：ADR-008 方案 A（next-intl）§3.1 第一期翻译范围
 *
 * 设计要点：
 *  - locales 仅 zh / en，默认 zh（SPEC §1 主市场中国大陆）
 *  - locale → BCP 47 tag 映射用于 Intl.DateTimeFormat/NumberFormat：
 *      zh → zh-CN，en → en-US
 *  - getRequestConfig 按 locale 加载 messages/<locale>.json
 *  - 不在运行时切换 locale 字体（SPEC §8 Inter + Noto Sans SC 已覆盖）
 *
 * 关联：
 *  - web/middleware.ts（locale 检测与重定向）
 *  - web/app/[locale]/layout.tsx（NextIntlClientProvider 注入）
 *  - web/next.config.ts（createNextIntlPlugin 包装）
 */

import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";

/** 应用支持的 locale 列表（ADR-008 §3.1）。 */
export const locales = ["zh", "en"] as const;

/** locale 类型。 */
export type Locale = (typeof locales)[number];

/** 默认 locale（SPEC §1：中国大陆为主市场）。 */
export const defaultLocale: Locale = "zh";

/** locale → BCP 47 语言标签（用于 Intl API 格式化）。 */
export const localeToBcp47: Record<Locale, string> = {
  zh: "zh-CN",
  en: "en-US",
};

/** locale → 显示名称（用于语言切换 UI）。 */
export const localeNames: Record<Locale, string> = {
  zh: "中文",
  en: "English",
};

/**
 * next-intl 请求配置：按 locale 加载对应 messages JSON。
 *
 * 失败回退到默认 locale 的字典，保证渲染不中断。
 */
export default getRequestConfig(async ({ requestLocale }) => {
  // requestLocale 由 middleware 注入；未命中时回退到 defaultLocale
  const requested = await requestLocale;
  const locale: Locale = hasLocale(locales, requested) ? requested : defaultLocale;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
