"use client";

/**
 * 语言切换按钮 · components/LanguageSwitcher.tsx
 *
 * 依据：ADR-008 方案 A §3.1「全局导航与外壳」
 *
 * 设计：
 *  - 在顶栏放置一个 zh/en 切换按钮
 *  - 切换时通过 next-intl 的 useRouter 切换 locale（自动处理 as-needed 前缀）
 *  - 当前 locale 高亮
 *  - 图标：Lucide Languages（统一图标库，禁 emoji）
 *
 * 关联：
 *  - web/lib/i18n-navigation.ts（locale 感知的 useRouter）
 *  - web/lib/i18n.ts（locales + localeNames）
 */

import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/lib/i18n-navigation";
import { Languages } from "lucide-react";
import { locales, type Locale, localeNames } from "@/lib/i18n";
import { useTranslations } from "next-intl";

export function LanguageSwitcher() {
  const currentLocale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("languageSwitcher");

  function switchTo(next: Locale) {
    if (next === currentLocale) return;
    // next-intl useRouter.replace 自动注入目标 locale 前缀
    // pathname 已是剥离 locale 前缀的路径，直接复用
    router.replace(pathname, { locale: next });
  }

  return (
    <div className="flex items-center gap-1">
      <Languages size={16} className="text-[var(--meta)] mr-0.5" aria-hidden="true" />
      {locales.map((loc) => (
        <button
          key={loc}
          onClick={() => switchTo(loc)}
          // 无障碍名 = "切换语言：<语言>"。aria-label 会覆盖按钮文本作为
          // accessible name——不带语言名时 zh/en 两个按钮同名，屏幕阅读器
          // 与 getByRole 定位均无法区分
          aria-label={`${t("ariaLabel")}：${localeNames[loc]}`}
          aria-current={loc === currentLocale ? "true" : undefined}
          className={`px-1.5 h-7 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] font-[var(--weight-medium)] transition-colors duration-[var(--motion-fast)] focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:outline-none ${
            loc === currentLocale
              ? "bg-[var(--surface-2)] text-[var(--fg)]"
              : "text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg-2)]"
          }`}
        >
          {localeNames[loc]}
        </button>
      ))}
    </div>
  );
}
