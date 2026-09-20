"use client";

/**
 * 语言切换按钮 · client 交互部分
 *
 * 负责：locale 检测、路由切换（onClick）、按钮高亮渲染
 */

import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/lib/i18n-navigation";
import { Languages } from "lucide-react";
import { locales, type Locale, localeNames } from "@/lib/i18n";

interface LanguageSwitcherClientProps {
  ariaLabel: string;
}

export function LanguageSwitcherClient({ ariaLabel }: LanguageSwitcherClientProps) {
  const currentLocale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();

  function switchTo(next: Locale) {
    if (next === currentLocale) return;
    router.replace(pathname, { locale: next });
  }

  return (
    <div className="flex items-center gap-1">
      <Languages size={16} className="text-[var(--meta)] mr-0.5" aria-hidden="true" />
      {locales.map((loc) => (
        <button
          key={loc}
          type="button"
          onClick={() => switchTo(loc)}
          aria-label={`${ariaLabel}：${localeNames[loc]}`}
          aria-current={loc === currentLocale ? "true" : undefined}
          className={`px-1.5 h-7 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] transition-colors duration-[var(--motion-fast)] focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:outline-none ${
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